import { Bot, Download, FolderInput, Home, RefreshCw, ScrollText, Settings, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";

export type ViewId = "skills" | "rules" | "market" | "project" | "settings";

interface AppShellProps {
  view: ViewId;
  title: string;
  status: string;
  loading: boolean;
  summaryLabel?: string;
  showSummaryAction?: boolean;
  onViewChange(view: ViewId): void;
  onRefresh(): void;
  onSummarize(): void;
  children: React.ReactNode;
}

const navItems = [
  { id: "skills" as const, label: "Skills", icon: Home },
  { id: "rules" as const, label: "Rules", icon: ScrollText },
  { id: "market" as const, label: "导入", icon: Download },
  { id: "project" as const, label: "项目安装", icon: FolderInput },
  { id: "settings" as const, label: "设置", icon: Settings },
];

export function AppShell({
  view,
  title,
  status,
  loading,
  summaryLabel = "AI 摘要",
  showSummaryAction = true,
  onViewChange,
  onRefresh,
  onSummarize,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Bot size={23} aria-hidden="true" /></div>
          <div>
            <h1>Skill Hub</h1>
            <p>技能 & 规则管理</p>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                onClick={() => onViewChange(item.id)}
                type="button"
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-actions">
          <Button icon={<RefreshCw size={16} />} onClick={onRefresh} disabled={loading}>
            刷新数据
          </Button>
          {showSummaryAction && view === "skills" ? (
            <Button icon={<Sparkles size={16} />} onClick={onSummarize} disabled={loading}>
              {summaryLabel}
            </Button>
          ) : null}
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <h2>{title}</h2>
            <p>{viewSubtitle(view)}</p>
          </div>
        </header>
        <div className="workspace-body">{children}</div>
        <footer className="status-bar">
          <span className={`status-dot ${loading ? "loading" : ""}`} />
          <span>{status || "就绪"}</span>
        </footer>
      </main>
    </div>
  );
}

function viewSubtitle(view: ViewId): string {
  switch (view) {
    case "skills":
      return "集中管理本地 Skills 与 CLI 启用状态";
    case "rules":
      return "维护全局规则库，并应用到指定 CLI";
    case "market":
      return "从 Git 或本地导入 Skill 与 Rule";
    case "project":
      return "将选中的 Skills 安装到项目目录";
    case "settings":
      return "配置摘要服务与 CLI 检测状态";
  }
}
