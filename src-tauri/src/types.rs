use serde::{Deserialize, Serialize};

/// CLI 行：一个已检测到的 CLI 及其 skills 目录路径
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CliRow {
    pub cli: String,
    pub path: String,
}

/// 技能行：矩阵表格中的一行
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillRow {
    /// 技能来源：hub(技能库) 或 external(仅存在于某些 CLI 目录)
    pub source: String,
    pub name: String,
    pub slug: String,
    pub hidden: bool,
    pub missing: bool,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub path: String,
    /// 该技能已链接（junction/symlink）到的 CLI 列表
    pub linked: Vec<String>,
}

/// 前端应用状态
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppState {
    pub skills: Vec<SkillRow>,
    #[serde(rename = "detectedClis")]
    pub detected_clis: Vec<CliRow>,
    #[serde(rename = "visibleClis")]
    pub visible_clis: Vec<String>,
}

/// 后端统一返回结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackendResult<T> {
    pub ok: bool,
    pub data: Option<T>,
    pub stdout: String,
    pub stderr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 自定义 CLI：cli_id -> 用户配置的目录列表（每个目录自动推导 skills/rules 路径）
pub type CustomCliMap = std::collections::HashMap<String, Vec<String>>;

/// Skill Hub 配置（~/.config/skill-hub/config.json）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillHubConfig {
    /// 自定义 CLI：cli_id -> 目录列表。目录可为 CLI 根目录或 skills 目录，
    /// 读取时自动推导 skills 候选（{dir}/skills 与 {dir}）。仅参与技能识别，不参与规则管理。
    #[serde(default)]
    pub custom_clis: CustomCliMap,
    pub visible_clis: Option<Vec<String>>,
    /// 隐藏的技能 slug 列表
    #[serde(default)]
    pub hidden_skills: Vec<String>,
    /// 链接模式："symlink"（软链接）或 "copy"（复制），默认 copy
    #[serde(default = "default_link_mode")]
    pub link_mode: String,
}

fn default_link_mode() -> String {
    "copy".to_string()
}

impl Default for SkillHubConfig {
    fn default() -> Self {
        Self {
            custom_clis: CustomCliMap::new(),
            visible_clis: None,
            hidden_skills: Vec::new(),
            link_mode: default_link_mode(),
        }
    }
}

/// AI 配置（~/.config/skill-hub/ai_config.json）
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AiConfig {
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub proxy: Option<String>,
}

