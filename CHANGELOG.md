# Skill Hub 开发日志

## v1.0.6 - 2026-08-10

### 架构与性能

- 移除 Electron 兼容层（`src/main`、`src/preload` 及相关 IPC），完全迁移到 Tauri 2 原生后端，前端通过统一的 `skillHubApi` 调用。
- 清理全部前端未调用代码、冗余组件、旧页面（`RulesPage`、`SettingsPage`、`statusMessages`、`channels`、`electron-api` 等）及无用 CSS。
- 删除所有测试代码与测试文件（Rust 单元测试、测试脚本、TEST_GUIDE 文档），保持仓库只包含正常功能。
- `get_app_state` 增加后端缓存与目录指纹增量扫描，技能库大时刷新显著变快；`SettingsPageV2` 与 `MarketPage` 复用顶层状态，避免挂载时重复全量构建。
- `get_cli_rule_status` 增加 mtime 指纹缓存；`batch_ai_summarize` 批量结束后只失效一次缓存。
- 前端分类推断逻辑迁移到后端 `infer_skill_category`，`categories.ts` 只保留分类常量。
- `list_rules` 直接返回全局唯一规则，去掉前端并集合并计算。

### 新增功能

- **AI 摘要自动分类**：摘要请求同时返回 `summary` + `category`（10 个固定分类），写入 `meta.json`；读取时校验分类合法性，非法自动回退关键词推断。
- **自定义 CLI**：设置页可添加任意 CLI 目录（或其 skills 目录），自动扫描其中的技能并加入矩阵列；仅识别 skills，不参与规则管理；列表显示「已检测 / 目录不可用」状态徽章。
- **隐藏技能联动**：点击隐藏时自动从所有已链接 CLI 移除该技能副本，Hub 库保留，可恢复。
- **RuleEditor 安全预览**：手写正则 Markdown 渲染替换为 marked + DOMPurify，支持列表/链接且无 XSS 风险。
- **CLI 显示设置**：只显示已检测到的 CLI（不再渲染“未检测到”的灰色卡片），添加的自定义 CLI 自动加入显示列。

### 安全加固

- API Key 在设置页不再回显明文，提供「清除 Key」按钮（内嵌输入框图标）；代理地址也不回显。
- `batch_ai_summarize` 请求失败时错误信息与日志脱敏，确保 API Key 不泄露。

### UI 优化

- 移除 Skills 页顶部统计卡片，页面更紧凑。
- 技能行隐藏操作改为纯图标并移到技能名同一行，点击技能名直接打开目录。
- 项目安装页技能卡片等高对齐，长名称省略号截断（悬停显示全名）。
- 工具条计数文案（条结果 / 已选 / 条规则）统一右对齐并垂直居中。
- 网络代理配置合并为一处（仅设置页），导入页不再重复；项目安装不再展示技能摘要。

---

## v1.0.3 / Tauri 0.1.3 - 2026-06-03

### 新增

- 新增 **Rules 管理**：集中维护规则库，并应用到 Claude / Codex / Gemini。
- 新增规则库去重逻辑：按规则内容归一化后计算 hash，相同规则只保留一份。
- 新增全局规则扫描：支持读取 Claude `CLAUDE.md`、Codex `AGENTS.md`、Gemini `GEMINI.md`。
- 新增 Rule 文件读写、创建、删除、导入和应用能力。
- 新增本地导入识别：支持 Skill 文件夹、Skill 文件和 Rule Markdown 文件。
- 新增 UI 页面：Rules 管理页、Rule 编辑器、新版设置页。

### 改进

- Rules 应用方式从软链接改为直接复制替换，避免 Windows 权限与链接识别问题。
- Skills 启用 / 禁用保持复制 / 删除模式，减少软链接依赖。
- 自动扫描 CLI 中已有 Skills，并导入到 Skill Hub 统一管理。
- 重做整体 UI：侧边栏、状态栏、空状态、Skills 矩阵、Rules 矩阵、导入页、项目安装页、设置页和编辑器。
- 导入页改为主操作卡片 + 代理设置条布局。
- 项目安装页改为项目路径、CLI 目标、Skills 卡片网格的组合布局。
- 设置页简化 CLI 检测卡片，移除冗余路径说明。
- 底部状态栏增加状态点和更轻的视觉样式。

### 修复

- 修复 Rules 编辑原生规则时内容为空的问题。
- 修复 Gemini 全局规则未识别 `GEMINI.md` 的问题。
- 修复 Rules 扫描误扫 `skills` 目录的问题，改为扫描 CLI 根目录。
- 修复相同规则内容被重复展示的问题。
- 修复 `importLocal` Electron fallback 返回值缺少 `stdout` / `stderr` 导致 typecheck 失败的问题。

### 构建产物

- Windows NSIS 安装包：`Skill Hub_0.1.3_x64-setup.exe`

---

## 2026-06-02 修复与改进

### 已完成的修复

#### 1. AI 摘要异步处理（防止页面冻结）

**问题**：批量生成 AI 摘要时，所有 HTTP 请求在主线程同步执行，导致 UI 完全冻结无响应。

**修复**：
- 将 `ai_summarize` 改为异步命令（`async fn`）
- 使用 `tokio::task::spawn_blocking` 将耗时操作移到后台线程
- 添加 `tokio` 依赖到 `Cargo.toml`

#### 2. 启用/禁用逻辑改为复制/删除（取代符号链接）

**问题**：之前使用符号链接（symlink/junction），在 Windows 上有权限问题，且用户希望使用简单的复制方式。

**修复**：
- `link_skill`：复制整个技能目录到 CLI（而非创建符号链接）
- `unlink_skill`：直接删除 CLI 中的技能副本
- 添加 `copy_dir_recursive` 函数递归复制目录

#### 3. 自动导入 CLI 中的外部 Skills

**解决方案**：采用自动导入到 Hub。

- 首次扫描时，所有在 CLI 中的 skills 自动复制到 `~/.config/skill-hub/skills/`
- Hub 作为统一的技能库
- 所有 skills 标记为 `source: "hub"`，可以在任何 CLI 中启用/禁用

#### 4. 本地导入支持文件夹选择

**修复**：
- 先弹出文件夹选择器
- 如果取消，再弹出文件选择器
- 支持导入完整的多文件 Skill 文件夹

---

## v1.0.0

- 初始版本发布。
