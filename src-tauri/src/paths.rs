use std::fs;
use std::path::PathBuf;

/// 获取用户 Home 目录
pub fn user_home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法获取用户 Home 目录".to_string())
}

/// Skill Hub 基础目录: ~/.config/skill-hub
pub fn base_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(".config").join("skill-hub"))
}

/// 确保基础目录存在
pub fn ensure_base_dirs() -> Result<(), String> {
    let dir = base_dir()?;
    fs::create_dir_all(dir.join("skills"))
        .map_err(|e| format!("创建基础目录失败: {e}"))?;
    Ok(())
}

/// config.json 路径
pub fn config_path() -> Result<PathBuf, String> {
    Ok(base_dir()?.join("config.json"))
}

/// ai_config.json 路径
pub fn ai_config_path() -> Result<PathBuf, String> {
    Ok(base_dir()?.join("ai_config.json"))
}

/// skills 目录: ~/.config/skill-hub/skills
pub fn skills_dir() -> Result<PathBuf, String> {
    Ok(base_dir()?.join("skills"))
}

/// 读取 JSON 文件，失败时返回默认值
pub fn read_json_file<T: for<'de> serde::Deserialize<'de> + Default>(
    path: &std::path::Path,
) -> T {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => T::default(),
    }
}

/// 写入 JSON 文件
pub fn write_json_file<T: serde::Serialize>(
    path: &std::path::Path,
    value: &T,
) -> Result<(), String> {
    ensure_base_dirs()?;
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {e}"))?;
    fs::write(path, format!("{content}\n")).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(())
}
