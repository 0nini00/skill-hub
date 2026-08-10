# Skill Hub

> 跨 CLI 的 AI Agent 技能与规则管理中心 - 一处管理，多端启用。

Skill Hub 是一个基于 Tauri 2 + React 19 + Vite 的 Windows 桌面应用，用于集中管理 Claude、Codex、Gemini 等 CLI 的 `skills` 与全局规则文件。应用提供矩阵视图来查看每个 Skill 在不同 CLI 中的启用状态，并支持导入、复制启用、项目级安装、AI 摘要自动分类与自定义 CLI 目录。

## 功能特性

- **Skills 矩阵主页**：以「技能 × CLI」表格集中展示所有 Skills，逐格启用 / 禁用，支持搜索与分类筛选
- **Rules 集中管理**：维护统一规则库，按内容归一化去重，可应用到 Claude / Codex / Gemini
- **复制式启用**：启用 Skills 或 Rules 时复制到目标 CLI，避免 Windows 软链接权限问题
- **一键导入**：支持从 Git 仓库导入 Skill，也支持从本地导入 Skill 文件夹或 Rule 文件
- **项目级安装**：把选中的 Skills 安装到指定项目目录，并复制到项目级 CLI 目录
- **AI 摘要 + 自动分类**：通过 OpenAI 兼容接口为 Skills 生成中文摘要，并在同一次请求中从 10 个固定分类中自动归类，写入 `meta.json`
- **自定义 CLI**：在设置中添加任意 CLI 目录（或其 skills 目录），自动扫描其中的技能并加入矩阵列（仅识别 skills，不参与规则管理）
- **隐藏技能**：一键隐藏，自动从所有已链接 CLI 移除副本，Hub 库中保留，可随时恢复
- **网络代理**：Git 下载与 AI 摘要请求共用设置页中的统一代理配置
- **现代化 UI**：Skills、Rules、导入、项目安装、设置与编辑器页面统一视觉体验

## 安装与运行

### 环境要求

- Node.js 20+
- Rust / Cargo
- Windows 10/11

### 开发模式

```bash
npm install
npm run dev
```

### 构建安装包

```bash
npm run build
```

Tauri NSIS 安装包输出位置通常为：

```text
src-tauri/target/release/bundle/nsis/
```

如果配置了自定义 Cargo target dir，也可能输出到类似：

```text
%USERPROFILE%\.cargo\skill-hub-target\release\bundle\nsis\
```

## 目录结构

```text
skill-hub/
├─ src/
│  ├─ renderer/      # React UI：页面、组件、状态、服务、样式
│  └─ shared/        # 渲染端共享类型与常量
├─ src-tauri/        # Tauri 后端：文件系统、扫描、导入、摘要、打包
├─ scripts/          # 开发辅助脚本（图标生成等）
└─ package.json
```

## 技术栈

- Tauri 2
- React 19 + TypeScript 5.7
- Vite 6
- Rust
- marked + DOMPurify（安全的 Markdown 渲染）
- lucide-react

## 当前版本

- App: `1.0.6`

## 许可

本仓库当前未指定开源许可证；如需复用请先与作者联系。
