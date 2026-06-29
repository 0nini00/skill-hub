mod cli_registry;
mod paths;
mod types;
mod market;
mod market_commands;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub use cli_registry::*;
pub use paths::*;
pub use types::*;
pub use market_commands::*;

// ---------------------------------------------------------------------------
// BackendResult helpers
// ---------------------------------------------------------------------------

fn ok<T: Serialize>(data: T) -> BackendResult<T> {
    BackendResult {
        ok: true,
        data: Some(data),
        stdout: String::new(),
        stderr: String::new(),
        message: None,
    }
}

fn err<T>(message: impl Into<String>) -> BackendResult<T> {
    let msg = message.into();
    BackendResult {
        ok: false,
        data: None,
        stdout: String::new(),
        stderr: msg.clone(),
        message: Some(msg),
    }
}

// ---------------------------------------------------------------------------
// Skill metadata helpers
// ---------------------------------------------------------------------------

/// 从 SKILL.md 文件中提取第一段非空行作为 summary
fn read_skill_md_summary(path: &Path) -> String {
    let content = fs::read_to_string(path).unwrap_or_default();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            return trimmed.trim_start_matches('#').trim().to_string();
        }
        return trimmed.to_string();
    }
    String::new()
}

/// 从 meta.json 中读取 summary 和 category
#[derive(Debug, Default, Clone, Deserialize)]
struct MetaJson {
    #[serde(default)]
    ai_summary: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    category: Option<String>,
}

impl MetaJson {
    // 逻辑对齐 Electron 原版：优先使用 ai_summary，没有则 fallback 到 summary
    fn get_summary(&self) -> Option<String> {
        // 如果 ai_summary 存在且不为空，优先用它（这是 Electron 版写入的字段）
        if let Some(s) = &self.ai_summary {
            if !s.is_empty() {
                return Some(s.clone());
            }
        }
        // 否则用 summary
        self.summary.clone()
    }
}

fn read_meta_json(path: &Path) -> MetaJson {
    match fs::read_to_string(path) {
        Ok(content) => {
            match serde_json::from_str::<MetaJson>(&content) {
                Ok(meta) => {
                    eprintln!("[读取] {} -> ai_summary: {:?}, summary: {:?}", 
                        path.file_name().unwrap_or_default().to_str().unwrap_or("?"),
                        meta.ai_summary, meta.summary);
                    meta
                },
                Err(e) => {
                    eprintln!("[读取] {} 解析失败: {}", 
                        path.file_name().unwrap_or_default().to_str().unwrap_or("?"), e);
                    MetaJson::default()
                }
            }
        },
        Err(_) => MetaJson::default(),
    }
}


/// 尝试从某个技能目录读取 summary/category，并标记是否存在 SKILL.md
fn try_read_skill_info_from_dir(dir: &Path, summary: &mut String, category: &mut Option<String>, any_skill_md_exists: &mut bool) {
    let meta_path = dir.join("meta.json");
    let meta = read_meta_json(&meta_path);

    if category.is_none() {
        *category = meta.category.as_ref().filter(|c| !c.is_empty()).cloned();
    }

    if summary.is_empty() {
        if let Some(s) = meta.get_summary() {
            if !s.is_empty() {
                *summary = s;
            }
        }
    }

    let skill_md = dir.join("SKILL.md");
    if skill_md.exists() {
        *any_skill_md_exists = true;
        if summary.is_empty() {
            *summary = read_skill_md_summary(&skill_md);
        }
    }
}

fn slug_from_dir_name(name: &str) -> String {
    name.trim().to_lowercase().replace(' ', "-")
}

fn safe_skill_child_path(skill_path: &Path, relative_path: &str) -> Option<PathBuf> {
    if relative_path.is_empty() {
        return None;
    }

    let mut full = skill_path.to_path_buf();
    for component in Path::new(relative_path).components() {
        match component {
            std::path::Component::Normal(part) => full.push(part),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(full)
}

pub(crate) fn ensure_standard_skill_md_name(skill_dir: &Path) -> Result<(), String> {
    let standard = skill_dir.join("SKILL.md");
    if standard.is_file() {
        return Ok(());
    }

    let entries = std::fs::read_dir(skill_dir)
        .map_err(|e| format!("读取 skill 目录失败: {e}"))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.eq_ignore_ascii_case("SKILL.md") {
            continue;
        }

        let source = entry.path();
        std::fs::rename(&source, &standard)
            .or_else(|_| {
                std::fs::copy(&source, &standard)?;
                std::fs::remove_file(&source)
            })
            .map_err(|e| format!("规范化 SKILL.md 文件名失败: {e}"))?;
        break;
    }

    Ok(())
}

/// 获取技能目录中所有文件的最后修改时间。
fn get_skill_modified_time(dir: &Path) -> Option<std::time::SystemTime> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut newest = None;

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        let candidate = if file_type.is_dir() {
            get_skill_modified_time(&path)
        } else if file_type.is_file() {
            entry.metadata().ok().and_then(|m| m.modified().ok())
        } else {
            None
        };

        if let Some(time) = candidate {
            if newest.map_or(true, |current| time > current) {
                newest = Some(time);
            }
        }
    }

    newest
}

fn paths_refer_to_same_location(a: &Path, b: &Path) -> bool {
    let canonical_a = fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let canonical_b = fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    canonical_a == canonical_b
}

fn sync_cli_skills_to_hub(
    hub_dir: &Path,
    hub_skills: &mut std::collections::HashMap<String, PathBuf>,
    external_skills: &std::collections::HashMap<String, Vec<(String, PathBuf)>>,
) {
    let mut all_sync_slugs: HashSet<String> = HashSet::new();
    for slug in hub_skills.keys() {
        all_sync_slugs.insert(slug.clone());
    }
    for slug in external_skills.keys() {
        all_sync_slugs.insert(slug.clone());
    }

    for slug in &all_sync_slugs {
        let cli_paths = external_skills.get(slug).cloned().unwrap_or_default();

        let mut newest_time: Option<std::time::SystemTime> = None;
        let mut newest_name = String::new();
        let mut newest_path: Option<PathBuf> = None;

        if let Some(hub_path) = hub_skills.get(slug) {
            if let Some(t) = get_skill_modified_time(hub_path) {
                newest_time = Some(t);
                newest_name = "hub".to_string();
                newest_path = Some(hub_path.clone());
            }
        }

        for (cli_name, cli_dir) in &cli_paths {
            if let Some(t) = get_skill_modified_time(cli_dir) {
                if newest_time.is_none() || t > newest_time.unwrap() {
                    newest_time = Some(t);
                    newest_name = cli_name.clone();
                    newest_path = Some(cli_dir.clone());
                }
            }
        }

        let Some(newest_src) = newest_path else {
            continue;
        };
        let newest_is_hub = newest_name == "hub";

        if !newest_is_hub {
            let hub_target = hub_dir.join(slug);
            eprintln!("[sync] {} 最新版在 {}，同步到 hub: {:?}", slug, newest_name, hub_target);
            if hub_target.exists() {
                let _ = std::fs::remove_dir_all(&hub_target);
            }
            if let Err(e) = copy_dir_recursive(&newest_src, &hub_target) {
                eprintln!("[sync] 同步到 hub 失败 {}: {}", slug, e);
                continue;
            }
            hub_skills.insert(slug.clone(), hub_target);
        }

        let hub_skill_path = match hub_skills.get(slug) {
            Some(p) => p.clone(),
            None => continue,
        };
        let hub_time = get_skill_modified_time(&hub_skill_path);

        for (cli_name, cli_dir) in &cli_paths {
            if !newest_is_hub && paths_refer_to_same_location(cli_dir, &newest_src) {
                continue;
            }

            let cli_time = get_skill_modified_time(cli_dir);
            if cli_time.is_none() || hub_time.is_none() || cli_time.unwrap() < hub_time.unwrap() {
                eprintln!("[sync] {} 推送到 {} ({:?})", slug, cli_name, cli_dir);
                if cli_dir.exists() {
                    let _ = std::fs::remove_dir_all(cli_dir);
                }
                if let Err(e) = copy_dir_recursive(&hub_skill_path, cli_dir) {
                    eprintln!("[sync] 推送到 {} 失败: {}", cli_name, e);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_test_dir(name: &str) -> PathBuf {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("skill-hub-{name}-{}-{id}", std::process::id()))
    }

    #[test]
    fn sync_imports_cli_only_skill_into_hub() {
        let root = unique_test_dir("cli-only-import");
        let hub_dir = root.join("hub").join("skills");
        let codex_skill_dir = root.join("codex").join("skills").join("file-operations");
        let nested_dir = codex_skill_dir.join("references");

        std::fs::create_dir_all(&nested_dir).expect("create test skill dirs");
        std::fs::write(
            codex_skill_dir.join("SKILL.md"),
            "---\nname: file-operations\n---\n",
        )
        .expect("write SKILL.md");
        std::fs::write(nested_dir.join("note.txt"), "kept").expect("write nested file");

        let mut hub_skills = std::collections::HashMap::new();
        let mut external_skills = std::collections::HashMap::new();
        external_skills.insert(
            "file-operations".to_string(),
            vec![("codex".to_string(), codex_skill_dir.clone())],
        );

        sync_cli_skills_to_hub(&hub_dir, &mut hub_skills, &external_skills);

        let imported = hub_dir.join("file-operations");
        assert!(imported.join("SKILL.md").is_file());
        assert_eq!(
            std::fs::read_to_string(imported.join("references").join("note.txt"))
                .expect("read imported nested file"),
            "kept"
        );
        assert_eq!(hub_skills.get("file-operations"), Some(&imported));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sync_prefers_cli_when_nested_file_is_newer_than_hub_skill_md() {
        let root = unique_test_dir("nested-mtime-sync");
        let hub_dir = root.join("hub").join("skills");
        let hub_skill_dir = hub_dir.join("file-operations");
        let cli_skill_dir = root.join("codex").join("skills").join("file-operations");

        std::fs::create_dir_all(hub_skill_dir.join("references")).expect("create hub skill");
        std::fs::create_dir_all(cli_skill_dir.join("references")).expect("create cli skill");

        std::fs::write(cli_skill_dir.join("SKILL.md"), "---\nname: file-operations\n---\n")
            .expect("write cli SKILL.md");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(hub_skill_dir.join("SKILL.md"), "---\nname: file-operations\n---\n")
            .expect("write hub SKILL.md");
        std::fs::write(hub_skill_dir.join("references").join("note.txt"), "old")
            .expect("write old hub nested file");
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(cli_skill_dir.join("references").join("note.txt"), "new")
            .expect("write new cli nested file");

        let mut hub_skills = std::collections::HashMap::new();
        hub_skills.insert("file-operations".to_string(), hub_skill_dir.clone());
        let mut external_skills = std::collections::HashMap::new();
        external_skills.insert(
            "file-operations".to_string(),
            vec![("codex".to_string(), cli_skill_dir.clone())],
        );

        sync_cli_skills_to_hub(&hub_dir, &mut hub_skills, &external_skills);

        assert_eq!(
            std::fs::read_to_string(hub_skill_dir.join("references").join("note.txt"))
                .expect("read synced nested file"),
            "new"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn safe_skill_child_path_rejects_parent_components() {
        let base = PathBuf::from("skill-root");

        assert!(safe_skill_child_path(&base, "../outside.md").is_none());
        assert!(safe_skill_child_path(&base, "nested/../../outside.md").is_none());
        assert_eq!(
            safe_skill_child_path(&base, "references/note.md"),
            Some(base.join("references").join("note.md"))
        );
    }

    #[test]
    fn ensure_standard_skill_md_name_renames_lowercase_file() {
        let root = unique_test_dir("lowercase-skill-md");
        let skill_dir = root.join("skill");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(skill_dir.join("skill.md"), "lowercase").expect("write lowercase skill");

        ensure_standard_skill_md_name(&skill_dir).expect("normalize skill filename");

        assert_eq!(
            std::fs::read_to_string(skill_dir.join("SKILL.md")).expect("read normalized skill"),
            "lowercase"
        );
        assert!(!skill_dir.join("skill.md").exists());

        let _ = std::fs::remove_dir_all(root);
    }
}

// ---------------------------------------------------------------------------
// get_full_app_state
// ---------------------------------------------------------------------------

/// 构建完整的应用状态：
/// - 扫描 `~/.config/skill-hub/skills/` 下所有技能
/// - 对每个技能检查在每个已检测 CLI 下是否已链接（symlink/junction）
/// - 读取 meta.json 获取 summary / category，回退到 SKILL.md
/// - hidden 状态从 config.json 的 hidden_skills 读取
#[tauri::command]
fn get_full_app_state() -> Result<AppState, String> {
    ensure_base_dirs()?;

    // 读取配置
    let config: SkillHubConfig = read_json_file(&config_path()?);
    let visible_clis = config.visible_clis.unwrap_or_default();
    let hidden_slugs: HashSet<String> = config.hidden_skills.iter().cloned().collect();

    // 扫描所有已存在的 CLIs
    let detected_clis = scan_all_clis();

    // 扫描技能目录（并集）：
    // 1) Skill Hub 库目录: ~/.config/skill-hub/skills
    // 2) 各 CLI 的 skills 目录（可能不止一个路径）

    // hub_skills: slug -> hub_dir_path
    let mut hub_skills: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();
    let hub_dir = skills_dir()?;
    if let Ok(entries) = fs::read_dir(&hub_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            // 解析符号链接为真实路径
            let real_path = fs::canonicalize(&path).unwrap_or(path.clone());

            let slug = path
                .file_name()
                .and_then(|s| s.to_str())
                .map(slug_from_dir_name)
                .unwrap_or_else(|| "unknown".to_string());
            hub_skills.insert(slug, real_path);
        }
    }

    // external_skills: slug -> Vec<(cli_name, skill_dir_path)>
    let mut external_skills: std::collections::HashMap<String, Vec<(String, PathBuf)>> = std::collections::HashMap::new();
    let all_cli_paths = crate::all_existing_cli_paths();
    for (cli, paths) in all_cli_paths {
        for skills_path in paths {
            let skills_dir_path = PathBuf::from(&skills_path);
            if let Ok(entries) = fs::read_dir(&skills_dir_path) {
                for entry in entries.flatten() {
                    let sp = entry.path();
                    if !sp.is_dir() {
                        continue;
                    }

                    // 解析符号链接为真实路径
                    let real_path = fs::canonicalize(&sp).unwrap_or(sp.clone());

                    let slug = sp
                        .file_name()
                        .and_then(|s| s.to_str())
                        .map(slug_from_dir_name)
                        .unwrap_or_else(|| "unknown".to_string());
                    external_skills
                        .entry(slug)
                        .or_insert_with(Vec::new)
                        .push((cli.clone(), real_path));
                }
            }
        }
    }

    // 自动同步：最新版赢，hub 当中转站。
    sync_cli_skills_to_hub(&hub_dir, &mut hub_skills, &external_skills);

    // 合并 slug 集合
    let mut all_slugs: Vec<String> = hub_skills.keys().cloned().collect();
    for slug in external_skills.keys() {
        if !hub_skills.contains_key(slug) {
            all_slugs.push(slug.clone());
        }
    }
    all_slugs.sort();
    all_slugs.dedup();

    // 构建 skills 行
    let mut skills: Vec<SkillRow> = Vec::new();

    for slug in all_slugs {
        let hub_path = hub_skills.get(&slug).cloned();
        let ext_paths = external_skills.get(&slug).cloned().unwrap_or_default();

        let source = if hub_path.is_some() { "hub" } else { "external" };

        // 读取 meta/summary/category：优先 hub，没有再 external
        let mut summary = String::new();
        let mut category: Option<String> = None;

        let mut any_skill_md_exists = false;

        // 从某个技能目录尝试读取 summary/category（函数在上方定义）

        if let Some(dir) = &hub_path {
            try_read_skill_info_from_dir(dir, &mut summary, &mut category, &mut any_skill_md_exists);
        }
        if summary.is_empty() || category.is_none() {
            // external fallback
            for (_cli, dir) in &ext_paths {
                try_read_skill_info_from_dir(dir, &mut summary, &mut category, &mut any_skill_md_exists);
                if !summary.is_empty() && category.is_some() {
                    break;
                }
            }
        }

        let missing = !any_skill_md_exists && summary.is_empty();
        let hidden = hidden_slugs.contains(&slug);

        // linked：只要任一 CLI 任一路径下存在该 slug 即算
        let mut linked: Vec<String> = Vec::new();
        for cli_row in &detected_clis {
            if crate::is_skill_linked_any(&cli_row.cli, &slug) {
                linked.push(cli_row.cli.clone());
            }
        }

        // path：优先 hub，否则 external 任意一个
        let path = if let Some(dir) = hub_path {
            dir.to_string_lossy().to_string()
        } else if let Some((_cli, dir)) = ext_paths.first() {
            dir.to_string_lossy().to_string()
        } else {
            String::new()
        };

        skills.push(SkillRow {
            source: source.to_string(),
            name: slug.clone(),
            slug,
            hidden,
            missing,
            summary,
            category,
            path,
            linked,
        });
    }

    // hidden 的仍然返回在 skills 里，由前端做分组
    // 如果 visible_clis 为空，使用所有检测到的 CLI 名称
    let visible_clis = if visible_clis.is_empty() {
        detected_clis.iter().map(|c| c.cli.clone()).collect()
    } else {
        visible_clis
    };

    Ok(AppState {
        skills,
        detected_clis,
        visible_clis,
    })
}

// ---------------------------------------------------------------------------
// 旧 command（保持兼容，内部调用 get_full_app_state）
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_app_state() -> Result<AppState, String> {
    get_full_app_state()
}

// ---------------------------------------------------------------------------
// 其他 Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_config() -> Result<SkillHubConfig, String> {
    Ok(read_json_file(&config_path()?))
}

#[tauri::command]
fn write_config(config: SkillHubConfig) -> Result<BackendResult<()>, String> {
    write_json_file(&config_path()?, &config)?;
    Ok(ok(()))
}

#[tauri::command]
fn read_ai_config() -> Result<AiConfig, String> {
    Ok(read_json_file(&ai_config_path()?))
}

#[tauri::command]

fn write_ai_config(config: AiConfig) -> Result<BackendResult<()>, String> {

    write_json_file(&ai_config_path()?, &config)?;

    Ok(ok(()))

}



/// 设置矩阵显示列

#[tauri::command]

fn set_visible_clis(clis: String) -> Result<BackendResult<serde_json::Value>, String> {

    let cfg_path = crate::paths::config_path()?;

    let mut config: SkillHubConfig = read_json_file(&cfg_path);

    

    // 解析逗号分隔的字符串

    let visible_clis: Vec<String> = if clis.is_empty() {

        Vec::new()

    } else {

        clis.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()

    };

    

    config.visible_clis = Some(visible_clis.clone());

    write_json_file(&cfg_path, &config)?;

    

    Ok(ok(serde_json::json!({ "visible_clis": visible_clis })))

}

#[tauri::command]
async fn pick_directory(window: tauri::Window) -> Result<Option<String>, String> {
    let folder = tauri_plugin_dialog::DialogExt::dialog(&window)
        .file()
        .blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

// 递归复制目录
#[tauri::command]
fn project_install(params: ProjectInstallParams) -> Result<BackendResult<serde_json::Value>, String> {
    ensure_base_dirs()?;
    let from_dir = skills_dir()?.join(&params.slug);
    if !from_dir.exists() {
        return Ok(err(format!("技能不存在: {}", params.slug)));
    }

    let to_dir = PathBuf::from(&params.project_path)
        .join(".skill-hub")
        .join("skills")
        .join(&params.slug);

    if to_dir.exists() {
        fs::remove_dir_all(&to_dir).map_err(|e| format!("清理目标目录失败: {e}"))?;
    }
    fs::create_dir_all(&to_dir).map_err(|e| format!("创建目标目录失败: {e}"))?;

    copy_dir_recursive(&from_dir, &to_dir).map_err(|e| format!("复制目录失败: {e}"))?;

    Ok(ok(serde_json::json!({
        "project": params.project_path,
        "slug": params.slug,
        "installed_to": to_dir.to_string_lossy().to_string()
    })))
}

/// 批量安装技能到项目（复制文件 + 创建 CLI 链接）
#[tauri::command]
fn install_skills_to_project(project_path: String, slugs: Vec<String>, clis: Vec<String>) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let mut installed = Vec::new();
    let mut errors = Vec::new();
    
    for slug in &slugs {
        let from_dir = skills_dir.join(slug);
        if !from_dir.exists() {
            errors.push(format!("技能不存在: {}", slug));
            continue;
        }
        
        // 直接复制到各 CLI 目录：项目/.{cli}/skills/<slug>
        let mut cli_installed = false;
        for cli in &clis {
            let cli_skills_dir = PathBuf::from(&project_path)
                .join(format!(".{}/skills", cli));
            
            if let Err(e) = fs::create_dir_all(&cli_skills_dir) {
                errors.push(format!("创建 CLI 目录失败 {}: {}", cli, e));
                continue;
            }
            
            let link_target = cli_skills_dir.join(slug);
            
            if link_target.exists() {
                if let Err(e) = fs::remove_dir_all(&link_target) {
                    errors.push(format!("清理旧目录失败 {} -> {}: {}", cli, slug, e));
                    continue;
                }
            }
            if let Err(e) = copy_dir_recursive(&from_dir, &link_target) {
                errors.push(format!("复制技能到 CLI 失败 {} -> {}: {}", cli, slug, e));
                continue;
            }
            cli_installed = true;
        }
        
        if cli_installed {
            installed.push(slug.clone());
        }
    }
    
    if errors.is_empty() {
        Ok(ok(serde_json::json!({
            "installed": installed,
            "project": project_path
        })))
    } else {
        Ok(err(format!("部分安装失败: {}", errors.join("; "))))
    }
}

/// 在文件管理器中打开指定路径
#[tauri::command]
fn open_path(path: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let status = std::process::Command::new("explorer")
            .arg(&path)
            .status()
            .map_err(|e| format!("打开路径失败: {e}"))?;
        return Ok(status.success());
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg(&path)
            .status()
            .map_err(|e| format!("打开路径失败: {e}"))?;
        return Ok(status.success());
    }

    #[cfg(target_os = "linux")]
    {
        let status = std::process::Command::new("xdg-open")
            .arg(&path)
            .status()
            .map_err(|e| format!("打开路径失败: {e}"))?;
        return Ok(status.success());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Ok(false)
    }

}

/// 启用技能：将 Hub 技能链接（symlink 或复制）到指定 CLI 目录
#[tauri::command]
fn link_skill(cli: String, slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    let hub_dir = crate::paths::skills_dir()?.join(&slug);
    if !hub_dir.exists() {
        return Ok(err(format!("技能不存在: {}", slug)));
    }

    // 读取链接模式
    let config: SkillHubConfig = read_json_file(&config_path()?);
    let use_symlink = config.link_mode == "symlink";

    // 查找 CLI 的 skills 目录
    let cli_dir = PathBuf::from(crate::resolve_cli_path(&cli).ok_or_else(|| format!("CLI 目录不存在: {}", cli))?);
    std::fs::create_dir_all(&cli_dir).map_err(|e| format!("创建 CLI skills 目录失败: {e}"))?;
    let target = cli_dir.join(&slug);

    // 如果已存在，先删除旧的
    if target.exists() || target.is_symlink() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("清理目标失败: {e}"))?;
    }

    if use_symlink {
        // 创建符号链接
        eprintln!("[link_skill] symlink {:?} -> {:?}", hub_dir, target);
        #[cfg(target_os = "windows")]
        {
            std::os::windows::fs::symlink_dir(&hub_dir, &target)
                .map_err(|e| format!("创建软链接失败（可能需要管理员权限或开启开发者模式）: {e}"))?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::os::unix::fs::symlink(&hub_dir, &target)
                .map_err(|e| format!("创建软链接失败: {e}"))?;
        }
    } else {
        // 递归复制整个目录
        eprintln!("[link_skill] 复制 {:?} -> {:?}", hub_dir, target);
        copy_dir_recursive(&hub_dir, &target)
            .map_err(|e| format!("复制目录失败: {e}"))?;
    }

    Ok(ok(serde_json::json!({
        "cli": cli,
        "slug": slug,
        "linked": true,
        "mode": if use_symlink { "symlink" } else { "copy" }
    })))
}

/// 递归复制目录
pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

/// 从指定 CLI 取消链接技能
/// 禁用技能：直接删除 CLI 目录中的技能副本
#[tauri::command]
fn unlink_skill(cli: String, slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    let mut removed = Vec::new();
    let mut skipped = Vec::new();

    for cli_path in crate::cli_registry::existing_cli_paths(&cli) {
        let target = PathBuf::from(&cli_path).join(&slug);
        if target.exists() || target.is_symlink() {
            eprintln!("[unlink_skill] 删除 {:?}", target);
            match std::fs::remove_dir_all(&target) {
                Ok(()) => removed.push(target.to_string_lossy().to_string()),
                Err(e) => skipped.push(format!("{}: {}", target.to_string_lossy(), e)),
            }
        }
    }

    if removed.is_empty() {
        Ok(err(format!("未找到技能: {} / {}", cli, slug)))
    } else {
        Ok(ok(serde_json::json!({
            "cli": cli,
            "slug": slug,
            "linked": false,
            "removed": removed,
            "skipped": skipped
        })))
    }
}

/// 切换链接模式（symlink / copy），并批量转换已有的 CLI skills
#[tauri::command]
fn set_link_mode(mode: String) -> Result<BackendResult<serde_json::Value>, String> {
    if mode != "symlink" && mode != "copy" {
        return Ok(err(format!("无效的链接模式: {}，仅支持 symlink 或 copy", mode)));
    }

    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);
    let old_mode = config.link_mode.clone();
    config.link_mode = mode.clone();
    write_json_file(&cfg_path, &config)?;

    eprintln!("[set_link_mode] {} -> {}", old_mode, mode);

    // 如果模式没变，不需要转换
    if old_mode == mode {
        return Ok(ok(serde_json::json!({
            "mode": mode,
            "converted": 0,
            "errors": []
        })));
    }

    let hub_dir = crate::paths::skills_dir()?;
    let use_symlink = mode == "symlink";

    // 扫描所有已检测到的 CLI，找到所有已链接的 skills
    let detected = crate::cli_registry::scan_all_clis();
    let mut converted = 0;
    let mut errors: Vec<String> = Vec::new();

    for cli_row in &detected {
        for cli_path in crate::cli_registry::existing_cli_paths(&cli_row.cli) {
            let cli_skills_dir = PathBuf::from(&cli_path);
            if !cli_skills_dir.exists() {
                continue;
            }

            if let Ok(entries) = std::fs::read_dir(&cli_skills_dir) {
                for entry in entries.flatten() {
                    let target = entry.path();
                    if !target.is_dir() && !target.is_symlink() {
                        continue;
                    }

                    let slug = match target.file_name().and_then(|n| n.to_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };

                    let hub_skill_path = hub_dir.join(&slug);
                    if !hub_skill_path.exists() {
                        continue; // hub 里没有，跳过
                    }

                    let is_currently_symlink = crate::cli_registry::is_symlink_or_junction(&target);

                    // 如果当前状态已经是目标模式，跳过
                    if use_symlink == is_currently_symlink {
                        continue;
                    }

                    // 删除旧的
                    if let Err(e) = std::fs::remove_dir_all(&target) {
                        errors.push(format!("{}/{}: 删除失败: {}", cli_row.cli, slug, e));
                        continue;
                    }

                    if use_symlink {
                        // 复制 → 软链接
                        #[cfg(target_os = "windows")]
                        {
                            if let Err(e) = std::os::windows::fs::symlink_dir(&hub_skill_path, &target) {
                                errors.push(format!("{}/{}: 创建软链接失败: {}", cli_row.cli, slug, e));
                                // 回退为复制
                                let _ = copy_dir_recursive(&hub_skill_path, &target);
                                continue;
                            }
                        }
                        #[cfg(not(target_os = "windows"))]
                        {
                            if let Err(e) = std::os::unix::fs::symlink(&hub_skill_path, &target) {
                                errors.push(format!("{}/{}: 创建软链接失败: {}", cli_row.cli, slug, e));
                                let _ = copy_dir_recursive(&hub_skill_path, &target);
                                continue;
                            }
                        }
                    } else {
                        // 软链接 → 复制
                        if let Err(e) = copy_dir_recursive(&hub_skill_path, &target) {
                            errors.push(format!("{}/{}: 复制失败: {}", cli_row.cli, slug, e));
                            continue;
                        }
                    }

                    converted += 1;
                    eprintln!("[set_link_mode] {} {}/{}", if use_symlink { "symlink" } else { "copy" }, cli_row.cli, slug);
                }
            }
        }
    }

    Ok(ok(serde_json::json!({
        "mode": mode,
        "converted": converted,
        "errors": errors
    })))
}

/// 隐藏技能
#[tauri::command]
fn hide_skill(slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);
    if !config.hidden_skills.contains(&slug) {
        config.hidden_skills.push(slug.clone());
    }
    write_json_file(&cfg_path, &config)?;
    Ok(ok(serde_json::json!({ "slug": slug })))
}

/// 恢复隐藏的技能
#[tauri::command]
fn unhide_skill(slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);
    config.hidden_skills.retain(|s| s != &slug);
    write_json_file(&cfg_path, &config)?;
    Ok(ok(serde_json::json!({ "slug": slug })))
}

/// 删除技能（仅删除 Hub 管理的技能，并清理配置中的隐藏标记）
#[tauri::command]
fn delete_skill(slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    eprintln!("[delete_skill] 开始删除技能: {}", slug);

    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);

    eprintln!("[delete_skill] 检查路径: {:?}", skill_path);

    // 只删除 Hub 管理的技能（位于 ~/.config/skill-hub/skills/）
    if !skill_path.exists() {
        eprintln!("[delete_skill] 技能不在 Hub 目录中，无法删除");
        return Ok(err(format!("该技能不在 Skill Hub 管理目录中，无法删除")));
    }

    eprintln!("[delete_skill] 删除目录: {:?}", skill_path);
    std::fs::remove_dir_all(&skill_path)
        .map_err(|e| {
            eprintln!("[delete_skill] 删除失败: {}", e);
            format!("删除失败: {e}")
        })?;
    eprintln!("[delete_skill] 目录删除成功");

    // 清理配置中的隐藏标记
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);
    let before_count = config.hidden_skills.len();
    config.hidden_skills.retain(|s| s != &slug);
    let after_count = config.hidden_skills.len();

    eprintln!("[delete_skill] 隐藏标记清理: {} -> {}", before_count, after_count);

    write_json_file(&cfg_path, &config)?;

    // 清理所有 CLI 目录中的技能副本
    let mut cli_removed: Vec<String> = Vec::new();
    for (_cli_name, cli_paths) in &crate::get_cli_definitions() {
        for cli_path_str in cli_paths {
            let target = PathBuf::from(cli_path_str).join(&slug);
            if target.exists() || target.is_symlink() {
                eprintln!("[delete_skill] 清理 CLI 副本: {:?}", target);
                if let Err(e) = std::fs::remove_dir_all(&target) {
                    eprintln!("[delete_skill] 清理失败 {:?}: {}", target, e);
                } else {
                    cli_removed.push(target.to_string_lossy().to_string());
                }
            }
        }
    }

    eprintln!("[delete_skill] 删除成功: {} (CLI 清理: {:?})", slug, cli_removed);
    Ok(ok(serde_json::json!({
        "slug": slug,
        "cli_cleaned": cli_removed
    })))
}

/// 从 Git URL 导入技能
#[tauri::command]
fn git_import(url: String) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let slug = url.trim_end_matches('/').split('/').last()
        .unwrap_or("unknown")
        .trim_end_matches(".git")
        .to_lowercase()
        .replace(' ', "-");

    let target_dir = skills_dir.join(&slug);
    if target_dir.exists() {
        return Ok(err(format!("技能已存在: {}", slug)));
    }

    // 读取代理配置
    let ai_cfg_path = crate::paths::ai_config_path()?;
    let ai_config: crate::types::AiConfig = read_json_file(&ai_cfg_path);
    
    let mut cmd = std::process::Command::new("git");
    
    // 如果配置了代理，通过 -c 参数传给 git
    if let Some(proxy_url) = ai_config.proxy.as_ref() {
        if !proxy_url.trim().is_empty() {
            eprintln!("[Git] 使用代理: {}", proxy_url.trim());
            cmd.arg("-c").arg(format!("http.proxy={}", proxy_url.trim()));
            cmd.arg("-c").arg(format!("https.proxy={}", proxy_url.trim()));
        }
    }
    
    let output = cmd
        .args(&["clone", "--depth", "1", &url, target_dir.to_str().unwrap()])
        .output()
        .map_err(|e| format!("git clone 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone 失败: {}", stderr.trim()));
    }

    let skill_md = target_dir.join("SKILL.md");
    if !skill_md.exists() {
        return Err("仓库中未找到 SKILL.md".to_string());
    }

    let content = std::fs::read_to_string(&skill_md).unwrap_or_default();
    let summary = content.lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .map(|l| l.trim_start_matches('#').trim().to_string())
        .unwrap_or_default();

    Ok(ok(serde_json::json!({
        "slug": slug,
        "summary": summary,
        "path": target_dir.to_str().unwrap_or("")
    })))
}

/// 从本地导入 Skill 或 Rule（自动识别）
#[tauri::command]
async fn import_local(app_handle: tauri::AppHandle) -> Result<BackendResult<serde_json::Value>, String> {
    use tauri_plugin_dialog::DialogExt;

    // 先尝试选择文件夹
    let folder = app_handle
        .dialog()
        .file()
        .set_title("选择 Skill 文件夹（包含 SKILL.md）或取消后选择文件")
        .blocking_pick_folder();

    if let Some(path) = folder {
        let source_path = path.as_path().ok_or("路径无效")?;

        // 检查是否包含 SKILL.md
        let skill_md = source_path.join("SKILL.md");
        let skill_md_lower = source_path.join("skill.md");

        if skill_md.exists() || skill_md_lower.exists() {
            return import_skill_folder(source_path);
        } else {
            return Ok(err("该文件夹不包含 SKILL.md，无法作为 Skill 导入。\n\n提示：请选择包含 SKILL.md 的文件夹，或取消后选择单个 SKILL.md 文件。".to_string()));
        }
    }

    // 用户取消了文件夹选择，或者想选择文件，再打开文件选择对话框
    let file = app_handle
        .dialog()
        .file()
        .set_title("选择 SKILL.md 文件或 Rule 文件")
        .add_filter("Markdown", &["md"])
        .blocking_pick_file();

    let Some(path) = file else {
        return Ok(err("未选择文件".to_string()));
    };

    let source_path = path.as_path().ok_or("路径无效")?;

    if source_path.is_file() {
        let file_name = source_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        if file_name.eq_ignore_ascii_case("SKILL.md") {
            // 单个 SKILL.md 文件
            import_skill_file(source_path)
        } else if file_name.ends_with(".md") {
            // 其他 .md 文件，作为 Rule 导入
            import_rule_file(source_path)
        } else {
            Ok(err("不支持的文件格式，仅支持 .md 文件".to_string()))
        }
    } else {
        Ok(err("请选择文件，而非目录".to_string()))
    }
}

/// 导入 Skill 文件夹
fn import_skill_folder(source: &std::path::Path) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let slug = source.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_lowercase()
        .replace(' ', "-");

    let target_dir = skills_dir.join(&slug);
    if target_dir.exists() {
        return Ok(err(format!("Skill 已存在: {}", slug)));
    }

    // 复制整个文件夹
    copy_dir_recursive(source, &target_dir)
        .map_err(|e| format!("复制文件夹失败: {e}"))?;
    ensure_standard_skill_md_name(&target_dir)?;

    Ok(ok(serde_json::json!({
        "type": "skill",
        "name": slug
    })))
}

/// 导入单个 SKILL.md 文件
fn import_skill_file(source: &std::path::Path) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    // 使用父目录名作为 slug，如果没有则用 imported-skill
    let slug = source.parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("imported-skill")
        .to_lowercase()
        .replace(' ', "-");

    let target_dir = skills_dir.join(&slug);
    if target_dir.exists() {
        return Ok(err(format!("Skill 已存在: {}", slug)));
    }

    std::fs::create_dir_all(&target_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    std::fs::copy(source, target_dir.join("SKILL.md"))
        .map_err(|e| format!("复制文件失败: {e}"))?;

    Ok(ok(serde_json::json!({
        "type": "skill",
        "name": slug
    })))
}

/// 导入 Rule 文件
fn import_rule_file(source: &std::path::Path) -> Result<BackendResult<serde_json::Value>, String> {
    let rules_dir = crate::paths::rules_dir()?;
    std::fs::create_dir_all(&rules_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let file_name = source.file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("imported-rule");

    let slug = file_name.to_lowercase().replace(' ', "-");
    let target_path = rules_dir.join(format!("{}.md", slug));

    if target_path.exists() {
        return Ok(err(format!("Rule 已存在: {}", slug)));
    }

    std::fs::copy(source, &target_path)
        .map_err(|e| format!("复制文件失败: {e}"))?;

    Ok(ok(serde_json::json!({
        "type": "rule",
        "name": slug
    })))
}

/// AI 摘要生成（stub，待接入真实 API）
#[tauri::command]
async fn ai_summarize(slug: String, _content: String) -> Result<BackendResult<serde_json::Value>, String> {
    // 如果 slug 为空，批量处理所有 Hub Skills
    if slug.is_empty() {
        return tokio::task::spawn_blocking(|| batch_ai_summarize()).await
            .map_err(|e| format!("异步任务失败: {}", e))?;
    }

    // 否则处理单个 Skill
    tokio::task::spawn_blocking(move || generate_single_summary(&slug)).await
        .map_err(|e| format!("异步任务失败: {}", e))?
}

/// 批量生成所有 Hub Skills 的 AI 摘要
fn batch_ai_summarize() -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;

    let entries = std::fs::read_dir(&skills_dir)
        .map_err(|e| format!("读取技能目录失败: {e}"))?;

    let mut success_count = 0;
    let mut fail_count = 0;
    let mut results = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let slug = path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        if slug.is_empty() {
            continue;
        }

        eprintln!("[批量摘要] 正在处理: {}", slug);

        match generate_single_summary(&slug) {
            Ok(result) => {
                success_count += 1;
                if let Some(data) = result.data {
                    results.push(data);
                }
            }
            Err(e) => {
                fail_count += 1;
                eprintln!("[批量摘要] 失败: {} - {}", slug, e);
            }
        }

        // 避免 API 限流
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    Ok(ok(serde_json::json!({
        "total": success_count + fail_count,
        "success": success_count,
        "failed": fail_count,
        "results": results
    })))
}

/// 生成单个 Skill 的 AI 摘要
fn generate_single_summary(slug: &str) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(slug);
    let skill_md = skill_path.join("SKILL.md");
    
    if !skill_md.exists() {
        return Err(format!("技能文件不存在: {}", slug));
    }
    
    let content = std::fs::read_to_string(&skill_md)
        .map_err(|e| format!("读取文件失败: {e}"))?;
    
    if content.trim().is_empty() {
        return Err(format!("技能文件为空: {}", slug));
    }
    
    let ai_cfg_path = crate::paths::ai_config_path()?;
    let config: AiConfig = read_json_file(&ai_cfg_path);
    
    let mut api_url = config.api_url.as_ref()
        .ok_or("请先在设置中配置 AI API URL")?
        .trim()
        .to_string();
    
    // 自动补全 /chat/completions
    let clean_url = api_url.trim_end_matches('/');
    if !clean_url.ends_with("/chat/completions") {
        api_url = format!("{}/chat/completions", clean_url);
    }
    
    let api_key = config.api_key.as_ref()
        .ok_or("请先在设置中配置 AI API Key")?
        .trim();
    let model = config.model.as_deref().unwrap_or("gpt-4o-mini").trim();
    
    let ai_categories = ["开发工程", "学术研究", "网络信息", "文档数据", "文件系统", "任务规划", "沟通协作", "设计媒体", "Agent 管理", "其他"];
    let system_prompt = "You summarize SKILL.md files for a skill manager. Return only one valid JSON object. All JSON values must be Simplified Chinese. Do not output Markdown, reasoning, or explanations. 不要使用表情符号。";
    
    let user_prompt = format!(
        r#"请直接总结下面这个 SKILL.md 的能力边界，不要总结本请求本身。只输出严格 JSON：
{{"summary":"用简体中文一句话概括能力边界，45字以内","category":"从以下分类中选择一个：{}"}}

{}"#,
        ai_categories.join(", "),
        &content.chars().take(12000).collect::<String>()
    );
    
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "max_tokens": 1200
    });
    
    // 带重试的请求逻辑
    let mut last_err = String::new();
    let mut resp_text = String::new();
    
    for attempt in 1..=3 {
        eprintln!("[请求] 技能 {} 第 {} 次尝试...", slug, attempt);
        
        let mut client_builder = reqwest::blocking::ClientBuilder::new()
            .timeout(std::time::Duration::from_secs(120))
            .connect_timeout(std::time::Duration::from_secs(30))
            .user_agent("Skill-Hub/1.0 (Tauri)")
            .danger_accept_invalid_certs(true);
        
        if let Some(proxy_url) = config.proxy.as_ref() {
            if !proxy_url.trim().is_empty() {
                if let Ok(proxy) = reqwest::Proxy::all(proxy_url.trim()) {
                    client_builder = client_builder.proxy(proxy);
                }
            }
        }
        
        let client = client_builder.build().map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
        
        match client.post(&api_url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Accept", "application/json")
            .json(&body)
            .send() {
                Ok(resp) => {
                    if resp.status().is_success() {
                        resp_text = resp.text().map_err(|e| format!("读取响应体失败: {e}"))?;
                        last_err.clear();
                        break; // 成功
                    } else {
                        last_err = format!("API 返回错误 {}: {}", resp.status(), resp.text().unwrap_or_default().chars().take(200).collect::<String>());
                        eprintln!("[错误] {}", last_err);
                    }
                },
                Err(e) => {
                    last_err = format!("请求失败 (尝试 {}/3): {}", attempt, e);
                    eprintln!("[错误] {}", last_err);
                    // 如果是握手错误，等待一下重试
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
    }
    
    if last_err.contains("请求失败") || last_err.contains("API 返回错误") {
        return Err(last_err);
    }
    
    // 解析响应
    let resp_json: serde_json::Value = serde_json::from_str(&resp_text)
        .map_err(|e| format!("解析响应失败: {}", e))?;
    
    if let Some(err) = resp_json.get("error") {
        return Err(format!("API 返回错误: {}", err));
    }
    
    let raw_content = resp_json.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    
    // 清理 Markdown 代码块 (```json ... ```)
    // 查找 ```json 和 ``` 之间的内容
    let mut json_text = &raw_content[..];
    if let Some(start) = raw_content.find("```json") {
        if let Some(end) = raw_content[start + 7..].find("```") {
            json_text = &raw_content[start + 7..start + 7 + end];
        }
    } else if let Some(start) = raw_content.find("```") {
        if let Some(end) = raw_content[start + 3..].find("```") {
            json_text = &raw_content[start + 3..start + 3 + end];
        }
    }
    
    // 尝试解析 JSON，同时提取 summary 和 category
    let (summary, category) = if let Ok(inner_json) = serde_json::from_str::<serde_json::Value>(json_text) {
        let s = inner_json.get("summary").and_then(|v| v.as_str()).map(|v| v.to_string()).unwrap_or_default();
        let c = inner_json.get("category").and_then(|v| v.as_str()).map(|v| v.to_string()).unwrap_or_default();
        (s, c)
    } else {
        eprintln!("[警告] JSON 解析失败，回退到原始内容: {}", json_text.chars().take(100).collect::<String>());
        (json_text.to_string(), String::new())
    };
    
    if summary.trim().is_empty() {
        return Err("AI 返回内容为空".to_string());
    }
    
    eprintln!("[提取] 技能 {} 摘要: {}, 分类: {}", slug, summary, if category.is_empty() { "无" } else { &category });
    
    // 写入 meta.json
    let meta_path = skill_path.join("meta.json");
    let mut meta: serde_json::Value = if meta_path.exists() {
        let mc = std::fs::read_to_string(&meta_path).unwrap_or_default();
        serde_json::from_str(&mc).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    
    meta["ai_summary"] = serde_json::json!(summary);
    if !category.is_empty() {
        meta["category"] = serde_json::json!(category);
    }
    meta["source_hash"] = serde_json::json!(format!("{:x}", md5::compute(&content)));
    meta["updated_at"] = serde_json::json!(chrono::Utc::now().to_rfc3339());
    
    std::fs::create_dir_all(&skill_path).map_err(|e| format!("创建目录失败: {e}"))?;
    write_json_file(&meta_path, &meta)?;
    
    eprintln!("[成功] 技能 {} 摘要已保存到 meta.json", slug);
    Ok(ok(serde_json::json!({
        "slug": slug,
        "summary": summary,
        "category": category
    })))
}



//// Fetch skill detail HTML from skills.sh and extract Summary section
#[tauri::command]
fn fetch_skill_summary(skill_id: String) -> Result<String, String> {
    let url = format!("https://skills.sh/{}", skill_id);
    let response = reqwest::blocking::get(&url)
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} error", response.status()));
    }

    let html = response.text().map_err(|e| format!("Failed to read response: {}", e))?;

    // 查找 SUMMARY 标题的多种可能形式
    let summary_patterns = ["SUMMARY", "Summary", "summary"];
    let mut content_start_opt = None;

    for pattern in &summary_patterns {
        if let Some(pos) = html.find(pattern) {
            // 往后找到闭合标签
            if let Some(close_pos) = html[pos..].find('>') {
                content_start_opt = Some(pos + close_pos + 1);
                break;
            }
        }
    }

    if let Some(content_start) = content_start_opt {
        // 查找下一个标题（h1/h2/h3）或者取到结尾
        let remaining = &html[content_start..];
        let end_markers = ["<h1", "<h2", "<h3", "<H1", "<H2", "<H3"];

        let mut content_end = remaining.len();
        for marker in &end_markers {
            if let Some(pos) = remaining.find(marker) {
                if pos < content_end {
                    content_end = pos;
                }
            }
        }

        let summary_html = remaining[..content_end].trim();
        if !summary_html.is_empty() {
            return Ok(summary_html.to_string());
        }
    }

    Err("Summary section not found in HTML".to_string())
}

// List all files in a skill directory (multi-file skill support)
#[tauri::command]
fn list_skill_files(slug: String) -> Result<Vec<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
    if !skill_path.exists() {
        return Ok(Vec::new());
    }
    walk_skill_dir(&skill_path, &skill_path, 0)
}

fn walk_skill_dir(
    base: &std::path::Path,
    current: &std::path::Path,
    depth: usize,
) -> Result<Vec<serde_json::Value>, String> {
    if depth > 6 { return Ok(Vec::new()); }
    let mut results = Vec::new();
    let entries = std::fs::read_dir(current).map_err(|e| format!("read dir failed: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".gitignore" { continue; }
        let full = entry.path();
        let relative = full
            .strip_prefix(base)
            .unwrap_or(&full)
            .to_string_lossy()
            .replace('\\', "/");
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            results.push(serde_json::json!({ "relativePath": relative, "content": "", "isDirectory": true }));
            let mut sub = walk_skill_dir(base, &full, depth + 1)?;
            results.append(&mut sub);
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let content = std::fs::read_to_string(&full).unwrap_or_else(|_| "[binary]".to_string());
            results.push(serde_json::json!({ "relativePath": relative, "content": content, "isDirectory": false, "size": size }));
        }
    }
    Ok(results)
}

/// Read a single file from a skill directory
#[tauri::command]
fn read_skill_file(slug: String, relative_path: String) -> Result<Option<String>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
    let Some(full) = safe_skill_child_path(&skill_path, &relative_path) else {
        return Ok(None);
    };
    if !full.exists() || full.is_dir() { return Ok(None); }
    std::fs::read_to_string(&full).map(Some).map_err(|e| format!("read failed: {e}"))
}

/// Write content to a file in a skill directory
#[tauri::command]
fn write_skill_file(slug: String, relative_path: String, content: String) -> Result<bool, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
    let Some(full) = safe_skill_child_path(&skill_path, &relative_path) else {
        return Ok(false);
    };
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    std::fs::write(&full, &content).map_err(|e| format!("write failed: {e}"))?;
    Ok(true)
}

/// Delete a file/dir from a skill directory (never SKILL.md)
#[tauri::command]
fn delete_skill_file(slug: String, relative_path: String) -> Result<bool, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
    if relative_path.is_empty() || relative_path == "." || relative_path.eq_ignore_ascii_case("SKILL.md") {
        return Ok(false);
    }
    let Some(full) = safe_skill_child_path(&skill_path, &relative_path) else {
        return Ok(false);
    };
    if full.exists() {
        if full.is_dir() {
            std::fs::remove_dir_all(&full).map_err(|e| format!("remove dir failed: {e}"))?;
        } else {
            std::fs::remove_file(&full).map_err(|e| format!("remove file failed: {e}"))?;
        }
    }
    Ok(true)
}

/// Scan a skill for safety issues (pattern-based)
#[tauri::command]
fn scan_skill_safety(slug: String) -> Result<Option<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
    let skill_md = skill_path.join("SKILL.md");
    if !skill_md.exists() { return Ok(None); }
    let content = std::fs::read_to_string(&skill_md).map_err(|e| format!("read failed: {e}"))?;
    // Simple pattern-based scan
    let patterns: &[(&str, &str, &str)] = &[
        ("sudo", "warn", "Sudo detected"),
        ("rm -rf", "high", "Recursive delete detected"),
        ("curl | bash", "high", "Curl pipe to shell"),
        ("eval(", "high", "Dynamic code execution"),
        ("chmod 777", "warn", "Insecure permissions"),
        ("--force", "warn", "Force flag detected"),
    ];
    let mut findings = Vec::new();
    for (pattern, severity, title) in patterns {
        if content.to_lowercase().contains(pattern) {
            findings.push(serde_json::json!({
                "code": pattern.replace(" ", "-"),
                "severity": severity,
                "title": title,
                "detail": format!("Pattern '{}' found in SKILL.md", pattern),
            }));
        }
    }
    let score = if findings.iter().any(|f| f["severity"] == "high") { 30 } else if !findings.is_empty() { 65 } else { 95 };
    let level = if score < 40 { "high-risk" } else if score < 80 { "warn" } else { "safe" };
    Ok(Some(serde_json::json!({
        "level": level,
        "summary": format!("Detected {} issues", findings.len()),
        "findings": findings,
        "recommendedAction": if level == "high-risk" { "review" } else { "allow" },
        "scannedAt": chrono::Utc::now().timestamp_millis(),
        "checkedFileCount": 1,
        "scanMethod": "pattern",
        "score": score,
    })))
}

/// Export a skill as SKILL.md or JSON
#[tauri::command]
fn export_skill(slug: String, format: String) -> Result<String, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
    let skill_md = skill_path.join("SKILL.md");
    if !skill_md.exists() {
        return Err(format!("Skill not found: {}", slug));
    }
    let raw = std::fs::read_to_string(&skill_md).map_err(|e| format!("read failed: {e}"))?;

    // Parse frontmatter
    let (name, description) = if raw.starts_with("---") {
        let rest = raw.strip_prefix("---").unwrap_or("");
        let end = rest.find("
---").unwrap_or(0);
        let fm = &rest[..end];
        let n = fm.lines().find(|l| l.starts_with("name:"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().trim_matches('"').to_string())
            .unwrap_or(slug.clone());
        let d = fm.lines().find(|l| l.starts_with("description:"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().trim_matches('"').to_string())
            .unwrap_or_default();
        (n, d)
    } else {
        (slug.clone(), String::new())
    };

    if format == "json" {
        let exported = serde_json::json!({
            "name": name,
            "description": description,
            "instructions": raw,
            "slug": slug,
            "format_version": "1.0",
            "exported_at": chrono::Utc::now().to_rfc3339(),
        });
        Ok(serde_json::to_string_pretty(&exported).unwrap_or_default())
    } else {
        Ok(raw)
    }
}

fn rule_slug_from_name(name: &str) -> String {
    name.trim().to_lowercase().replace(' ', "-")
}

fn normalized_rule_content(content: &str) -> String {
    content
        .replace("\r\n", "\n")
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn rule_content_key(content: &str) -> String {
    let normalized = normalized_rule_content(content);
    format!("{:x}", md5::compute(normalized.as_bytes()))
}

fn infer_rule_name(content: &str) -> String {
    let lower = content.to_lowercase();
    if lower.contains("simplified chinese") || lower.contains("简体中文") {
        return "simplified-chinese".to_string();
    }

    for line in content.lines() {
        let trimmed = line.trim().trim_start_matches('#').trim();
        if trimmed.is_empty() {
            continue;
        }
        let words: String = trimmed
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
            .collect();
        let compact = words
            .split('-')
            .filter(|part| !part.is_empty())
            .take(4)
            .collect::<Vec<_>>()
            .join("-");
        if !compact.is_empty() {
            return compact;
        }
    }

    "imported-rule".to_string()
}

fn unique_rule_slug(dir: &Path, base_slug: &str) -> String {
    let mut candidate = base_slug.to_string();
    let mut index = 2;
    while dir.join(format!("{}.md", candidate)).exists() {
        candidate = format!("{}-{}", base_slug, index);
        index += 1;
    }
    candidate
}

fn find_managed_rule_by_content(dir: &Path, content: &str) -> Result<Option<(String, PathBuf)>, String> {
    if !dir.exists() {
        return Ok(None);
    }
    let target_key = rule_content_key(content);
    for entry in std::fs::read_dir(dir).map_err(|e| format!("read rules dir: {e}"))? {
        let entry = entry.map_err(|e| format!("rule entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() || path.extension().map_or(true, |e| e != "md") {
            continue;
        }
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        if existing.trim().is_empty() {
            continue;
        }
        if rule_content_key(&existing) == target_key {
            let slug = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            return Ok(Some((slug, path)));
        }
    }
    Ok(None)
}

fn ensure_managed_rule_from_content(content: &str) -> Result<Option<(String, PathBuf)>, String> {
    if content.trim().is_empty() {
        return Ok(None);
    }

    let dir = crate::paths::rules_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;

    if let Some(existing) = find_managed_rule_by_content(&dir, content)? {
        return Ok(Some(existing));
    }

    let base_slug = rule_slug_from_name(&infer_rule_name(content));
    let slug = unique_rule_slug(&dir, &base_slug);
    let target = dir.join(format!("{}.md", slug));
    std::fs::write(&target, content).map_err(|e| format!("import native rule: {e}"))?;
    Ok(Some((slug, target)))
}

fn read_rule_content_by_slug(slug: &str) -> Result<Option<String>, String> {
    let managed = crate::paths::rules_dir()?.join(format!("{}.md", slug));
    if managed.exists() {
        return std::fs::read_to_string(&managed).map(Some).map_err(|e| format!("read: {e}"));
    }

    Ok(None)
}

// ---------------------------------------------------------------------------
// Rules commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn list_rules() -> Result<Vec<serde_json::Value>, String> {
    let dir = crate::paths::rules_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let clis = crate::all_existing_cli_rule_paths();
    let mut rows = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut seen_rule_content_keys = std::collections::HashSet::new();
    let rule_clis: &[&str] = &["codex", "claude", "gemini"];

    // 1. Scan managed rules directory
    if dir.exists() {
        for entry in std::fs::read_dir(&dir).map_err(|e| format!("read dir: {e}"))? {
            let entry = entry.map_err(|e| format!("entry: {e}"))?;
            let path = entry.path();
            if !path.is_file() || path.extension().map_or(true, |e| e != "md") { continue; }
            let name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            if content.trim().is_empty() {
                continue;
            }
            let content_key = rule_content_key(&content);
            if seen_rule_content_keys.contains(&content_key) {
                continue;
            }
            seen_rule_content_keys.insert(content_key);
            let preview: String = content.lines()
                .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
                .take(2).collect::<Vec<_>>().join(" ").chars().take(120).collect();
            let mut linked = Vec::new();
            for (cli, paths) in &clis {
                let target_name = crate::rule_file_name_for_cli(cli);
                for p in paths {
                    let target = std::path::PathBuf::from(p).join(target_name);
                    if !target.is_file() {
                        continue;
                    }
                    let target_content = std::fs::read_to_string(&target).unwrap_or_default();
                    if !target_content.trim().is_empty() && rule_content_key(&target_content) == rule_content_key(&content) {
                        linked.push(cli.clone());
                        break;
                    }
                }
            }
            seen.insert(path.clone());
            rows.push(serde_json::json!({
                "name": name, "slug": name.to_lowercase().replace(' ', "-"),
                "preview": preview, "path": path.to_string_lossy(), "linked": linked,
                "scope": "global", "isNative": false,
            }));
        }
    }

    // 2. Scan CLI directories for existing native rule files
    for (cli, paths) in &clis {
        if !rule_clis.contains(&cli.as_str()) { continue; }
        for cli_path in paths {
            let cli_dir = std::path::PathBuf::from(cli_path);
            if !cli_dir.exists() { continue; }
            for fname in crate::rule_file_names_for_cli(cli) {
                let full = cli_dir.join(fname);
                if !full.is_file() { continue; }
                if seen.contains(&full) { continue; }
                if let Ok(meta) = std::fs::symlink_metadata(&full) {
                    if meta.file_type().is_symlink() { continue; }
                }
                let content = std::fs::read_to_string(&full).unwrap_or_default();
                if content.trim().is_empty() {
                    // 空的全局规则文件只表示该 CLI 没有有效规则，不导入集中规则库。
                    continue;
                }
                let preview: String = content.lines()
                    .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
                    .take(2).collect::<Vec<_>>().join(" ").chars().take(120).collect();
                let Some((rule_slug, managed_path)) = ensure_managed_rule_from_content(&content)? else {
                    continue;
                };
                let name = managed_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                let linked = vec![cli.clone()];
                seen.insert(full.clone());

                if let Some(existing) = rows.iter_mut().find(|row| {
                    row.get("slug").and_then(|v| v.as_str()) == Some(rule_slug.as_str())
                }) {
                    if let Some(obj) = existing.as_object_mut() {
                        if let Some(linked_value) = obj.get_mut("linked").and_then(|v| v.as_array_mut()) {
                            if !linked_value.iter().any(|v| v.as_str() == Some(cli.as_str())) {
                                linked_value.push(serde_json::json!(cli));
                            }
                        }
                    }
                    continue;
                }

                rows.push(serde_json::json!({
                    "name": name, "slug": rule_slug,
                    "preview": preview, "path": managed_path.to_string_lossy(), "linked": linked,
                    "scope": "global", "isNative": false,
                }));
            }
        }
    }

    Ok(rows)
}

#[tauri::command]
fn read_rule(slug: String) -> Result<Option<String>, String> {
    read_rule_content_by_slug(&slug)
}

#[tauri::command]
fn write_rule(slug: String, content: String) -> Result<String, String> {
    let dir = crate::paths::rules_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    let p = dir.join(format!("{}.md", slug));
    std::fs::write(&p, &content).map_err(|e| format!("write: {e}"))?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
fn create_rule(name: String, content: String) -> Result<serde_json::Value, String> {
    let dir = crate::paths::rules_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    let slug = name.to_lowercase().replace(' ', "-");
    let p = dir.join(format!("{}.md", slug));
    if p.exists() { return Err(format!("rule already exists: {}", slug)); }
    std::fs::write(&p, if content.is_empty() { format!("# {}

", name) } else { content })
        .map_err(|e| format!("write: {e}"))?;
    Ok(serde_json::json!({ "name": name, "slug": slug, "preview": "", "path": p.to_string_lossy(), "linked": [] }))
}

#[tauri::command]
fn delete_rule(slug: String) -> Result<(), String> {
    let p = crate::paths::rules_dir()?.join(format!("{}.md", slug));
    if p.exists() { std::fs::remove_file(&p).map_err(|e| format!("remove: {e}"))?; }
    Ok(())
}

#[tauri::command]
fn rename_rule(old_slug: String, new_name: String) -> Result<serde_json::Value, String> {
    let dir = crate::paths::rules_dir()?;
    let old_path = dir.join(format!("{}.md", old_slug));
    if !old_path.exists() {
        return Err(format!("规则不存在: {}", old_slug));
    }
    let new_slug = new_name.trim().to_lowercase().replace(' ', "-");
    if new_slug.is_empty() || new_slug == old_slug {
        return Err(format!("新名称无效或与当前名称相同"));
    }
    let new_path = dir.join(format!("{}.md", new_slug));
    if new_path.exists() {
        return Err(format!("目标名称已存在: {}", new_slug));
    }
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(serde_json::json!({
        "oldSlug": old_slug,
        "newSlug": new_slug,
        "newName": new_name.trim(),
        "path": new_path.to_string_lossy()
    }))
}

#[tauri::command]
fn link_rule(slug: String, cli: String) -> Result<String, String> {
    let source = crate::paths::rules_dir()?.join(format!("{}.md", slug));
    if !source.exists() { return Err(format!("rule not found: {}", slug)); }
    let cli_dir = std::path::PathBuf::from(crate::resolve_cli_rule_path(&cli)
        .ok_or_else(|| format!("CLI not found: {}", cli))?);
    if !cli_dir.exists() { std::fs::create_dir_all(&cli_dir).map_err(|e| format!("mkdir: {e}"))?; }
    let target = cli_dir.join(crate::rule_file_name_for_cli(&cli));
    std::fs::copy(&source, &target).map_err(|e| format!("copy rule: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn unlink_rule(slug: String, cli: String) -> Result<bool, String> {
    let source = crate::paths::rules_dir()?.join(format!("{}.md", slug));
    let cli_dir = std::path::PathBuf::from(crate::resolve_cli_rule_path(&cli)
        .unwrap_or_default());
    for fname in crate::rule_file_names_for_cli(&cli) {
        let t = cli_dir.join(fname);
        if let Ok(meta) = std::fs::symlink_metadata(&t) {
            if meta.file_type().is_symlink() {
                if let Ok(real) = std::fs::read_link(&t) {
                    if real == source {
                        let _ = std::fs::remove_file(&t);
                        return Ok(true);
                    }
                }
            }
        }
    }
    Ok(false)
}

#[tauri::command]
fn get_cli_rule_status() -> Result<Vec<serde_json::Value>, String> {
    let all_rules_result = list_rules()?;
    let rule_clis: &[&str] = &["codex", "claude", "gemini"];
    let mut result = Vec::new();

    for cli in rule_clis {
        let cli_str = cli.to_string();

        // 当前规则以实际链接/原生占用状态为准，避免按名称前缀误判其它 CLI 的规则。
        let current_rule = all_rules_result.iter()
            .find(|r| {
                if let Some(linked) = r.get("linked").and_then(|l| l.as_array()) {
                    return linked.iter().any(|v| v.as_str() == Some(&cli_str));
                }
                false
            })
            .cloned();

        // 可切换规则：展示所有 Skill Hub 托管的全局规则。
        let available: Vec<_> = all_rules_result.iter()
            .filter(|r| r.get("scope").and_then(|s| s.as_str()) == Some("global"))
            .filter(|r| r.get("isNative").and_then(|v| v.as_bool()) != Some(true))
            .cloned()
            .collect();

        result.push(serde_json::json!({
            "cli": cli_str,
            "currentRule": current_rule,
            "available": available
        }));
    }

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            get_full_app_state,
            read_config,
            write_config,
            read_ai_config,
            write_ai_config,
            pick_directory,
            project_install,
            open_path,
            link_skill,
            unlink_skill,
            hide_skill,
            unhide_skill,
            delete_skill,
            git_import,
            import_local,

            fetch_skill_summary,
            ai_summarize,

            // Skill file operations
            list_skill_files,
            read_skill_file,
            write_skill_file,
            delete_skill_file,
            scan_skill_safety,
            export_skill,

            // Market API
            search_skills_market,
            install_from_market,

            install_skills_to_project,

            set_visible_clis,
            set_link_mode,

            list_rules,
            read_rule,
            write_rule,
            create_rule,
            delete_rule,
            rename_rule,
            link_rule,
            unlink_rule,
            get_cli_rule_status



        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
