import { PackageOpen } from "lucide-react";
import { Button } from "./Button";

interface EmptyStateProps {
  title?: string;
  message: string;
  onRefresh?: () => void;
}

export function EmptyState({ title = "暂无技能", message, onRefresh }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <PackageOpen size={44} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      <div className="empty-actions">
        {onRefresh ? <Button variant="primary" onClick={onRefresh}>刷新数据</Button> : null}
      </div>
    </section>
  );
}
