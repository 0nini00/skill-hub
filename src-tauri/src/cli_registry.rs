use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;

use crate::paths::{config_path, read_json_file, user_home_dir};
use crate::types::{CliRow, CustomCliMap, SkillHubConfig};

/// 自定义 CLI 缓存：避免在热循环（is_skill_linked_any 等）中反复读 config.json。
/// add/remove_custom_cli 与 build_app_state 会调用 refresh_custom_cli_cache() 刷新。
static CUSTOM_CLI_CACHE: Mutex<Option<CustomCliMap>> = Mutex::new(None);

/// 刷新自定义 CLI 缓存（配置变更后调用）。
pub fn refresh_custom_cli_cache() {
    let config: SkillHubConfig = read_json_file(&config_path().unwrap_or_default());
    *CUSTOM_CLI_CACHE.lock().unwrap() = Some(config.custom_clis);
}

/// 读取自定义 CLI 映射（cli_id -> 目录列表），带内存缓存。
fn custom_clis() -> CustomCliMap {
    let mut guard = CUSTOM_CLI_CACHE.lock().unwrap();
    if guard.is_none() {
        let config: SkillHubConfig = read_json_file(&config_path().unwrap_or_default());
        *guard = Some(config.custom_clis);
    }
    guard.clone().unwrap_or_default()
}

/// 核心 CLI 列表
pub const CORE_CLI_NAMES: &[&str] = &["claude", "codex", "gemini", "cursor"];

/// 有规则管理能力的 CLI（规则矩阵/状态只展示这些，与技能管理无关）
pub const RULE_CLI_NAMES: &[&str] = &["codex", "claude", "gemini"];

/// 核心 CLI 定义：每个 CLI 名映射到其 skills 目录的可能路径列表
pub fn get_cli_definitions() -> HashMap<String, Vec<String>> {
    let home = match user_home_dir() {
        Ok(h) => h,
        Err(_) => return HashMap::new(),
    };
    let home_str = home.to_string_lossy();

    let mut definitions: HashMap<String, Vec<String>> = HashMap::new();

    // claude
    definitions.insert(
        "claude".to_string(),
        vec![
            format!("{}/.claude/skills", home_str),
            format!("{}/AppData/Roaming/Claude/skills", home_str),
            format!("{}/.config/claude/skills", home_str),
        ],
    );

    // codex
    definitions.insert(
        "codex".to_string(),
        vec![
            format!("{}/.codex/skills", home_str),
            format!("{}/.config/codex/skills", home_str),
        ],
    );

    // gemini
    definitions.insert(
        "gemini".to_string(),
        vec![
            format!("{}/.gemini/skills", home_str),
            format!("{}/.config/gemini/skills", home_str),
        ],
    );

    // cursor
    definitions.insert(
        "cursor".to_string(),
        vec![format!("{}/.cursor/skills", home_str)],
    );

    // 自定义 CLI：skills 候选 = {dir}/skills 优先；{dir} 本身仅当包含含 SKILL.md 的子目录时兑底，
    // 避免把任意子目录（会话/缓存等）误当技能同步进 hub。
    // 与核心 CLI 同名时保留核心定义，避免手动编辑 config.json 导致核心 CLI 被覆盖。
    for (id, dirs) in custom_clis() {
        if definitions.contains_key(&id) {
            continue;
        }
        let mut candidates = Vec::new();
        for d in dirs {
            let base = std::path::Path::new(&d);
            candidates.push(base.join("skills").to_string_lossy().to_string());
            // 仅当该目录看起来是 skills 目录（至少一个子目录含 SKILL.md）时才作为候选
            if looks_like_skills_dir(base) {
                candidates.push(d);
            }
        }
        definitions.insert(id, candidates);
    }

    definitions
}

/// 核心 CLI 定义：每个 CLI 名映射到其 rules 根目录的可能路径列表
/// 注意：rules 文件位于 CLI 根目录，不在 skills 子目录中。
pub fn get_cli_rule_definitions() -> HashMap<String, Vec<String>> {
    let home = match user_home_dir() {
        Ok(h) => h,
        Err(_) => return HashMap::new(),
    };
    let home_str = home.to_string_lossy();

    let mut definitions: HashMap<String, Vec<String>> = HashMap::new();

    definitions.insert(
        "claude".to_string(),
        vec![
            format!("{}/.claude", home_str),
            format!("{}/AppData/Roaming/Claude", home_str),
            format!("{}/.config/claude", home_str),
        ],
    );

    definitions.insert(
        "codex".to_string(),
        vec![
            format!("{}/.codex", home_str),
            format!("{}/.config/codex", home_str),
        ],
    );

    definitions.insert(
        "gemini".to_string(),
        vec![
            format!("{}/.gemini", home_str),
            format!("{}/.config/gemini", home_str),
        ],
    );

    // cursor
    definitions.insert(
        "cursor".to_string(),
        vec![format!("{}/.cursor", home_str)],
    );

    // 注意：自定义 CLI 只参与 skills 识别，不参与规则管理。
    // 规则矩阵/状态仅面向内置 codex/claude/gemini。
    definitions
}

/// 获取规则管理涉及的 CLI 名称（仅内置规则 CLI，不含自定义 CLI）。
pub fn rule_cli_names() -> Vec<String> {
    RULE_CLI_NAMES.iter().map(|s| s.to_string()).collect()
}

/// 获取 CLI 的主规则文件名，用于创建/切换托管规则链接。
pub fn rule_file_name_for_cli(cli: &str) -> &'static str {
    match cli {
        "claude" => "CLAUDE.md",
        "gemini" => "GEMINI.md",
        _ => "AGENTS.md",
    }
}

/// 获取 CLI 扫描时允许识别的规则文件名。
/// 主文件名放在第一位，兼容文件名用于识别历史或跨 CLI 规则文件。
pub fn rule_file_names_for_cli(cli: &str) -> Vec<&'static str> {
    match cli {
        "claude" => vec!["CLAUDE.md", "AGENTS.md"],
        "gemini" => vec!["GEMINI.md", "AGENTS.md"],
        "codex" => vec!["AGENTS.md"],
        _ => vec!["AGENTS.md"],
    }
}

/// 获取所有已存在 CLI 的 skills 目录路径（每个 CLI 可能有多个）。
pub fn all_existing_cli_paths() -> HashMap<String, Vec<String>> {
    existing_cli_paths_map(&get_cli_definitions())
}

/// 获取所有已存在 CLI 的 rules 根目录路径（每个 CLI 可能有多个）。
pub fn all_existing_cli_rule_paths() -> HashMap<String, Vec<String>> {
    existing_cli_paths_map(&get_cli_rule_definitions())
}

/// 扫描所有已存在且包含 skills 目录的 CLI，返回所有检测到的 CLI 行。
/// 对每个核心 CLI，取其第一个存在的 skills 目录路径；自定义 CLI 同样处理。
pub fn scan_all_clis() -> Vec<CliRow> {
    let definitions = get_cli_definitions();
    let mut rows = Vec::new();

    for cli_name in CORE_CLI_NAMES {
        if let Some(paths) = definitions.get(*cli_name) {
            // 找到第一个存在的路径
            if let Some(existing_path) = paths.iter().find(|p| path_exists(p)) {
                rows.push(CliRow {
                    cli: cli_name.to_string(),
                    path: existing_path.clone(),
                });
            }
        }
    }

    // 自定义 CLI（按 id 排序保证顺序稳定）
    let mut custom_ids: Vec<String> = custom_clis().into_keys().collect();
    custom_ids.sort();
    for id in custom_ids {
        if let Some(paths) = definitions.get(&id) {
            if let Some(existing_path) = paths.iter().find(|p| path_exists(p)) {
                rows.push(CliRow {
                    cli: id,
                    path: existing_path.clone(),
                });
            }
        }
    }

    rows
}

/// 获取指定 CLI 当前系统中“所有存在的” skills 目录路径
/// 用于扫描技能（因为同一个 CLI 可能有多个候选路径同时存在）
pub fn existing_cli_paths(cli: &str) -> Vec<String> {
    existing_paths(&get_cli_definitions(), cli)
}

/// 解析指定 CLI 的 skills 目录路径
/// 如果 CLI 存在，返回实际路径；否则返回第一个候选路径
pub fn resolve_cli_path(cli: &str) -> Option<String> {
    resolve_cli_dir(&get_cli_definitions(), cli)
}

/// 解析指定 CLI 的 rules 根目录。
pub fn resolve_cli_rule_path(cli: &str) -> Option<String> {
    resolve_cli_dir(&get_cli_rule_definitions(), cli)
}

/// 从定义中筛选出所有已存在路径的 CLI 映射，按核心 CLI 顺序优先。
fn existing_cli_paths_map(definitions: &HashMap<String, Vec<String>>) -> HashMap<String, Vec<String>> {
    let mut result: HashMap<String, Vec<String>> = HashMap::new();
    for cli_name in CORE_CLI_NAMES {
        let existing = existing_paths(definitions, cli_name);
        if !existing.is_empty() {
            result.insert(cli_name.to_string(), existing);
        }
    }
    // 自定义 CLI
    let mut custom_ids: Vec<String> = custom_clis().into_keys().collect();
    custom_ids.sort();
    for id in custom_ids {
        let existing = existing_paths(definitions, &id);
        if !existing.is_empty() {
            result.insert(id, existing);
        }
    }
    result
}

/// 从定义中筛选出某个 CLI 当前已存在的路径。
fn existing_paths(definitions: &HashMap<String, Vec<String>>, cli: &str) -> Vec<String> {
    definitions
        .get(cli)
        .map(|paths| paths.iter().filter(|p| path_exists(p)).cloned().collect())
        .unwrap_or_default()
}

/// 解析指定 CLI 的目录：优先已存在的路径，其次父目录存在的路径，最后第一个候选。
fn resolve_cli_dir(definitions: &HashMap<String, Vec<String>>, cli: &str) -> Option<String> {
    let paths = definitions.get(cli)?;

    // 优先返回已存在的路径
    if let Some(existing) = paths.iter().find(|p| path_exists(p)) {
        return Some(existing.clone());
    }
    // 其次返回父目录存在的路径
    if let Some(parent_exists) = paths.iter().find(|p| {
        if let Some(parent) = std::path::Path::new(p).parent() {
            parent.exists()
        } else {
            false
        }
    }) {
        return Some(parent_exists.clone());
    }
    // 最后返回第一个候选
    paths.first().cloned()
}

fn path_exists(p: &str) -> bool {
    fs::metadata(p).is_ok()
}

/// 判断目录是否“看起来像 skills 目录”：存在至少一个子目录内含 SKILL.md。
/// 用于自定义 CLI 的 {dir} 回退，避免把配置/会话/缓存目录误当技能目录。
fn looks_like_skills_dir(dir: &std::path::Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let mut any = false;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        if p.join("SKILL.md").is_file() || p.join("skill.md").is_file() {
            any = true;
            break;
        }
    }
    any
}

/// 检查路径是否为符号链接或 junction 点
/// 使用 symlink_metadata 避免跟随链接
pub fn is_symlink_or_junction(path: &std::path::Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(meta) => meta.file_type().is_symlink(),
        Err(_) => false,
    }
}

/// 检查指定技能（slug）是否存在于某个 CLI 的任意 skills 目录中
pub fn is_skill_linked_any(cli: &str, skill_slug: &str) -> bool {
    for p in existing_cli_paths(cli) {
        let skill_path = std::path::Path::new(&p).join(skill_slug);
        if skill_path.exists() && skill_path.is_dir() {
            return true;
        }
    }
    false
}
