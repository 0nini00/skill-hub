import { Check, FilePlus, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RuleRow, CliRuleStatus } from "@shared/types/rule";
import type { CliRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/Toast";
import { RuleEditor } from "./RuleEditor";

interface RulesPageV2Props {
  detectedClis: CliRow[];
  onRefresh(): void;
}

export function RulesPageV2({ detectedClis, onRefresh }: RulesPageV2Props) {
  const [cliStatuses, setCliStatuses] = useState<CliRuleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorSlug, setEditorSlug] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorName, setEditorName] = useState("");
  const [isNew, setIsNew] = useState(false);
  const toast = useToast();

  // 规则矩阵只展示后端实际管理规则的 CLI（以 cliStatuses 为准），
  // 避免检测到但无规则能力的 CLI（如 git）出现空列。
  const activeClis = useMemo(() => {
    const managed = new Set(cliStatuses.map((status) => status.cli));
    return detectedClis.filter((cli) => managed.has(cli.cli));
  }, [cliStatuses, detectedClis]);

  const rules = useMemo(() => {
    // 后端契约:build_cli_rule_status 的所有 available 来自同一份 list_rules
    // (全局唯一规则列表,linked 为全局合集),因此取第一份为基线即可,
    // 无需对 N 份相同数据做并集。
    const map = new Map<string, RuleRow>();
    for (const rule of cliStatuses[0]?.available ?? []) {
      map.set(rule.slug, { ...rule });
    }
    // 防御性补充:currentRule 理论上已包含在 available 中,但保留合并逻辑,
    // 以防未来后端出现不在 available 的当前规则(如 native/项目规则)。
    for (const status of cliStatuses) {
      const cur = status.currentRule;
      if (!cur) continue;
      const existing = map.get(cur.slug);
      if (existing) {
        existing.linked = Array.from(new Set([...existing.linked, ...cur.linked]));
      } else {
        map.set(cur.slug, { ...cur });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [cliStatuses]);

  // silent:已有数据时的后台刷新不置 loading,避免操作后整页闪烁
  async function loadRules(silent = false) {
    if (!silent) setLoading(true);
    try {
      const statuses = await skillHubApi.getCliRuleStatus();
      setCliStatuses(statuses);
    } catch (e) {
      console.error("Failed to load rules", e);
    } finally {
      setLoading(false);
    }
  }

  function openEditor(rule: RuleRow) {
    setEditorSlug(rule.slug);
    setEditorName(rule.name);
    setEditorContent("");
    setIsNew(false);
    skillHubApi.readRule(rule.slug).then((content) => {
      if (content !== null) setEditorContent(content);
    });
  }

  // 本地乐观更新:link_rule 成功后,该 CLI 的 currentRule 置为该规则,
  // 且所有 status.available 中该规则的 linked 并集加入该 CLI。
  // 注意:后端 link_rule 是覆盖写 CLI 规则文件,旧 currentRule 的副本被替换,
  // 因此旧规则的 linked 也要移除该 CLI,否则两个规则短暂同时显示“当前”。
  function applyLinkLocally(rule: RuleRow, cli: string) {
    setCliStatuses((prev) => {
      // 旧当前规则在 cli 的 status 上;但其 linked 变化(移除 cli)须对所有 status
      // 的 available 一致生效——available 是全局共享数据(同一份 list_rules 输出),
      // 且 rules 基线取自 statuses[0].available,只改 cli 自己的 status 会导致
      // 基线不反映链接变化(旧规则残留 cli 链接/新规则缺失)。
      const prevSlug = prev.find((s) => s.cli === cli)?.currentRule?.slug;
      return prev.map((status) => {
        const available = status.available.map((r) => {
          let linked = r.linked;
          if (r.slug === rule.slug) {
            linked = Array.from(new Set([...linked, cli]));
          } else if (prevSlug && prevSlug !== rule.slug && r.slug === prevSlug) {
            linked = linked.filter((l) => l !== cli);
          }
          return linked !== r.linked ? { ...r, linked } : r;
        });
        if (status.cli === cli) {
          return { ...status, currentRule: { ...rule, linked: Array.from(new Set([...rule.linked, cli])) }, available };
        }
        return { ...status, available };
      });
    });
  }

  async function switchRule(rule: RuleRow, cli: string) {
    try {
      await skillHubApi.linkRule(rule.slug, cli);
      applyLinkLocally(rule, cli);
      toast(`已将「${rule.name}」设为 ${cli} 的当前规则`, "success");
      loadRules(true); // 后台静默校验,与磁盘状态收敛
    } catch (e) {
      toast(`切换失败: ${e}`, "error");
    }
  }

  useEffect(() => {
    loadRules();
  }, []);

  if (editorSlug !== null) {
    return (
      <RuleEditor
        name={editorName}
        slug={editorSlug}
        content={editorContent}
        isNew={isNew}
        onBack={() => {
          setEditorSlug(null);
          loadRules(true);
        }}
        onSave={async (oldSlug, slug, content, newName) => {
          if (isNew) {
            await skillHubApi.createRule(slug, content);
          } else {
            if (newName) {
              const result = await skillHubApi.renameRule(oldSlug, newName);
              await skillHubApi.writeRule(result.newSlug, content);
              setEditorSlug(result.newSlug);
              setEditorName(result.newName);
              loadRules(true);
              return;
            }
            await skillHubApi.writeRule(slug, content);
          }
        }}
        onDelete={async (slug) => {
          await skillHubApi.deleteRule(slug);
          setEditorSlug(null);
          loadRules(true);
        }}
      />
    );
  }

  if (loading) return <EmptyState message="加载中..." />;
  if (!activeClis.length) return <EmptyState message="请在设置中勾选要显示的 CLI 列" onRefresh={onRefresh} />;

  return (
    <div className="page-stack">
      <section className="panel rules-page-panel">
        <div className="rules-top-bar">
          <Button
            icon={<FilePlus size={16} />}
            onClick={() => {
              setEditorSlug("");
              setEditorContent("");
              setEditorName("");
              setIsNew(true);
            }}
          >
            新建规则
          </Button>
        </div>

        <CliStatusBar statuses={cliStatuses} />

        {rules.length === 0 ? (
          <EmptyState message="暂无可管理规则。当前全局规则为空时不会自动导入，请点击新建规则开始。" />
        ) : (
          <section>
            <div className="rules-section-title-row">
              <h3 className="rules-section-title">规则库</h3>
              <span className="rules-count">{rules.length} 条规则</span>
            </div>

            <div
              className="rules-matrix"
              style={{ gridTemplateColumns: `minmax(240px, 1fr) repeat(${activeClis.length}, minmax(112px, 138px))` }}
            >
              <div className="rules-head-cell">规则</div>
              {activeClis.map((cli) => (
                <div key={cli.cli} className="rules-head-cell center">
                  {cli.cli}
                </div>
              ))}

              {rules.map((rule) => (
                <RuleMatrixRow
                  key={rule.slug}
                  rule={rule}
                  clis={activeClis.map((cli) => cli.cli)}
                  onEdit={openEditor}
                  onSwitch={switchRule}
                />
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

interface CliStatusBarProps {
  statuses: CliRuleStatus[];
}

function CliStatusBar({ statuses }: CliStatusBarProps) {
  return (
    <section>
      <h3 className="rules-section-title">当前启用状态</h3>
      <div className="rules-status-grid">
        {statuses.map((status) => (
          <div key={status.cli} className={`rules-status-card ${status.currentRule ? "active" : ""}`}>
            <div className="rules-cli-label">{status.cli}</div>
            {status.currentRule ? (
              <div className="rules-current-rule">
                <Check size={15} color="#188038" />
                <span>{status.currentRule.name}.md</span>
              </div>
            ) : (
              <div className="rules-empty-rule">未启用规则</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

interface RuleMatrixRowProps {
  rule: RuleRow;
  clis: string[];
  onEdit(rule: RuleRow): void;
  onSwitch(rule: RuleRow, cli: string): void;
}

function RuleMatrixRow({ rule, clis, onEdit, onSwitch }: RuleMatrixRowProps) {
  return (
    <>
      <div className="rules-body-cell">
        <div className="rules-rule-name-cell">
          <div className="rules-rule-name-wrap">
            <div className="rules-rule-name">{rule.name}.md</div>
          </div>
          <button className="button rules-small-button" onClick={() => onEdit(rule)}>
            <Pencil size={13} />
            编辑
          </button>
        </div>
      </div>
      {clis.map((cli) => {
        const linked = rule.linked.includes(cli);
        return (
          <div key={cli} className="rules-body-cell rules-state-cell">
            {linked ? (
              <span className="rules-current-pill">
                <Check size={14} />
                当前
              </span>
            ) : (
              <button className="button rules-small-button rules-switch-button" onClick={() => onSwitch(rule, cli)}>
                切换
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
