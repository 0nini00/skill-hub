# Skill Hub

> 跨 CLI 的 AI Agent 技能与规则管理中心 - 一处管理，多端启用。

Skill Hub 是一个基于 Tauri + React + Vite 构建的 Windows 桌面应用，用于集中管理 Claude、Codex、Gemini 的 `skills` 与全局规则文件。应用提供矩阵视图来查看每个 Skill / Rule 在不同 CLI 中的启用状态，并支持导入、复制启用、项目级安装和 AI 摘要。

## 功能特性

- **Skills 矩阵主页**：以「技能 x CLI」表格集中展示所有 Skills，逐格启用 / 禁用
- **Rules 集中管理**：维护统一规则库，相同内容只保留一份，可应用到 Claude / Codex / Gemini
- **复制式启用**：启用 Skills 或 Rules 时复制到目标 CLI，避免 Windows 软链接权限问题
- **一键导入**：支持从 Git 仓库导入 Skill，也支持从本地导入 Skill 文件夹或 Rule 文件
- **项目级安装**：把选中的 Skills 安装到指定项目目录，并复制到项目级 CLI 目录
- **AI 摘要**：通过 OpenAI 兼容接口为 Skills 自动生成中文摘要
- **网络代理**：Git 下载与 AI 摘要请求可统一配置代理
- **现代化 UI**：重做 Skills、Rules、导入、项目安装、设置与编辑器页面视觉体验

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
│  ├─ main/          # Electron 兼容层：IPC 与旧服务实现
│  ├─ preload/       # Electron preload 兼容 API
│  ├─ renderer/      # React UI：页面、组件、状态、服务
│  └─ shared/        # 主进程与渲染端共享类型与常量
├─ src-tauri/        # Tauri 后端：文件系统、扫描、导入、打包
├─ resources/        # 打包附带资源
├─ docs/images/      # README 截图
└─ package.json
```

## 技术栈

- Tauri 2
- React 19 + TypeScript 5.7
- Vite 6
- Rust
- lucide-react
- Electron 兼容代码仍保留，用于迁移过渡

## 当前版本

- App: `1.0.3`
- Tauri bundle: `0.1.3`

## 许可

本仓库当前未指定开源许可证；如需复用请先与作者联系。
