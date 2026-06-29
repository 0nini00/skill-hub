// Market API Tauri Commands

use crate::market::{search_skills_market as search_api, MarketSkill};
use crate::{ok, err};
use serde_json;

/// 搜索 skills.sh 市场
#[tauri::command]
pub async fn search_skills_market(query: String, limit: Option<u32>) -> Result<crate::BackendResult<Vec<MarketSkill>>, String> {
    let limit = limit.unwrap_or(20);

    tokio::task::spawn_blocking(move || {
        match search_api(&query, limit) {
            Ok(skills) => Ok(ok(skills)),
            Err(e) => Ok(err(format!("搜索失败: {}", e))),
        }
    })
    .await
    .map_err(|e| format!("异步任务失败: {}", e))?
}

/// 从 skills.sh 市场安装技能
#[tauri::command]
pub async fn install_from_market(
    source: String,
    skill_name: String,
) -> Result<crate::BackendResult<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || {
        install_from_market_impl(&source, &skill_name)
    })
    .await
    .map_err(|e| format!("异步任务失败: {}", e))?
}

fn install_from_market_impl(
    source: &str,
    skill_name: &str,
) -> Result<crate::BackendResult<serde_json::Value>, String> {
    // 解析 source (owner/repo)
    let parts: Vec<&str> = source.split('/').collect();
    if parts.len() != 2 {
        return Ok(err(format!("source 格式错误，期望 owner/repo: {}", source)));
    }
    let owner = parts[0];
    let repo = parts[1];

    // 生成 slug
    let skill_slug = skill_name.to_lowercase().replace(' ', "-");

    eprintln!("[市场安装] 正在从 skills.sh 下载: {}/{}/{}", owner, repo, skill_slug);

    // 下载技能文件
    let blob_data = match crate::market::download_skill_from_market(owner, repo, &skill_slug) {
        Ok(data) => data,
        Err(e) => return Ok(err(format!("下载失败: {}", e))),
    };

    // 保存到临时目录
    let temp_dir = std::env::temp_dir().join(format!("skill-hub-market-{}", skill_slug));
    if temp_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("创建临时目录失败: {}", e))?;

    // 尝试解压 (假设是 tar.gz 或 zip)
    // 先写入临时文件
    let archive_path = temp_dir.join("skill.tar.gz");
    std::fs::write(&archive_path, &blob_data)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    // 检查是否是 tar.gz
    if is_tarball(&blob_data) {
        extract_tarball(&archive_path, &temp_dir)?;
    } else if is_zip(&blob_data) {
        extract_zip(&archive_path, &temp_dir)?;
    } else {
        // 直接当成 SKILL.md 文件处理
        let skill_dir = temp_dir.join(&skill_slug);
        std::fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("创建技能目录失败: {}", e))?;
        std::fs::write(skill_dir.join("SKILL.md"), &blob_data)
            .map_err(|e| format!("写入 SKILL.md 失败: {}", e))?;
    }

    // 查找解压后的技能目录
    let extracted_skill_dir = find_skill_dir(&temp_dir, &skill_slug)?;

    // 导入到 Hub
    import_skill_directory_to_hub(&extracted_skill_dir, &skill_slug)?;

    // 清理临时目录
    let _ = std::fs::remove_dir_all(&temp_dir);

    Ok(ok(serde_json::json!({
        "slug": skill_slug,
        "name": skill_name,
        "source": source
    })))
}

fn is_tarball(data: &[u8]) -> bool {
    data.len() > 2 && data[0] == 0x1f && data[1] == 0x8b
}

fn is_zip(data: &[u8]) -> bool {
    data.len() > 4 && data[0] == 0x50 && data[1] == 0x4b
}

fn extract_tarball(archive_path: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    // 使用 tar 命令解压（Windows 10+ 自带）
    let output = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(archive_path)
        .arg("-C")
        .arg(dest)
        .output()
        .map_err(|e| format!("解压失败: {}", e))?;

    if !output.status.success() {
        return Err(format!("解压失败: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(())
}

fn extract_zip(archive_path: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    // 使用 PowerShell Expand-Archive
    let output = std::process::Command::new("powershell")
        .arg("-Command")
        .arg(format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            archive_path.display(),
            dest.display()
        ))
        .output()
        .map_err(|e| format!("解压失败: {}", e))?;

    if !output.status.success() {
        return Err(format!("解压失败: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(())
}

fn find_skill_dir(temp_dir: &std::path::Path, skill_slug: &str) -> Result<std::path::PathBuf, String> {
    eprintln!("[查找] 在 {} 中查找技能目录: {}", temp_dir.display(), skill_slug);

    // 1. 查找 skills/{skill_slug}/SKILL.md（多技能仓库）
    for entry in std::fs::read_dir(temp_dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            let skills_subdir = path.join("skills").join(skill_slug);
            if has_direct_skill_md(&skills_subdir) {
                eprintln!("[查找] 找到多技能仓库结构: {}", skills_subdir.display());
                return Ok(skills_subdir);
            }

            // 2. 查找根目录 SKILL.md（单技能仓库）
            if has_direct_skill_md(&path) {
                eprintln!("[查找] 找到单技能仓库结构: {}", path.display());
                return Ok(path);
            }

            // 3. 递归查找任意 SKILL.md
            if let Ok(skill_md_path) = find_skill_md(&path) {
                let skill_dir = skill_md_path.parent().unwrap().to_path_buf();
                eprintln!("[查找] 递归找到技能目录: {}", skill_dir.display());
                return Ok(skill_dir);
            }
        }
    }

    Err(format!("未找到技能 {} 的 SKILL.md 文件", skill_slug))
}

fn has_direct_skill_md(dir: &std::path::Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if !entry.path().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.eq_ignore_ascii_case("SKILL.md") {
                return true;
            }
        }
    }

    false
}

fn find_skill_md(dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.eq_ignore_ascii_case("SKILL.md") {
                    return Ok(path);
                }
            }
        }
    }

    // 递归查找子目录
    for entry in std::fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            if let Ok(found) = find_skill_md(&path) {
                return Ok(found);
            }
        }
    }

    Err("未找到 SKILL.md".to_string())
}

fn import_skill_directory_to_hub(source_dir: &std::path::Path, slug: &str) -> Result<(), String> {
    let skills_dir = crate::paths::skills_dir()?;
    let dest_dir = skills_dir.join(slug);

    // 如果目标已存在，先删除
    if dest_dir.exists() {
        std::fs::remove_dir_all(&dest_dir)
            .map_err(|e| format!("删除已存在技能失败: {}", e))?;
    }

    // 复制整个目录（复用 lib.rs 中的实现）
    crate::copy_dir_recursive(source_dir, &dest_dir)
        .map_err(|e| format!("复制目录失败: {}", e))?;
    crate::ensure_standard_skill_md_name(&dest_dir)?;

    Ok(())
}
