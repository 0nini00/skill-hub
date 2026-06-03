import { Download, EyeOff, FolderOpen, Link2, RotateCcw, Shield, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORY_ALL, CATEGORY_OPTIONS } from "@shared/constants/categories";
import type { BackendResult, CliRow, SkillRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { TextInput } from "../ui/TextInput";

interface SkillMatrixProps {
  skills: SkillRow[];
  hiddenSkills: SkillRow[];
  detectedClis: CliRow[];
  visibleClis: string[];
  onRefresh(): void;
  onRun(args: string[], successMessage: string | ((result: BackendResult) => string)): Promise<BackendResult>;
}

export function SkillMatrix({
  skills,
  hiddenSkills,
  detectedClis,
  visibleClis,
  onRefresh,
}: SkillMatrixProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(CATEGORY_ALL);
  const activeClis = useMemo(
    () => detectedClis.filter((item) => visibleClis.length === 0 || visibleClis.includes(item.cli)),
    [detectedClis, visibleClis],
  );
  const filteredSkills = useMemo(
    () =>
      skills.filter((row) => {
        const haystack = `${row.name} ${row.slug} ${row.summary}`.toLowerCase();
        const queryMatch = !query.trim() || haystack.includes(query.trim().toLowerCase());
        const categoryMatch = category === CATEGORY_ALL || row.category === category;
        return queryMatch && categoryMatch;
      }),
    [category, query, skills],
  );

  const linkedCount = skills.reduce((total, row) => total + row.linked.length, 0);

  if (!activeClis.length) {
    return <EmptyState message="请在设置中勾选要显示的 CLI 列" onRefresh={onRefresh} />;
  }
  if (!skills.length && !hiddenSkills.length) {
    return <EmptyState message="本地库暂无技能，可刷新自动检测本地 CLI，或在侧边栏的导入页添加 Git 仓库" onRefresh={onRefresh} />;
  }

  return (
    <div className="page-stack">
      <section className="metrics-grid">
        <Metric label="技能库" value={String(skills.length + hiddenSkills.length)} />
        <Metric label="主页显示" value={String(skills.length)} />
        <Metric label="已隐藏" value={String(hiddenSkills.length)} />
        <Metric label="启用状态" value={String(linkedCount)} />
      </section>

      <section className="panel skill-panel">
        <div className="skill-toolbar">
          <TextInput label="筛选" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能名称或摘要" />
          <label className="field compact-field">
            <span className="field-label">分类</span>
            <select className="select-input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORY_OPTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <Button onClick={() => { setQuery(""); setCategory(CATEGORY_ALL); }}>清空</Button>
          <span className="toolbar-count">{filteredSkills.length} 条结果</span>
        </div>

        <div className="skill-matrix" role="table" aria-label="技能矩阵">
          <div className="skill-matrix-head" role="row">
            <div role="columnheader">技能</div>
            {activeClis.map((cli) => (
              <div key={cli.cli} role="columnheader" className="skill-cli-head">{cli.cli}</div>
            ))}
          </div>
          {filteredSkills.map((row) => (
            <div key={row.slug} className="skill-matrix-row" role="row">
              <div className="skill-card-cell" role="cell">
                <div className="skill-title-row">
                  <button className="link-button skill-title" type="button" onClick={() => { if (!row.path) return; skillHubApi.openPath(row.path); }}>
                    {row.name}
                  </button>
                  <div className="skill-badges">
                    <span className="badge">{row.category || "其他"}</span>
                    {row.source === "external" ? <span className="badge external-badge">外部</span> : null}
                    {row.safetyReport?.level === "high-risk" || row.safetyReport?.level === "blocked" ? (
                      <span className="badge danger-badge"><ShieldAlert size={12} aria-hidden="true" /> 安全风险</span>
                    ) : row.safetyReport?.level === "warn" ? (
                      <span className="badge warn-badge"><Shield size={12} aria-hidden="true" /> 安全警告</span>
                    ) : null}
                  </div>
                </div>
                <p className="skill-summary">{row.summary || "暂无摘要"}</p>
                <div className="row-actions compact-actions">
                  <button type="button" onClick={() => { if (!row.path) return; skillHubApi.openPath(row.path); }}>
                    <FolderOpen size={14} aria-hidden="true" />打开目录
                  </button>
                  <button type="button" onClick={async () => {
                    try { await skillHubApi.hideSkill(row.slug); onRefresh(); }
                    catch (e) { alert(`隐藏失败: ${e}`); }
                  }}>
                    <EyeOff size={14} aria-hidden="true" />隐藏
                  </button>
                </div>
              </div>
              {activeClis.map((cli) => {
                const linked = row.linked.includes(cli.cli);
                const canControl = row.source === "hub";
                const tooltip = !canControl
                  ? "此技能来自外部 CLI 目录，由 CLI 自动管理。如需控制，请先从市场导入到 Skill Hub。"
                  : (linked ? "点击禁用（删除此 CLI 中的副本）" : "点击启用（复制到此 CLI）");
                return (
                  <div key={cli.cli} className="skill-cli-cell" role="cell">
                    <button
                      className={`skill-state-button ${linked ? "enabled" : ""}`}
                      type="button"
                      aria-pressed={linked}
                      disabled={!canControl}
                      title={tooltip}
                      onClick={async () => {
                        if (!canControl) return;
                        try {
                          if (linked) {
                            await skillHubApi.unlinkSkill(cli.cli, row.slug);
                          } else {
                            await skillHubApi.linkSkill(cli.cli, row.slug);
                          }
                          onRefresh();
                        } catch (e) {
                          alert(`链接操作失败: ${e}`);
                        }
                      }}
                    >
                      <Link2 size={14} aria-hidden="true" />
                      {linked ? "已启用" : "启用"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {hiddenSkills.length ? (
        <section className="panel">
          <div className="section-heading">
            <h3>已隐藏 Skills</h3>
            <span className="badge">{hiddenSkills.length}</span>
          </div>
          <div className="hidden-list">
            {hiddenSkills.map((row) => (
              <div key={row.slug} className="hidden-row">
                <div>
                  <strong>{row.name}</strong>
                  <p>{row.summary}</p>
                  {row.source === "external" && (
                    <small style={{ color: "#888", fontSize: 12 }}>来自 CLI 目录，无法删除</small>
                  )}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={async () => {
                    try { await skillHubApi.unhideSkill(row.slug); onRefresh(); }
                    catch (e) { alert(`恢复失败: ${e}`); }
                  }}>
                    <RotateCcw size={14} aria-hidden="true" />恢复
                  </button>
                  {row.source === "hub" && (
                    <button
                      type="button"
                      className="danger-link"
                      onClick={async () => {
                        const confirmed = window.confirm(
                          `确定要永久删除技能「${row.name || row.slug}」吗？\n\n这个操作会删除本地技能文件，无法从 Skill Hub 内撤销。`,
                        );
                        if (!confirmed) return;
                        try { await skillHubApi.deleteSkill(row.slug); onRefresh(); }
                        catch (e) { alert(`删除失败: ${e}`); }
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
