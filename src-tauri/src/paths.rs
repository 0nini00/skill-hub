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

/// rules 目录: ~/.config/skill-hub/rules
pub fn rules_dir() -> Result<PathBuf, String> {
    Ok(base_dir()?.join("rules"))
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

/// 以受限权限写入 JSON 文件（用于含敏感信息的配置，如 API Key）。
/// Unix 上使用 0600（仅当前用户可读写），Windows 由 NTFS ACL 继承用户目录权限。
/// 注意：OpenOptions 的 mode 仅在文件创建时生效，因此写入后需显式 set_permissions，
/// 确保旧版本遗留的宽松权限（如 0644）被收紧。
pub fn write_json_file_private<T: serde::Serialize>(
    path: &std::path::Path,
    value: &T,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        use std::os::unix::fs::PermissionsExt;

        ensure_base_dirs()?;
        let content =
            serde_json::to_string_pretty(value).map_err(|e| format!("序列化 JSON 失败: {e}"))?;

        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("写入文件失败: {e}"))?;
        file.write_all(format!("{content}\n").as_bytes())
            .map_err(|e| format!("写入文件失败: {e}"))?;
        // 强制每次写入后收紧权限（覆盖旧版本遗留的 0644 等宽松权限）
        let mut perms = fs::metadata(path)
            .map_err(|e| format!("读取文件属性失败: {e}"))?
            .permissions();
        perms.set_mode(0o600);
        fs::set_permissions(path, perms).map_err(|e| format!("设置文件权限失败: {e}"))?;
        return Ok(());
    }

    #[cfg(not(unix))]
    {
        // 非 Unix（如 Windows）：复用普通写入，权限由 NTFS ACL 继承用户目录
        write_json_file(path, value)
    }
}
