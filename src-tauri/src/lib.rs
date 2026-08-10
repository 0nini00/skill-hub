mod cli_registry;
mod paths;
mod types;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

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
                    log::info!("[读取] {} -> ai_summary: {:?}, summary: {:?}",
                        path.file_name().unwrap_or_default().to_str().unwrap_or("?"),
                        meta.ai_summary, meta.summary);
                    meta
                },
                Err(e) => {
                    log::error!("[读取] {} 解析失败: {}",
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

/// 合法的技能分类(与前端 CATEGORY_OPTIONS 一致,不含「全部」)
const VALID_CATEGORIES: &[&str] = &[
    "开发工程",
    "学术研究",
    "网络信息",
    "文档数据",
    "文件系统",
    "任务规划",
    "沟通协作",
    "设计媒体",
    "Agent 管理",
    "其他",
];

/// 分类关键词表(与前端 categories.ts 的 CATEGORY_KEYWORDS 保持一致)
const CATEGORY_KEYWORDS: &[(&str, &[&str])] = &[
    (
        "开发工程",
        &["code", "coding", "developer", "python", "javascript", "typescript", "api", "cli", "git", "test", "debug", "refactor", "代码", "编程", "开发", "接口", "测试", "调试", "重构"],
    ),
    (
        "学术研究",
        &["academic", "research", "literature", "citation", "paper", "latex", "研究", "文献", "学术", "论文", "综述"],
    ),
    (
        "网络信息",
        &["browser", "web", "website", "fetch", "search", "http", "url", "chrome", "网页", "浏览器", "网络", "搜索"],
    ),
    (
        "文档数据",
        &["document", "docx", "markdown", "spreadsheet", "excel", "csv", "slide", "ppt", "pdf", "notebook", "文档", "表格", "数据", "幻灯片"],
    ),
    (
        "文件系统",
        &["file", "folder", "delete", "disk", "process", "system", "shell", "terminal", "filesystem", "文件", "目录", "删除", "磁盘", "系统", "终端"],
    ),
    (
        "任务规划",
        &["task", "todo", "schedule", "project", "mission", "automation", "reminder", "plan", "任务", "待办", "计划", "项目", "提醒", "自动化"],
    ),
    (
        "沟通协作",
        &["chat", "thread", "message", "send", "reaction", "telegram", "discord", "feishu", "沟通", "协作", "消息", "会话", "发送"],
    ),
    (
        "设计媒体",
        &["image", "photo", "visual", "media", "video", "audio", "voice", "design", "comic", "ui", "ux", "图像", "图片", "视觉", "媒体", "视频", "音频", "设计"],
    ),
    (
        "Agent 管理",
        &["agent", "alma", "memory", "conversation", "config", "智能体", "记忆", "配置"],
    ),
];

/// 去掉 slug 尾部的 `-数字` 后缀(如 web-search-2 -> web-search)
fn strip_slug_numeric_suffix(slug: &str) -> &str {
    if let Some(dash_pos) = slug.rfind('-') {
        let tail = &slug[dash_pos + 1..];
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            return &slug[..dash_pos];
        }
    }
    slug
}

/// 从 slug/name/summary 推断技能分类(前端 inferSkillCategory 的 Rust 移植)
fn infer_skill_category(slug: &str, name: &str, summary: &str) -> String {
    let base_slug = strip_slug_numeric_suffix(slug);
    let mapped = match base_slug {
        "academic-editor" | "literature-search" => "学术研究",
        "adaptive-coder" | "cli-design-framework" | "coding-agent" => "开发工程",
        "browser" | "web-fetch" | "web-search" => "网络信息",
        "file-manager" | "safe-delete" | "system-info" => "文件系统",
        "image-gen" | "ui-ux-pro-max" => "设计媒体",
        "memory-management" | "skill-hub" | "skill-search" => "Agent 管理",
        "mission-control" | "plan-mode" | "scheduler" | "tasks" | "todo" => "任务规划",
        "notebook" => "文档数据",
        "reactions" | "send-file" | "thread-management" => "沟通协作",
        _ => "",
    };
    if !mapped.is_empty() {
        return mapped.to_string();
    }

    let text = format!("{} {} {}", name, slug, summary).to_lowercase();
    for (category, keywords) in CATEGORY_KEYWORDS {
        if keywords.iter().any(|kw| text.contains(kw)) {
            return category.to_string();
        }
    }
    "其他".to_string()
}

fn slug_from_dir_name(name: &str) -> String {
    name.trim().to_lowercase().replace(' ', "-")
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
            // 内容一致时跳过复制，避免仅 mtime 不同导致的级联重复复制
            if !dirs_identical(&newest_src, &hub_target) {
                log::info!("[sync] {} 最新版在 {}，同步到 hub: {:?}", slug, newest_name, hub_target);
                if hub_target.exists() {
                    let _ = std::fs::remove_dir_all(&hub_target);
                }
                if let Err(e) = copy_dir_recursive(&newest_src, &hub_target) {
                    log::error!("[sync] 同步到 hub 失败 {}: {}", slug, e);
                    continue;
                }
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
                // 内容一致时跳过复制（mtime 判断可能误报，需内容兜底）
                if dirs_identical(&hub_skill_path, cli_dir) {
                    continue;
                }
                log::info!("[sync] {} 推送到 {} ({:?})", slug, cli_name, cli_dir);
                if cli_dir.exists() {
                    let _ = std::fs::remove_dir_all(cli_dir);
                }
                if let Err(e) = copy_dir_recursive(&hub_skill_path, cli_dir) {
                    log::error!("[sync] 推送到 {} 失败: {}", cli_name, e);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// get_app_state
// ---------------------------------------------------------------------------

/// 构建完整的应用状态：
/// - 扫描 `~/.config/skill-hub/skills/` 下所有技能
/// - 对每个技能检查在每个已检测 CLI 下是否已启用
/// - 读取 meta.json 获取 summary / category，回退到 SKILL.md
/// - hidden 状态从 config.json 的 hidden_skills 读取
// ---------------------------------------------------------------------------
// get_app_state 缓存：基于目录 mtime 指纹，避免每次全量扫描文件系统
// ---------------------------------------------------------------------------

struct StateCache {
    fingerprint: Vec<(PathBuf, Option<SystemTime>)>,
    built_at: SystemTime,
    state: AppState,
}

static STATE_CACHE: Mutex<Option<StateCache>> = Mutex::new(None);

/// 规则状态缓存：指纹为 rules 目录 + 各 CLI 规则文件（CLAUDE.md/GEMINI.md/AGENTS.md 等）的 mtime。
/// 规则文件数量少，指纹收集成本远低于技能库全量扫描。
struct RuleStatusCache {
    fingerprint: Vec<(PathBuf, Option<SystemTime>)>,
    built_at: SystemTime,
    status: Vec<serde_json::Value>,
}

static RULE_STATUS_CACHE: Mutex<Option<RuleStatusCache>> = Mutex::new(None);

/// 使规则状态缓存失效（规则写命令成功后调用）
fn invalidate_rule_status_cache() {
    if let Ok(mut cache) = RULE_STATUS_CACHE.lock() {
        *cache = None;
    }
}

/// 指纹 + TTL 均满足时返回缓存的规则状态，否则 None
fn rule_status_cache_lookup(fingerprint: &[(PathBuf, Option<SystemTime>)]) -> Option<Vec<serde_json::Value>> {
    let cache = RULE_STATUS_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    cache.as_ref().and_then(|c| {
        if c.fingerprint == fingerprint
            && c.built_at.elapsed().map(|e| e < CACHE_MAX_AGE).unwrap_or(true)
        {
            Some(c.status.clone())
        } else {
            None
        }
    })
}

/// 写入规则状态缓存（含当前时间戳）
fn rule_status_cache_store(fingerprint: Vec<(PathBuf, Option<SystemTime>)>, status: Vec<serde_json::Value>) {
    let mut cache = RULE_STATUS_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    *cache = Some(RuleStatusCache {
        fingerprint,
        built_at: SystemTime::now(),
        status,
    });
}

/// 收集规则状态指纹（可注入 roots 的可测试核心）：
/// rules 目录下所有 .md + 各 CLI 规则文件 mtime。
fn collect_rule_fingerprint_for_roots(
    rules_dir: &Path,
    cli_rule_paths: &std::collections::HashMap<String, Vec<String>>,
) -> Vec<(PathBuf, Option<SystemTime>)> {
    let mut items = Vec::new();

    // rules 托管目录自身 mtime + 目录下所有 .md 文件
    if rules_dir.exists() {
        items.push((rules_dir.to_path_buf(), dir_mtime(rules_dir)));
        if let Ok(entries) = std::fs::read_dir(rules_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().map_or(false, |e| e == "md") {
                    items.push((p.clone(), dir_mtime(&p)));
                }
            }
        }
    }

    // 各 CLI 的规则文件
    for (cli, paths) in cli_rule_paths {
        for p in paths {
            let dir = std::path::PathBuf::from(p);
            items.push((dir.clone(), dir_mtime(&dir)));
            for fname in crate::rule_file_names_for_cli(cli) {
                let f = dir.join(fname);
                items.push((f.clone(), dir_mtime(&f)));
            }
        }
    }

    items.sort();
    items
}

/// 收集规则状态指纹：rules 目录 + 各 CLI 规则文件（CLAUDE.md/GEMINI.md/AGENTS.md 等）mtime。
fn collect_rule_fingerprint() -> Vec<(PathBuf, Option<SystemTime>)> {
    let rules_dir = crate::paths::rules_dir().unwrap_or_default();
    let cli_paths = crate::all_existing_cli_rule_paths();
    collect_rule_fingerprint_for_roots(&rules_dir, &cli_paths)
}

/// 指纹兜底 TTL：某些文件系统（FAT32/网络盘）mtime 精度低，
/// 外部工具同步技能时可能漏检；超过该时长则强制重建。
const CACHE_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(30);

/// 使状态缓存失效（写命令成功后调用）
fn invalidate_state_cache() {
    if let Ok(mut cache) = STATE_CACHE.lock() {
        *cache = None;
    }
}

/// 指纹 + TTL 均满足时返回缓存的 AppState，否则 None
fn cache_is_fresh(cache: &StateCache, fingerprint: &[(PathBuf, Option<SystemTime>)]) -> bool {
    cache.fingerprint == fingerprint
        && cache
            .built_at
            .elapsed()
            .map(|e| e < CACHE_MAX_AGE)
            .unwrap_or(true)
}

/// 尝试从缓存命中返回状态
fn cache_lookup(fingerprint: &[(PathBuf, Option<SystemTime>)]) -> Option<AppState> {
    let cache = STATE_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    cache.as_ref().and_then(|c| {
        if cache_is_fresh(c, fingerprint) {
            Some(c.state.clone())
        } else {
            None
        }
    })
}

/// 写入缓存（含当前时间戳）
fn cache_store(fingerprint: Vec<(PathBuf, Option<SystemTime>)>, state: AppState) {
    let mut cache = STATE_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    *cache = Some(StateCache {
        fingerprint,
        built_at: SystemTime::now(),
        state,
    });
}

fn dir_mtime(p: &Path) -> Option<SystemTime> {
    fs::metadata(p).ok().and_then(|m| m.modified().ok())
}

/// 收集技能目录指纹：目录 mtime + SKILL.md/meta.json mtime。
/// 文件内容变化（AI 摘要写回等）会更新文件 mtime，从而改变指纹。
fn collect_state_fingerprint() -> Vec<(PathBuf, Option<SystemTime>)> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(hub) = skills_dir() {
        roots.push(hub);
    }
    for (_cli, paths) in crate::all_existing_cli_paths() {
        roots.extend(paths.into_iter().map(PathBuf::from));
    }
    collect_fingerprint_for_roots(&roots)
}

/// 对一组技能根目录收集指纹（独立可测的核心逻辑）
fn collect_fingerprint_for_roots(roots: &[PathBuf]) -> Vec<(PathBuf, Option<SystemTime>)> {
    let mut items = Vec::new();
    for root in roots {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    push_dir_fingerprint(&mut items, &path);
                }
            }
        }
    }
    items.sort();
    items
}

fn push_dir_fingerprint(items: &mut Vec<(PathBuf, Option<SystemTime>)>, dir: &Path) {
    items.push((dir.to_path_buf(), dir_mtime(dir)));
    items.push((dir.join("SKILL.md"), dir_mtime(&dir.join("SKILL.md"))));
    items.push((dir.join("meta.json"), dir_mtime(&dir.join("meta.json"))));
}

#[tauri::command]
fn get_app_state() -> Result<AppState, String> {
    let fingerprint = collect_state_fingerprint();
    if let Some(state) = cache_lookup(&fingerprint) {
        return Ok(state);
    }

    let state = build_app_state()?;
    // build_app_state 内可能执行 sync_cli_skills_to_hub 复制文件，
    // 因此构建完成后需重新收集指纹，确保缓存与实际文件状态一致。
    let fingerprint = collect_state_fingerprint();
    cache_store(fingerprint, state.clone());
    Ok(state)
}

/// 全量构建应用状态（缓存未命中时调用）
fn build_app_state() -> Result<AppState, String> {
    ensure_base_dirs()?;
    // 确保自定义 CLI 缓存与磁盘配置一致（启动/刷新时可能刚被修改）
    crate::cli_registry::refresh_custom_cli_cache();

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

        // category 回退:meta.json 未提供合法分类时,从 slug/summary 推断
        let category = category
            .filter(|c| VALID_CATEGORIES.contains(&c.as_str()))
            .or_else(|| Some(infer_skill_category(&slug, &slug, &summary)));

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
// 其他 Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_config() -> Result<SkillHubConfig, String> {
    Ok(read_json_file(&config_path()?))
}

/// 前端回显占位符：read_ai_config 不返回明文 key，write 收到该值时保留磁盘原值。
/// 注意：假设真实 key 不会是 8 个星号（任何真实 API Key 含字母/数字，且长度远超 8）。
const AI_KEY_MASK: &str = "********";
/// 前端“清除 Key”哨兵：写入该值表示用户明确要删除已保存的 key。
/// 与 AI_KEY_MASK 区分——mask 仅由后端回显产生，前端不会主动发送。
/// 注意：同样假设真实 key 不会是 __CLEAR__（该值由前端清除按钮主动发送）。
const AI_KEY_CLEAR: &str = "__CLEAR__";

/// 解析写配置时收到的 api_key，返回真正要落盘的值：
/// - 空 / 占位符 → 保留磁盘原值（前端留空=不修改 key）
/// - __CLEAR__ → 清除（写入 None）
/// - 其他 → 新值直接写入
fn resolve_incoming_api_key(incoming: Option<&str>, existing: Option<String>) -> Option<String> {
    let trimmed = incoming.unwrap_or("").trim();
    if trimmed.is_empty() || trimmed == AI_KEY_MASK {
        existing
    } else if trimmed == AI_KEY_CLEAR {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
fn read_ai_config() -> Result<AiConfig, String> {
    let mut config: AiConfig = read_json_file(&ai_config_path()?);
    // 不回传明文 API Key，仅表示“是否已配置”
    if config.api_key.as_deref().is_some_and(|k| !k.trim().is_empty()) {
        config.api_key = Some(AI_KEY_MASK.to_string());
    }
    Ok(config)
}

#[tauri::command]
fn write_ai_config(config: AiConfig) -> Result<BackendResult<()>, String> {
    let path = ai_config_path()?;
    let existing: AiConfig = read_json_file(&path);
    let mut next = config;
    next.api_key = resolve_incoming_api_key(next.api_key.as_deref(), existing.api_key);
    // 含 API Key 的敏感配置：Unix 上以 0600 权限写入，避免同机其他用户读取
    write_json_file_private(&path, &next)?;
    Ok(ok(()))
}

/// 更新应用配置（矩阵显示列 / 链接模式）。链接模式变更时会批量转换已有技能。
#[tauri::command]
fn update_config(
    visible_clis: Option<String>,
    link_mode: Option<String>,
) -> Result<BackendResult<serde_json::Value>, String> {
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);
    let mut result = serde_json::json!({});

    // 更新矩阵显示列
    if let Some(clis) = visible_clis {
        let parsed: Vec<String> = if clis.is_empty() {
            Vec::new()
        } else {
            clis.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
        };
        config.visible_clis = Some(parsed.clone());
        result["visible_clis"] = serde_json::json!(parsed);
    }

    // 更新链接模式；与当前不同时，保存后批量转换已有技能
    if let Some(mode) = link_mode {
        if mode != "symlink" && mode != "copy" {
            return Ok(err(format!("无效的链接模式: {}，仅支持 symlink 或 copy", mode)));
        }
        let (converted, errors) = if config.link_mode != mode {
            config.link_mode = mode.clone();
            convert_existing_skills(&mode)
        } else {
            (0, Vec::new())
        };
        result["mode"] = serde_json::json!(mode);
        result["converted"] = serde_json::json!(converted);
        result["errors"] = serde_json::json!(errors);
    }

    write_json_file(&cfg_path, &config)?;
    invalidate_state_cache();
    Ok(ok(result))
}

/// 添加自定义 CLI：存用户选择的目录，自动推导 skills 路径（仅参与技能识别，不参与规则管理）。
/// 目录可为 CLI 根目录（自动找 {dir}/skills）或直接是 skills 目录。
#[tauri::command]
fn add_custom_cli(label: String, dir: String) -> Result<BackendResult<serde_json::Value>, String> {
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);

    let dir = dir.trim().to_string();
    if dir.is_empty() {
        return Ok(err("目录不能为空"));
    }
    if !std::path::Path::new(&dir).is_dir() {
        return Ok(err(format!("目录不存在或不可访问: {dir}")));
    }

    // id 由 label 生成 slug；与核心 CLI 或已有自定义 CLI 冲突时追加序号
    let base = if label.trim().is_empty() {
        // 从目录名推断
        std::path::Path::new(&dir)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("custom")
            .to_string()
    } else {
        label.trim().to_string()
    };
    let mut id = slug_from_dir_name(&base);
    let existing = config.custom_clis.clone();
    let mut suffix = 2;
    let original = id.clone();
    while crate::CORE_CLI_NAMES.contains(&id.as_str()) || existing.contains_key(&id) {
        id = format!("{original}-{suffix}");
        suffix += 1;
    }

    let dirs = config.custom_clis.entry(id.clone()).or_default();
    if !dirs.iter().any(|d| d == &dir) {
        dirs.push(dir);
    }

    // 自动加入可见 CLI 列表，让新列在 Skills 矩阵中立即显示
    let mut visible = config.visible_clis.clone().unwrap_or_default();
    if !visible.contains(&id) {
        visible.push(id.clone());
        config.visible_clis = Some(visible);
    }

    write_json_file(&cfg_path, &config)?;
    crate::cli_registry::refresh_custom_cli_cache();
    invalidate_state_cache();
    Ok(ok(serde_json::json!({ "id": id })))
}

/// 移除自定义 CLI（从配置删除，不影响已链接的技能副本）。
#[tauri::command]
fn remove_custom_cli(id: String) -> Result<BackendResult<serde_json::Value>, String> {
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);

    let removed = config.custom_clis.remove(&id).is_some();
    // 同时从可见 CLI 列表中移除，避免矩阵残留空列
    if removed {
        if let Some(visible) = &mut config.visible_clis {
            visible.retain(|c| c != &id);
        }
    }

    write_json_file(&cfg_path, &config)?;
    crate::cli_registry::refresh_custom_cli_cache();
    invalidate_state_cache();
    Ok(ok(serde_json::json!({ "removed": removed })))
}

/// 将各 CLI 中已存在的技能在 copy / symlink 模式间批量转换，返回 (转换数量, 错误列表)
fn convert_existing_skills(mode: &str) -> (usize, Vec<String>) {
    let hub_dir = match crate::paths::skills_dir() {
        Ok(d) => d,
        Err(e) => {
            log::error!("[convert_existing_skills] 读取 skills 目录失败: {e}");
            return (0, Vec::new());
        }
    };
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
                    log::info!("[convert_existing_skills] {} {}/{}", if use_symlink { "symlink" } else { "copy" }, cli_row.cli, slug);
                }
            }
        }
    }

    (converted, errors)
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
            let cli_skills_dir = cli_skills_dir_for_project(&project_path, cli);

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
        invalidate_state_cache();
        Ok(ok(serde_json::json!({
            "installed": installed,
            "project": project_path
        })))
    } else {
        Ok(err(format!("部分安装失败: {}", errors.join("; "))))
    }
}

/// 当前平台用于“在文件管理器中打开路径”的命令名（纯逻辑，可单测）。
fn opener_command_for_current_os() -> Option<&'static str> {
    if cfg!(target_os = "windows") {
        Some("explorer")
    } else if cfg!(target_os = "macos") {
        Some("open")
    } else if cfg!(target_os = "linux") {
        Some("xdg-open")
    } else {
        None
    }
}

/// 在文件管理器中打开指定路径
#[tauri::command]
fn open_path(path: String) -> Result<bool, String> {
    let Some(command) = opener_command_for_current_os() else {
        return Ok(false);
    };
    let status = std::process::Command::new(command)
        .arg(&path)
        .status()
        .map_err(|e| format!("打开路径失败: {e}"))?;
    Ok(status.success())
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
        log::info!("[link_skill] symlink {:?} -> {:?}", hub_dir, target);
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
        log::info!("[link_skill] 复制 {:?} -> {:?}", hub_dir, target);
        copy_dir_recursive(&hub_dir, &target)
            .map_err(|e| format!("复制目录失败: {e}"))?;
    }

    invalidate_state_cache();
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
            // 保留源 mtime：dirs_identical 用元数据对比判断一致性，
            // 若复制后 mtime 不同会导致每次启动都误判为“有变化”而循环复制。
            if let Ok(src_meta) = src_path.metadata() {
                if let Ok(mtime) = src_meta.modified() {
                    // 需要写权限句柄：set_modified 在 Windows 上要求 FILE_WRITE_ATTRIBUTES，
                    // 只读句柄（File::open）会静默失败，导致 mtime 不同而每次启动重复复制。
                    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&dst_path) {
                        let _ = file.set_modified(mtime);
                    }
                }
            }
        }
    }

    Ok(())
}

/// 目录快照条目：相对路径 + 大小 + mtime（+ 符号链接目标）。
/// 只做元数据读取（stat），不读取文件内容——大技能库（含 .git/pack、图片）
/// 全量读内容对比是启动 sync 卡顿的主因，元数据对比可将成本降到毫秒级。
#[derive(Debug, PartialEq, Eq, Clone)]
struct DirSnapshotEntry {
    name: String,
    size: Option<u64>,
    mtime: Option<std::time::SystemTime>,
    link_target: Option<String>,
}

/// 递归收集目录元数据快照（目录项排序保证比较稳定）。
/// 任何元数据不可读都会使整个快照失败（返回 None），调用方保守地走复制路径。
fn collect_dir_snapshot(p: &Path, items: &mut Vec<DirSnapshotEntry>) -> Option<()> {
    let entries = fs::read_dir(p).ok()?;
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    // 排序保证比较顺序稳定（read_dir 顺序不定）
    paths.sort();
    for path in paths {
        let name = path.file_name()?.to_string_lossy().to_string();
        let meta = path.symlink_metadata().ok()?;
        if meta.is_dir() {
            items.push(DirSnapshotEntry {
                name: format!("{}/", name),
                size: None,
                mtime: meta.modified().ok(),
                link_target: None,
            });
            collect_dir_snapshot(&path, items)?;
        } else if meta.is_file() {
            items.push(DirSnapshotEntry {
                name,
                size: Some(meta.len()),
                mtime: meta.modified().ok(),
                link_target: None,
            });
        } else {
            // 符号链接等特殊条目：记录链接目标，参与比较（避免链接 vs 无链接误判一致）
            let target = fs::read_link(&path)
                .map(|t| t.to_string_lossy().to_string())
                .ok();
            items.push(DirSnapshotEntry {
                name: format!("@{}", name),
                size: None,
                mtime: None,
                link_target: target,
            });
        }
    }
    Some(())
}

/// 递归比较两个目录是否一致（文件清单 + 大小 + mtime）。
/// 用于 sync 前跳过无变化的复制。copy_dir_recursive 会保留源 mtime，
/// 因此「内容一致 → 快照一致 → 跳过复制」，不会因复制后 mtime 不同而循环复制。
fn dirs_identical(a: &Path, b: &Path) -> bool {
    let mut left = Vec::new();
    let mut right = Vec::new();
    match (
        collect_dir_snapshot(a, &mut left),
        collect_dir_snapshot(b, &mut right),
    ) {
        (Some(()), Some(())) => left == right,
        // 有一侧读取失败时保守返回 false（走复制路径，保证正确性优先）
        _ => false,
    }
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
            log::info!("[unlink_skill] 删除 {:?}", target);
            match std::fs::remove_dir_all(&target) {
                Ok(()) => removed.push(target.to_string_lossy().to_string()),
                Err(e) => skipped.push(format!("{}: {}", target.to_string_lossy(), e)),
            }
        }
    }

    if removed.is_empty() {
        Ok(err(format!("未找到技能: {} / {}", cli, slug)))
    } else {
        invalidate_state_cache();
        Ok(ok(serde_json::json!({
            "cli": cli,
            "slug": slug,
            "linked": false,
            "removed": removed,
            "skipped": skipped
        })))
    }
}

/// 设置技能的隐藏状态
#[tauri::command]
/// 从所有已检测 CLI 的 skills 目录中删除指定技能副本（hub 库不受影响）。
/// 返回成功移除副本的 CLI 名列表。
fn remove_skill_from_all_clis(slug: &str) -> Vec<String> {
    let mut removed_clis = Vec::new();
    for cli_row in crate::cli_registry::scan_all_clis() {
        for cli_path in crate::cli_registry::existing_cli_paths(&cli_row.cli) {
            let target = PathBuf::from(&cli_path).join(slug);
            if target.exists() || target.is_symlink() {
                log::info!("[set_skill_hidden] 从 {} 移除副本 {:?}", cli_row.cli, target);
                match std::fs::remove_dir_all(&target) {
                    Ok(()) => {
                        if !removed_clis.contains(&cli_row.cli) {
                            removed_clis.push(cli_row.cli.clone());
                        }
                    }
                    Err(e) => log::warn!("[set_skill_hidden] 移除副本失败 {:?}: {e}", target),
                }
            }
        }
    }
    removed_clis
}

#[tauri::command]
fn set_skill_hidden(slug: String, hidden: bool) -> Result<BackendResult<serde_json::Value>, String> {
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);
    if hidden {
        if !config.hidden_skills.contains(&slug) {
            config.hidden_skills.push(slug.clone());
        }
        // 隐藏时同时从所有已链接 CLI 目录移除该技能副本（hub 库保留）
        let removed_clis = remove_skill_from_all_clis(&slug);
        write_json_file(&cfg_path, &config)?;
        invalidate_state_cache();
        Ok(ok(serde_json::json!({
            "slug": slug,
            "hidden": hidden,
            "removedClis": removed_clis
        })))
    } else {
        config.hidden_skills.retain(|s| s != &slug);
        write_json_file(&cfg_path, &config)?;
        invalidate_state_cache();
        Ok(ok(serde_json::json!({ "slug": slug, "hidden": hidden })))
    }
}

/// 删除技能（仅删除 Hub 管理的技能，并清理配置中的隐藏标记）
#[tauri::command]
fn delete_skill(slug: String) -> Result<BackendResult<serde_json::Value>, String> {
    log::info!("[delete_skill] 开始删除技能: {}", slug);

    let skills_dir = crate::paths::skills_dir()?;
    let skill_path = skills_dir.join(&slug);

    log::info!("[delete_skill] 检查路径: {:?}", skill_path);

    // 只删除 Hub 管理的技能（位于 ~/.config/skill-hub/skills/）
    if !skill_path.exists() {
        log::info!("[delete_skill] 技能不在 Hub 目录中，无法删除");
        return Ok(err(format!("该技能不在 Skill Hub 管理目录中，无法删除")));
    }

    log::info!("[delete_skill] 删除目录: {:?}", skill_path);
    std::fs::remove_dir_all(&skill_path)
        .map_err(|e| {
            log::error!("[delete_skill] 删除失败: {}", e);
            format!("删除失败: {e}")
        })?;
    log::info!("[delete_skill] 目录删除成功");

    // 清理配置中的隐藏标记
    let cfg_path = crate::paths::config_path()?;
    let mut config: SkillHubConfig = read_json_file(&cfg_path);
    let before_count = config.hidden_skills.len();
    config.hidden_skills.retain(|s| s != &slug);
    let after_count = config.hidden_skills.len();

    log::info!("[delete_skill] 隐藏标记清理: {} -> {}", before_count, after_count);

    write_json_file(&cfg_path, &config)?;

    // 清理所有 CLI 目录中的技能副本
    let mut cli_removed: Vec<String> = Vec::new();
    for (_cli_name, cli_paths) in &crate::get_cli_definitions() {
        for cli_path_str in cli_paths {
            let target = PathBuf::from(cli_path_str).join(&slug);
            if target.exists() || target.is_symlink() {
                log::info!("[delete_skill] 清理 CLI 副本: {:?}", target);
                if let Err(e) = std::fs::remove_dir_all(&target) {
                    log::error!("[delete_skill] 清理失败 {:?}: {}", target, e);
                } else {
                    cli_removed.push(target.to_string_lossy().to_string());
                }
            }
        }
    }

    invalidate_state_cache();
    log::info!("[delete_skill] 删除成功: {} (CLI 清理: {:?})", slug, cli_removed);
    Ok(ok(serde_json::json!({
        "slug": slug,
        "cli_cleaned": cli_removed
    })))
}

/// 从文本中抹去敏感串（如 API Key），防止异常 API 网关在错误响应体里回显请求头时泄露。
/// 返回替换后的新字符串；原文本不含敏感串时原样返回。
/// 替换标记用 [REDACTED]，与配置回显占位符 ******** 区分，日志中一目了然。
fn redact_sensitive(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for secret in secrets {
        if !secret.trim().is_empty() {
            out = out.replace(secret, "[REDACTED]");
        }
    }
    out
}

/// 脱敏代理 URL：去掉 user:pass@ 凭据部分（`http://user:pass@host:port` → `http://host:port`）。
/// 避免代理账号密码泄露到日志。
/// 注意：假设代理 URL 的 @ 仅出现在凭据段（代理配置一般无带 @ 的路径段）。
fn mask_proxy_url(url: &str) -> String {
    let trimmed = url.trim();
    // 找到 scheme 后的 @ 前的凭据段
    let scheme_end = trimmed.find("://").map(|i| i + 3).unwrap_or(0);
    let rest = &trimmed[scheme_end..];
    match rest.find('@') {
        Some(at) => {
            let host_part = &rest[at + 1..];
            format!("{}{}", &trimmed[..scheme_end], host_part)
        }
        None => trimmed.to_string(),
    }
}

/// 从 Git URL 提取技能 slug（纯逻辑，可单测）。
/// 取最后一段路径、去 .git 后缀（恰好一次）、小写化、空格转连字符；
/// 空/纯斜杠/剥离后为空 的 URL 回退 "unknown"。
fn git_slug_from_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed
        .split('/')
        .last()
        .unwrap_or("")
        .trim();
    if last.is_empty() {
        return "unknown".to_string();
    }
    let slug = last
        .strip_suffix(".git")
        .unwrap_or(last)
        .to_lowercase()
        .replace(' ', "-");
    if slug.is_empty() {
        "unknown".to_string()
    } else {
        slug
    }
}

/// 计算项目下某个 CLI 的 skills 目录（纯逻辑，可单测）：{project}/.{cli}/skills
fn cli_skills_dir_for_project(project_path: &str, cli: &str) -> PathBuf {
    PathBuf::from(project_path).join(format!(".{}/skills", cli))
}

/// 从 Git URL 导入技能
#[tauri::command]
fn git_import(url: String) -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;
    std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建目录失败: {e}"))?;

    let slug = git_slug_from_url(&url);

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
            // 日志仅输出脱敏地址，避免 user:pass@ 形式的代理凭据泄露
            log::info!("[Git] 使用代理: {}", mask_proxy_url(proxy_url));
            cmd.arg("-c").arg(format!("http.proxy={}", proxy_url.trim()));
            cmd.arg("-c").arg(format!("https.proxy={}", proxy_url.trim()));
        }
    }

    let target_str = target_dir
        .to_str()
        .ok_or_else(|| "目标目录路径不是有效 UTF-8，无法执行 git clone".to_string())?;
    let output = cmd
        .args(&["clone", "--depth", "1", &url, target_str])
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

    invalidate_state_cache();
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

    invalidate_state_cache();
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

    invalidate_state_cache();
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

    invalidate_state_cache();
    invalidate_rule_status_cache();
    Ok(ok(serde_json::json!({
        "type": "rule",
        "name": slug
    })))
}

/// AI 摘要生成：slug 为空时批量处理所有 Hub Skills，否则只处理单个技能
#[tauri::command]
async fn ai_summarize(slug: String, _content: String) -> Result<BackendResult<serde_json::Value>, String> {
    // 如果 slug 为空，批量处理所有 Hub Skills
    if slug.is_empty() {
        return tokio::task::spawn_blocking(|| batch_ai_summarize()).await
            .map_err(|e| format!("异步任务失败: {}", e))?;
    }

    // 否则处理单个 Skill
    let result = tokio::task::spawn_blocking(move || generate_single_summary(&slug)).await
        .map_err(|e| format!("异步任务失败: {}", e))??;
    // 单技能摘要成功写入 meta.json 后失效缓存
    if result.ok {
        invalidate_state_cache();
    }
    Ok(result)
}

/// 批量生成所有 Hub Skills 的 AI 摘要
/// 批量摘要并发窗口：同时处理的技能数。
/// 注意：并发会提高峰值请求速率（约 3 倍），各 worker 的 500ms 限流间隔是独立计时的，
/// 不再保证串行场景下的严格请求间隔——若目标 API 对并发敏感，可调低此值。
const BATCH_SUMMARY_CONCURRENCY: usize = 3;

/// worker 分片：第 i 个 worker 处理下标 i, i+workers, i+2*workers...（全覆盖且均衡）
fn batch_slice(worker: usize, workers: usize, total: usize) -> Vec<usize> {
    (worker..total).step_by(workers).collect()
}

fn batch_ai_summarize() -> Result<BackendResult<serde_json::Value>, String> {
    let skills_dir = crate::paths::skills_dir()?;

    // 先收集所有技能 slug，避免并发中迭代目录
    let mut slugs: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(&skills_dir)
        .map_err(|e| format!("读取技能目录失败: {e}"))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let slug = path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        if !slug.is_empty() {
            slugs.push(slug);
        }
    }

    let total = slugs.len();
    let success = std::sync::atomic::AtomicUsize::new(0);
    let fail = std::sync::atomic::AtomicUsize::new(0);
    let results = Mutex::new(Vec::new());

    // 固定并发窗口：worker 按步长分片抓取 slug，天然均衡且无需任务队列。
    // results 按 worker 完成顺序收集（非 slug 顺序，前端只消费计数不依赖顺序）。
    let workers = BATCH_SUMMARY_CONCURRENCY.min(total).max(1);
    std::thread::scope(|scope| {
        for worker in 0..workers {
            let results = &results;
            let success = &success;
            let fail = &fail;
            let slugs = &slugs;
            let indices = batch_slice(worker, workers, total);
            scope.spawn(move || {
                for i in indices {
                    let slug = &slugs[i];
                    log::info!("[批量摘要] 正在处理: {}", slug);
                    match generate_single_summary(slug) {
                        Ok(result) => {
                            success.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            if let Some(data) = result.data {
                                results.lock().unwrap_or_else(|p| p.into_inner()).push(data);
                            }
                        }
                        Err(e) => {
                            fail.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            log::error!("[批量摘要] 失败: {} - {}", slug, e);
                        }
                    }
                    // 避免 API 限流（每个 worker 独立间隔）
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            });
        }
    });

    // 批量结束后统一失效一次（generate_single_summary 不再各自失效，避免 N 次无效失效）
    invalidate_state_cache();

    Ok(ok(serde_json::json!({
        "total": success.load(std::sync::atomic::Ordering::Relaxed)
            + fail.load(std::sync::atomic::Ordering::Relaxed),
        "success": success.load(std::sync::atomic::Ordering::Relaxed),
        "failed": fail.load(std::sync::atomic::Ordering::Relaxed),
        "results": results.into_inner().unwrap_or_else(|p| p.into_inner())
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
        log::info!("[请求] 技能 {} 第 {} 次尝试...", slug, attempt);

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
                        // 错误响应体可能被异常网关回显请求头（含 Authorization），写日志前脱敏
                        let status = resp.status();
                        let body = resp.text().unwrap_or_default().chars().take(200).collect::<String>();
                        last_err = format!("API 返回错误 {}: {}", status, redact_sensitive(&body, &[api_key]));
                        log::error!("[错误] {}", redact_sensitive(&last_err, &[api_key]));
                    }
                },
                Err(e) => {
                    last_err = format!("请求失败 (尝试 {}/3): {}", attempt, e);
                    log::error!("[错误] {}", redact_sensitive(&last_err, &[api_key]));
                    // 如果是握手错误，等待一下重试
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            }
    }

    if last_err.contains("请求失败") || last_err.contains("API 返回错误") {
        return Err(redact_sensitive(&last_err, &[api_key]));
    }

    // 解析响应
    let resp_json: serde_json::Value = serde_json::from_str(&resp_text)
        .map_err(|e| redact_sensitive(&format!("解析响应失败: {}", e), &[api_key]))?;

    if let Some(err) = resp_json.get("error") {
        return Err(redact_sensitive(&format!("API 返回错误: {}", err), &[api_key]));
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
        log::error!("[警告] JSON 解析失败，回退到原始内容: {}", json_text.chars().take(100).collect::<String>());
        (json_text.to_string(), String::new())
    };

    if summary.trim().is_empty() {
        return Err("AI 返回内容为空".to_string());
    }

    log::info!("[提取] 技能 {} 摘要: {}, 分类: {}", slug, summary, if category.is_empty() { "无" } else { &category });

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

    log::info!("[成功] 技能 {} 摘要已保存到 meta.json", slug);
    Ok(ok(serde_json::json!({
        "slug": slug,
        "summary": summary,
        "category": category
    })))
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
    let rule_clis = crate::rule_cli_names();

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
        if !rule_clis.contains(cli) { continue; }
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

/// 将托管规则的新内容同步到所有「当前链接该规则」的 CLI 副本。
/// 识别依据与 list_rules 一致：CLI 规则文件内容 key == 旧托管内容 key。
/// 这样编辑规则后 CLI 副本立即同步，list_rules 不会把旧副本误导入为新规则（新旧并存）。
/// sync 为 None 时表示删除场景：直接移除 CLI 副本，避免残留空文件。
fn sync_rule_to_linked_clis(old_content_key: &str, new_content: Option<&str>) {
    let clis = crate::all_existing_cli_rule_paths();
    for (cli, paths) in &clis {
        let target_name = crate::rule_file_name_for_cli(cli);
        for p in paths {
            let target = std::path::PathBuf::from(p).join(target_name);
            if !target.is_file() {
                continue;
            }
            if let Ok(existing) = std::fs::read_to_string(&target) {
                // 空文件视为「该 CLI 未启用规则」（与 list_rules 语义一致），
                // 不参与同步，避免误覆盖/误删用户的空规则文件。
                if existing.trim().is_empty() {
                    continue;
                }
                if rule_content_key(&existing) == old_content_key {
                    match new_content {
                        Some(content) => {
                            log::debug!("[rule-sync] 同步规则到 CLI 副本: {:?}", target);
                            let _ = std::fs::write(&target, content);
                        }
                        None => {
                            log::debug!("[rule-sync] 删除 CLI 规则副本: {:?}", target);
                            let _ = std::fs::remove_file(&target);
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn write_rule(slug: String, content: String) -> Result<String, String> {
    let dir = crate::paths::rules_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    let p = dir.join(format!("{}.md", slug));
    // 记录旧内容 key，用于识别哪些 CLI 副本链接了本规则
    let old_content = std::fs::read_to_string(&p).unwrap_or_default();
    let old_key = rule_content_key(&old_content);
    std::fs::write(&p, &content).map_err(|e| format!("write: {e}"))?;
    sync_rule_to_linked_clis(&old_key, Some(&content));
    invalidate_rule_status_cache();
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
    invalidate_rule_status_cache();
    Ok(serde_json::json!({ "name": name, "slug": slug, "preview": "", "path": p.to_string_lossy(), "linked": [] }))
}

#[tauri::command]
fn delete_rule(slug: String) -> Result<(), String> {
    let dir = crate::paths::rules_dir()?;
    let p = dir.join(format!("{}.md", slug));
    let old_content = std::fs::read_to_string(&p).unwrap_or_default();
    let old_key = rule_content_key(&old_content);
    if p.exists() { std::fs::remove_file(&p).map_err(|e| format!("remove: {e}"))?; }
    // 同步删除链接该规则的 CLI 副本，避免 list_rules 将残留副本导入为新规则
    sync_rule_to_linked_clis(&old_key, None);
    invalidate_rule_status_cache();
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
    invalidate_rule_status_cache();
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
    invalidate_rule_status_cache();
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
/// 全量构建规则状态（list_rules 内可能将原生规则写入 rules 托管目录）
fn build_cli_rule_status() -> Result<Vec<serde_json::Value>, String> {
    let all_rules_result = list_rules()?;
    let rule_clis = crate::rule_cli_names();
    let mut result = Vec::new();

    for cli in &rule_clis {
        let cli_str = cli.clone();

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

#[tauri::command]
fn get_cli_rule_status() -> Result<Vec<serde_json::Value>, String> {
    let fingerprint = collect_rule_fingerprint();
    if let Some(status) = rule_status_cache_lookup(&fingerprint) {
        return Ok(status);
    }

    let status = build_cli_rule_status()?;
    // build 过程中 list_rules 可能写入规则文件（ensure_managed_rule_from_content），
    // 构建完成后需重新收集指纹，确保缓存与实际文件状态一致。
    let fingerprint = collect_rule_fingerprint();
    rule_status_cache_store(fingerprint, status.clone());
    Ok(status)
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
            read_config,
            read_ai_config,
            write_ai_config,
            update_config,
            add_custom_cli,
            remove_custom_cli,
            open_path,
            link_skill,
            unlink_skill,
            set_skill_hidden,
            delete_skill,
            git_import,
            import_local,
            ai_summarize,
            install_skills_to_project,
            list_rules,
            read_rule,
            write_rule,
            create_rule,
            delete_rule,
            rename_rule,
            link_rule,
            get_cli_rule_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

