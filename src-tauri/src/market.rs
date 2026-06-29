// Skills 市场 API 调用模块
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const MARKET_API_BASE: &str = "https://skills.sh";
const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Serialize, Deserialize)]
pub struct MarketSkill {
    pub id: String,
    pub name: String,
    pub installs: u64,
    pub source: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ApiSearchResponse {
    skills: Vec<MarketSkill>,
}

/// 搜索 skills.sh 市场
pub fn search_skills_market(query: &str, limit: u32) -> Result<Vec<MarketSkill>, String> {
    let url = format!(
        "{}/api/search?q={}&limit={}",
        MARKET_API_BASE,
        urlencoding::encode(query),
        limit
    );

    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API 返回错误状态: {}", response.status()));
    }

    let data: ApiSearchResponse = response
        .json()
        .map_err(|e| format!("解析响应失败: {}", e))?;

    Ok(data.skills)
}

/// 下载技能文件（从 GitHub tarball）
pub fn download_skill_from_market(
    owner: &str,
    repo: &str,
    _skill_slug: &str,
) -> Result<Vec<u8>, String> {
    // 尝试多个分支名称
    let branches = ["main", "master"];
    let mut last_error = String::new();

    for branch in &branches {
        let url = format!(
            "https://github.com/{}/{}/tarball/{}",
            owner, repo, branch
        );

        eprintln!("[下载] 尝试从 GitHub 下载: {}", url);

        let client = Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let response = match client.get(&url).send() {
            Ok(resp) => resp,
            Err(e) => {
                last_error = format!("分支 {} 下载失败: {}", branch, e);
                eprintln!("[下载] {}", last_error);
                continue;
            }
        };

        if !response.status().is_success() {
            last_error = format!("分支 {} 返回状态码: {}", branch, response.status());
            eprintln!("[下载] {}", last_error);
            continue;
        }

        let bytes = response
            .bytes()
            .map_err(|e| format!("读取响应失败: {}", e))?;

        eprintln!("[下载] 成功下载 {} bytes", bytes.len());
        return Ok(bytes.to_vec());
    }

    Err(format!("所有分支下载失败。最后错误: {}", last_error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // 需要网络连接
    fn test_search_skills_market() {
        let results = search_skills_market("react", 5);
        assert!(results.is_ok());
        let skills = results.unwrap();
        assert!(!skills.is_empty());
    }
}
