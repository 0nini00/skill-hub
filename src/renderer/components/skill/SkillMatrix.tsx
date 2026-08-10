import { EyeOff, Link2, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORY_ALL, CATEGORY_OPTIONS } from "@shared/constants/categories";
import type { CliRow, SkillRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/ConfirmDialog";
import { EmptyState } from "../ui/EmptyState";
import { TextInput } from "../ui/TextInput";
import { useToast } from "../ui/Toast";

interface SkillMatrixProps {
  skills: SkillRow[];
  hiddenSkills: SkillRow[];
  /** 已按 visibleClis 过滤后的 CLI 列表（App.tsx 提供），SkillMatrix 直接使用 */
  detectedClis: CliRow[];
  onRefresh(): void;
}

export function SkillMatrix({
  skills,
  hiddenSkills,
  detectedClis,
  onRefresh,
}: SkillMatrixProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(CATEGORY_ALL);
  const toast = useToast();
  const confirm = useConfirm();
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

  if (!detectedClis.length) {
    return <EmptyState message="请在设置中勾选要显示的 CLI 列" onRefresh={onRefresh} />;
  }
  if (!skills.length && !hiddenSkills.length) {
    return <EmptyState message="本地库暂无技能，可刷新自动检测本地 CLI，或在侧边栏的导入页添加 Git 仓库" onRefresh={onRefresh} />;
  }

  async function hideSkill(row: SkillRow) {
    try {
      const result = await skillHubApi.hideSkill(row.slug);
      const removed = (result as { data?: { removedClis?: string[] } } | null)?.data?.removedClis;
      toast(
        removed?.length
          ? `「${row.name}」已隐藏（并从 ${removed.join("、")} 移除副本）`
          : `「${row.name}」已隐藏`,
        "success",
      );
      onRefresh();
    } catch (e) {
      toast(`隐藏失败: ${e}`, "error");
    }
  }

  async function unhideSkill(row: SkillRow) {
    try {
      await skillHubApi.unhideSkill(row.slug);
      toast(`「${row.name}」已恢复`, "success");
      onRefresh();
    } catch (e) {
      toast(`恢复失败: ${e}`, "error");
    }
  }

  async function toggleLink(row: SkillRow, cli: string, linked: boolean) {
    try {
      if (linked) {
        await skillHubApi.unlinkSkill(cli, row.slug);
      } else {
        await skillHubApi.linkSkill(cli, row.slug);
      }
      toast(`「${row.name}」${linked ? "已禁用" : "已启用"}`, "success");
      onRefresh();
    } catch (e) {
      toast(`链接操作失败: ${e}`, "error");
    }
  }

  async function deleteSkill(row: SkillRow) {
    const confirmed = await confirm({
      title: "删除技能",
      message: `确定要永久删除技能「${row.name || row.slug}」吗？\n\n这个操作会删除本地技能文件，无法从 Skill Hub 内撤销。`,
      confirmLabel: "永久删除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await skillHubApi.deleteSkill(row.slug);
      toast(`「${row.name}」已删除`, "success");
      onRefresh();
    } catch (e) {
      toast(`删除失败: ${e}`, "error");
    }
  }

  return (
    <div className="page-stack">
      <section className="panel skill-panel">
        <div className="skill-toolbar">
          <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能名称或摘要" />
          <label className="field compact-field">
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
            {detectedClis.map((cli) => (
              <div key={cli.cli} role="columnheader" className="skill-cli-head">{cli.cli}</div>
            ))}
          </div>
          {filteredSkills.map((row) => (
            <div key={row.slug} className="skill-matrix-row" role="row">
              <div className="skill-card-cell" role="cell">
                <div className="skill-title-row">
                  <button className="link-button skill-title" type="button" title="打开目录" onClick={() => { if (!row.path) return; skillHubApi.openPath(row.path); }}>
                    {row.name}
                  </button>
                  <div className="skill-badges">
                    <span className="badge">{row.category || "其他"}</span>
                    {row.source === "external" ? <span className="badge external-badge">外部</span> : null}
                  </div>
                  <button
                    className="skill-hide-btn"
                    type="button"
                    title="隐藏"
                    onClick={() => hideSkill(row)}
                  >
                    <EyeOff size={15} aria-hidden="true" />
                  </button>
                </div>
                <p className="skill-summary">{row.summary || "暂无摘要"}</p>
              </div>
              {detectedClis.map((cli) => {
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
                      onClick={() => toggleLink(row, cli.cli, linked)}
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
                    <small className="hidden-note">来自 CLI 目录，无法删除</small>
                  )}
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => unhideSkill(row)}>
                    <RotateCcw size={14} aria-hidden="true" />恢复
                  </button>
                  {row.source === "hub" && (
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => deleteSkill(row)}
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

