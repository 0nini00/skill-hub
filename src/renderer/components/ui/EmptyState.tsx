import { PackageOpen, RefreshCw } from "lucide-react";
import { Button } from "./Button";

interface EmptyStateProps {
  title?: string;
  message: string;
  onRefresh?: () => void;
}

export function EmptyState({ title = "暂无内容", message, onRefresh }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div className="empty-icon"><PackageOpen size={34} aria-hidden="true" /></div>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRefresh ? (
        <div className="empty-actions">
          <Button variant="primary" icon={<RefreshCw size={16} />} onClick={onRefresh}>刷新数据</Button>
        </div>
      ) : null}
    </section>
  );
}
