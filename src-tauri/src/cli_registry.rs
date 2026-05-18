use std::collections::HashMap;
use std::fs;

use crate::paths::user_home_dir;
use crate::types::{CliRow, SkillHubConfig};
use crate::paths::{config_path, read_json_file};

/// 内置 CLI 名称列表
pub const BUILTIN_CLI_NAMES: &[&str] = &["alma", "claude", "gemini", "codex", "aion"];

/// 内置 CLI 定义：每个 CLI 名映射到其 skills 目录的可能路径列表
/// 参照 Electron 版 cliRegistryService.ts 中的 getCliDefinitions()
pub fn get_cli_definitions() -> HashMap<String, Vec<String>> {
    let home = match user_home_dir() {
        Ok(h) => h,
        Err(_) => return HashMap::new(),
    };
    let home_str = home.to_string_lossy();

    let mut definitions: HashMap<String, Vec<String>> = HashMap::new();

    // alma
    definitions.insert(
        "alma".to_string(),
        vec![
            format!("{}/.config/alma/skills", home_str),
            format!("{}/.alma/skills", home_str),
        ],
    );

    // claude
    definitions.insert(
        "claude".to_string(),
        vec![
            format!("{}/.claude/skills", home_str),
            format!("{}/AppData/Roaming/Claude/skills", home_str),
            format!("{}/.config/claude/skills", home_str),
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

    // codex
    definitions.insert(
        "codex".to_string(),
        vec![
            format!("{}/.codex/skills", home_str),
            format!("{}/.config/codex/skills", home_str),
        ],
    );

    // aion
    definitions.insert(
        "aion".to_string(),
        vec![
            format!("{}/AppData/Roaming/AionUi/config/skills", home_str),
            format!("{}/.config/aion/skills", home_str),
            format!("{}/.aion/skills", home_str),
        ],
    );

    // 合并自定义 CLIs
    if let Ok(custom_clis) = merge_custom_clis() {
        for (name, paths) in custom_clis {
            // 跳过与内置同名的自定义 CLI（保护内置定义）
            if definitions.contains_key(&name) {
                eprintln!("[skill-hub] 自定义 CLI \"{}\" 与内置同名，已忽略", name);
                continue;
            }
            definitions.insert(name, paths);
        }
    }

    definitions
}

/// 从 config.json 中读取 custom_clis 字段
fn merge_custom_clis() -> Result<HashMap<String, Vec<String>>, String> {
    let config: SkillHubConfig = read_json_file(&config_path()?);
    let custom_clis = match config.custom_clis {
        Some(val) => val,
        None => return Ok(HashMap::new()),
    };

    let Some(obj) = custom_clis.as_object() else {
        return Ok(HashMap::new());
    };

    let mut result = HashMap::new();
    for (name, val) in obj {
        if let Some(arr) = val.as_array() {
            let paths: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
            if !paths.is_empty() {
                result.insert(name.to_lowercase(), paths);
            }
        }
    }
    Ok(result)
}

/// 扫描所有已存在且包含 skills 目录的 CLI
/// 返回所有检测到的 CLI 行
pub fn scan_all_clis() -> Vec<CliRow> {
    detect_cli_rows()
}

/// 检测当前系统中实际存在的 CLIs
/// 对每个内置/自定义 CLI，取其第一个存在的 skills 目录路径
pub fn detect_cli_rows() -> Vec<CliRow> {
    let definitions = get_cli_definitions();
    let mut rows = Vec::new();

    // 按照 BUILTIN_CLI_NAMES 的顺序优先排列，自定义 CLI 排在后面
    let mut ordered_keys: Vec<String> = BUILTIN_CLI_NAMES.iter().map(|s| s.to_string()).collect();

    // 添加未在内置列表中的 key
    for key in definitions.keys() {
        if !ordered_keys.contains(key) {
            ordered_keys.push(key.clone());
        }
    }

    for cli_name in ordered_keys {
        if let Some(paths) = definitions.get(&cli_name) {
            // 找到第一个存在的路径
            if let Some(existing_path) = paths.iter().find(|p| path_exists(p)) {
                rows.push(CliRow {
                    cli: cli_name.clone(),
                    path: existing_path.clone(),
                });
            }
        }
    }

    rows
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
