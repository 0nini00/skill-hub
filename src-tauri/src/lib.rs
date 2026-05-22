mod cli_registry;
mod paths;
mod types;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub use cli_registry::*;
pub use paths::*;
pub use types::*;

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
            let slug = path
                .file_name()
                .and_then(|s| s.to_str())
                .map(slug_from_dir_name)
                .unwrap_or_else(|| "unknown".to_string());
            hub_skills.insert(slug, path);
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
                    let slug = sp
                        .file_name()
                        .and_then(|s| s.to_str())
                        .map(slug_from_dir_name)
                        .unwrap_or_else(|| "unknown".to_string());
                    external_skills
                        .entry(slug)
                        .or_insert_with(Vec::new)
                        .push((cli.clone(), sp));
                }
            }
        }
    }

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
fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        let ty = entry.file_type().map_err(|e| format!("获取文件类型失败: {e}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("复制文件失败: {e}"))?;
        }
    }
    Ok(())
}

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

    copy_dir_all(&from_dir, &to_dir)?;

    Ok(ok(serde_json::json!({
        "project": params.project_path,
        "slug": params.slug,
        "installed_to": to_dir.to_string_lossy().to_string()
    })))
}

/// 批量安装技能到项目
/// 批量安装技能到项目（复制文件 + 创建 CLI 链接）
#[tauri::command]
fn install_skills_to_project(project_path: String, slugs: Vec<String>, clis: Vec<String>) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let mut installed = Vec::new();
    let mut errors = Vec::new();
    
    // 1. 复制技能文件到项目的 .skill-hub/skills/
    for slug in &slugs {
        let from_dir = skills_dir.join(slug);
        if !from_dir.exists() {
            errors.push(format!("技能不存在: {}", slug));
            continue;
        }
        
        // 目标目录：项目/.skill-hub/skills/<slug>
        let hub_skills_dir = PathBuf::from(&project_path)
            .join(".skill-hub")
            .join("skills");
        let to_dir = hub_skills_dir.join(slug);
            
        if to_dir.exists() {
            if let Err(e) = fs::remove_dir_all(&to_dir) {
                errors.push(format!("清理旧目录失败 {}: {}", slug, e));
                continue;
            }
        }
        
        if let Err(e) = fs::create_dir_all(&to_dir) {
            errors.push(format!("创建目录失败 {}: {}", slug, e));
            continue;
        }
        
        if let Err(e) = copy_dir_all(&from_dir, &to_dir) {
            errors.push(format!("复制技能失败 {}: {}", slug, e));
            continue;
        }
        
        // 2. 为选中的 CLI 创建链接
        for cli in &clis {
            // 链接目标：项目/.skill-hub/<cli>/skills/<slug>
            let cli_skills_dir = PathBuf::from(&project_path)
                .join(".skill-hub")
                .join(cli)
                .join("skills");
            
            if let Err(e) = fs::create_dir_all(&cli_skills_dir) {
                errors.push(format!("创建 CLI 目录失败 {}: {}", cli, e));
                continue;
            }
            
            let link_target = cli_skills_dir.join(slug);
            
            // 如果链接已存在，先删除
            if link_target.exists() || link_target.is_symlink() {
                let _ = fs::remove_dir_all(&link_target);
            }
            
            // Windows 上创建 Junction
            #[cfg(windows)]
            {
                let output = std::process::Command::new("cmd")
                    .args(&[
                        "/C", "mklink", "/J", 
                        link_target.to_str().unwrap(), 
                        to_dir.to_str().unwrap()
                    ])
                    .output();
                
                if let Err(e) = output {
                    errors.push(format!("创建链接失败 {} -> {}: {}", cli, slug, e));
                } else if !output.unwrap().status.success() {
                    errors.push(format!("创建链接失败 {} -> {}", cli, slug));
                }
            }
            #[cfg(not(windows))]
            {
                // Unix 上的软链接
                use std::os::unix::fs::symlink;
                if let Err(e) = symlink(&to_dir, &link_target) {
                    errors.push(format!("创建链接失败 {} -> {}: {}", cli, slug, e));
                }
            }
        }
        
        installed.push(slug.clone());
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

/// 链接技能到指定 CLI（创建目录 junction/symlink）
#[tauri::command]
fn link_skill(cli: String, slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    use std::os::windows::fs::symlink_dir;

    let hub_dir = crate::paths::skills_dir()?.join(&slug);
    if !hub_dir.exists() {
        return Ok(err(format!("技能不存在: {}", slug)));
    }

    // 查找 CLI 的 skills 目录
    let cli_dir = PathBuf::from(crate::resolve_cli_path(&cli).ok_or_else(|| format!("CLI 目录不存在: {}", cli))?);
    let target = cli_dir.join(&slug);

    // 如果已存在，检查是否是 junction/symlink
    if target.exists() || target.is_symlink() {
        let meta = std::fs::symlink_metadata(&target).map_err(|e| format!("获取元数据失败: {e}"))?;
        if meta.file_type().is_symlink() || meta.file_type().is_dir() {
            // 已是链接或目录，先清理
            std::fs::remove_dir_all(&target).map_err(|e| format!("清理目标失败: {e}"))?;
        }
    }

    // 创建 junction
    #[cfg(windows)]
    {
        // Windows 上优先尝试 cmd /c mklink /J（junction 不需要管理员权限）
        let output = std::process::Command::new("cmd")
            .args(&["/C", "mklink", "/J", target.to_str().unwrap(), hub_dir.to_str().unwrap()])
            .output()
            .map_err(|e| format!("创建 junction 失败: {e}"))?;
        
        if !output.status.success() {
            // 回退到 Rust 内置 symlink_dir（可能需要开发者权限）
            symlink_dir(&hub_dir, &target)
                .map_err(|e| format!("创建 symlink 失败: {e}"))?;
        }
    }

    #[cfg(not(windows))]
    {
        symlink_dir(&hub_dir, &target)
            .map_err(|e| format!("创建 symlink 失败: {e}"))?;
    }

    Ok(ok(serde_json::json!({
        "cli": cli,
        "slug": slug,
        "linked": true
    })))
}

/// 从指定 CLI 取消链接技能（只移除 junction/symlink，绝不删真实文件夹）
#[tauri::command]
fn unlink_skill(cli: String, slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    let cli_dir = PathBuf::from(crate::resolve_cli_path(&cli).ok_or_else(|| format!("CLI 目录不存在: {}", cli))?);
    let target = cli_dir.join(&slug);

    if !target.exists() && !target.is_symlink() {
        return Ok(err(format!("未找到链接: {} / {}", cli, slug)));
    }

    // 安全检查：如果是真实目录（不是 symlink/junction），拒绝删除，避免误删用户数据
    let meta = std::fs::symlink_metadata(&target)
        .map_err(|e| format!("获取元数据失败: {e}"))?;
    
    if !meta.file_type().is_symlink() {
        // 是真实目录，不是链接，不能通过 Skill Hub 移除
        return Ok(err(format!("{} 是真实目录，不是链接。如需移除请手动删除。", slug)));
    }

    // 是 symlink/junction，安全移除
    #[cfg(windows)]
    {
        // Windows 上 junction 用 cmd rmdir 移除（不跟随链接）
        let output = std::process::Command::new("cmd")
            .args(&["/C", "rmdir", target.to_str().unwrap()])
            .output()
            .map_err(|e| format!("移除 junction 失败: {e}"))?;
        
        if !output.status.success() {
            // 回退到 remove_dir_all（只对 symlink 安全）
            std::fs::remove_dir_all(&target)
                .map_err(|e| format!("移除链接失败: {e}"))?;
        }
    }

    #[cfg(not(windows))]
    {
        std::fs::remove_dir_all(&target)
            .map_err(|e| format!("移除链接失败: {e}"))?;
    }

    Ok(ok(serde_json::json!({
        "cli": cli,
        "slug": slug,
        "linked": false
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

/// 删除技能（直接删除目录，Tauri 环境暂未接入回收站）
#[tauri::command]
fn delete_skill(slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
    if !skill_path.exists() {
        return Ok(err(format!("技能不存在: {}", slug)));
    }
    std::fs::remove_dir_all(&skill_path)
        .map_err(|e| format!("删除失败: {e}"))?;
    Ok(ok(serde_json::json!({ "slug": slug })))
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

/// AI 摘要生成（stub，待接入真实 API）
#[tauri::command]
fn ai_summarize(slug: String, _content: String) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);
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

            ai_summarize,



            install_skills_to_project,

            set_visible_clis



        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
