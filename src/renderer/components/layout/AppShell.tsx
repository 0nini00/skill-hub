import { Bot, Download, FolderInput, Home, RefreshCw, Settings, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";

export type ViewId = "matrix" | "market" | "project" | "settings";

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
  { id: "matrix" as const, label: "主页", icon: Home },
  { id: "market" as const, label: "skills导入", icon: Download },
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
          <Bot size={28} aria-hidden="true" />
          <div>
            <h1>Skill Hub</h1>
            <p>技能分发中心</p>
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
          {showSummaryAction ? (
            <Button icon={<Sparkles size={16} />} onClick={onSummarize} disabled={loading}>
              {summaryLabel}
            </Button>
          ) : null}
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <h2>{title}</h2>
        </header>
        <div className="workspace-body">{children}</div>
        <footer className="status-bar">{status}</footer>
      </main>
    </div>
  );
}
