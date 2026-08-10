# Skill Hub 发布说明 (Release Notes)

## v1.0.6 - 2026-08-10

### 架构与性能

- 移除 Electron 兼容层（`src/main`、`src/preload`），完全迁移到 Tauri 2 原生后端
- `get_app_state` 增加后端缓存与目录指纹增量扫描，技能库大时刷新显著变快
- `get_cli_rule_status` 增加 mtime 指纹缓存；批量 AI 摘要只失效一次缓存
- 清理全部死代码、旧页面（`RulesPage`、`SettingsPage`、`market.rs` 等）与无用样式
- 分类推断逻辑迁移到后端，`list_rules` 直接返回全局唯一规则

### 新增功能

- **AI 摘要自动分类**：一次请求同时返回摘要与分类（10 个固定分类），写入 `meta.json`
- **自定义 CLI**：添加任意 CLI 目录自动扫描技能并加入矩阵列（仅识别 skills，不参与规则管理）
- **隐藏技能**：自动从所有已链接 CLI 移除副本，Hub 库保留可恢复
- **RuleEditor 安全预览**：marked + DOMPurify，支持列表/链接且无 XSS 风险
- **CLI 显示设置**：只显示已检测到的 CLI，添加的自定义 CLI 自动加入显示列

### 安全加固

- API Key 不再回显明文，提供内嵌「清除 Key」按钮
- 摘要请求失败时错误信息与日志脱敏，确保 API Key 不泄露

### UI 优化

- 移除 Skills 页顶部统计卡片
- 技能隐藏操作改为纯图标并移入技能名同一行，点击技能名直接打开目录
- 项目安装页技能卡片等高对齐，长名称省略号截断（悬停显示全名）
- 工具条计数文案统一右对齐并垂直居中
- 网络代理合并为一处配置；项目安装不再展示技能摘要

### 安装包

- Windows NSIS（x64）：`Skill Hub_1.0.6_x64-setup.exe`
- SHA-256：`60ecb2a502d26c4e1cab280d24a1e636c9db9295dfc074f8d0ad7fad6b3599e1`

---

## v1.0.3 - 2026-06-03

- 新增 Rules 管理：集中维护规则库，应用到 Claude / Codex / Gemini
- 规则库按内容归一化去重，相同规则只保留一份
- 支持读取 Claude `CLAUDE.md`、Codex `AGENTS.md`、Gemini `GEMINI.md`
- Rules 应用方式改为直接复制替换，Skills 启用/禁用保持复制/删除模式
- 自动扫描 CLI 中已有 Skills 并导入到 Hub 统一管理
- 重做整体 UI：侧边栏、状态栏、Skills 矩阵、导入页、项目安装页、设置页
