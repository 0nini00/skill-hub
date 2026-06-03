use std::collections::HashMap;
use std::fs;

use crate::paths::user_home_dir;
use crate::types::CliRow;

/// 只支持三个核心 CLI
pub const CORE_CLI_NAMES: &[&str] = &["claude", "codex", "gemini"];

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

    definitions
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

/// 获取所有已存在 CLI 的 rules 根目录路径（每个 CLI 可能有多个）。
pub fn all_existing_cli_rule_paths() -> HashMap<String, Vec<String>> {
    let definitions = get_cli_rule_definitions();
    let mut result: HashMap<String, Vec<String>> = HashMap::new();

    for cli_name in CORE_CLI_NAMES {
        if let Some(paths) = definitions.get(*cli_name) {
            let existing: Vec<String> = paths.iter().filter(|p| path_exists(p)).cloned().collect();
            if !existing.is_empty() {
                result.insert(cli_name.to_string(), existing);
            }
        }
    }

    result
}

/// 解析指定 CLI 的 rules 根目录。
pub fn resolve_cli_rule_path(cli: &str) -> Option<String> {
    let definitions = get_cli_rule_definitions();
    let paths = definitions.get(cli)?;

    if let Some(existing) = paths.iter().find(|p| path_exists(p)) {
        return Some(existing.clone());
    }
    if let Some(parent_exists) = paths.iter().find(|p| {
        if let Some(parent) = std::path::Path::new(p).parent() {
            parent.exists()
        } else {
            false
        }
    }) {
        return Some(parent_exists.clone());
    }
    paths.first().cloned()
}

/// 扫描所有已存在且包含 skills 目录的 CLI
/// 返回所有检测到的 CLI 行
pub fn scan_all_clis() -> Vec<CliRow> {
    detect_cli_rows()
}

/// 检测当前系统中实际存在的 CLIs
/// 对每个核心 CLI，取其第一个存在的 skills 目录路径

/// 获取所有已存在 CLI 的 skills 目录路径（每个 CLI 可能有多个）
pub fn all_existing_cli_paths() -> HashMap<String, Vec<String>> {
    let definitions = get_cli_definitions();
    let mut result: HashMap<String, Vec<String>> = HashMap::new();

    // 按核心顺序优先
    for cli_name in CORE_CLI_NAMES {
        if let Some(paths) = definitions.get(*cli_name) {
            let existing: Vec<String> = paths.iter().filter(|p| path_exists(p)).cloned().collect();
            if !existing.is_empty() {
                result.insert(cli_name.to_string(), existing);
            }
        }
    }

    result
}

pub fn detect_cli_rows() -> Vec<CliRow> {
    let definitions = get_cli_definitions();
    let mut rows = Vec::new();

    // 按照 CORE_CLI_NAMES 的顺序排列
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

    rows
}


/// 获取指定 CLI 当前系统中“所有存在的” skills 目录路径
/// 用于扫描技能（因为同一个 CLI 可能有多个候选路径同时存在）
pub fn existing_cli_paths(cli: &str) -> Vec<String> {
    let definitions = get_cli_definitions();
    let Some(paths) = definitions.get(cli) else {
        return Vec::new();
    };
    paths.iter().filter(|p| path_exists(p)).cloned().collect()
}

/// 解析指定 CLI 的 skills 目录路径
/// 如果 CLI 存在，返回实际路径；否则返回第一个候选路径
pub fn resolve_cli_path(cli: &str) -> Option<String> {
    let definitions = get_cli_definitions();
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

/// 检查路径是否为符号链接或 junction 点
/// 使用 symlink_metadata 避免跟随链接
pub fn is_symlink_or_junction(path: &std::path::Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            meta.file_type().is_symlink()
        }
        Err(_) => false,
    }
}

/// 检查指定技能（slug）是否已链接到某个 CLI 的 skills 目录
/// 返回 true 当该技能目录存在（无论是 symlink/junction 还是真实目录）
pub fn is_skill_linked(cli: &CliRow, skill_slug: &str) -> bool {
    let skill_path = std::path::Path::new(&cli.path).join(skill_slug);
    // 只要目录存在就算已链接（支持 symlink/junction 和真实目录）
    skill_path.exists() && skill_path.is_dir()
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

