/** 首次加载骨架屏：异步构建 AppState 期间展示，避免空白或误导性空状态 */
export function Skeleton() {
  return (
    <div className="page-stack" role="status" aria-label="正在加载">
      <section className="panel skill-panel">
        <div className="skill-toolbar">
          <div className="skeleton-block skeleton-input" />
          <div className="skeleton-block skeleton-input skeleton-input-sm" />
          <div className="skeleton-block skeleton-btn" />
        </div>
        <div className="skeleton-matrix">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-block skeleton-row-title" />
              <div className="skeleton-block skeleton-row-cell" />
              <div className="skeleton-block skeleton-row-cell" />
              <div className="skeleton-block skeleton-row-cell" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
