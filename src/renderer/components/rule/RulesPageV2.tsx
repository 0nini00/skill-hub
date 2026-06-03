import { Check, FilePlus, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RuleRow, CliRuleStatus } from "@shared/types/rule";
import type { BackendResult, CliRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { RuleEditor } from "./RuleEditor";

interface RulesPageV2Props {
  detectedClis: CliRow[];
  visibleClis: string[];
  onRefresh(): void;
  onRun(args: string[], successMessage: string | ((result: BackendResult) => string)): Promise<BackendResult>;
}

const RULE_CLIS = ["codex", "claude", "gemini"];

export function RulesPageV2({ detectedClis, onRefresh }: RulesPageV2Props) {
  const [cliStatuses, setCliStatuses] = useState<CliRuleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorSlug, setEditorSlug] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorName, setEditorName] = useState("");
  const [isNew, setIsNew] = useState(false);

  const activeClis = detectedClis.filter((c) => RULE_CLIS.includes(c.cli));

  const rules = useMemo(() => {
    const map = new Map<string, RuleRow>();
    for (const status of cliStatuses) {
      for (const rule of status.available) {
        map.set(rule.slug, rule);
      }
      if (status.currentRule) {
        map.set(status.currentRule.slug, status.currentRule);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [cliStatuses]);

  async function loadRules() {
    setLoading(true);
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

  async function switchRule(rule: RuleRow, cli: string) {
    try {
      await skillHubApi.linkRule(rule.slug, cli);
      await loadRules();
    } catch (e) {
      alert("切换失败: " + e);
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
          loadRules();
        }}
        onSave={async (slug, content) => {
          if (isNew) {
            await skillHubApi.createRule(slug, content);
          } else {
            await skillHubApi.writeRule(slug, content);
          }
        }}
        onDelete={async (slug) => {
          await skillHubApi.deleteRule(slug);
          setEditorSlug(null);
          loadRules();
        }}
      />
    );
  }

  if (loading) return <EmptyState message="加载中..." />;
  if (!activeClis.length) return <EmptyState message="请在设置中勾选要显示的 CLI 列" onRefresh={onRefresh} />;

  return (
    <div className="page-stack">
      <section className="panel" style={pagePanelStyle}>
        <div style={topBarStyle}>
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
            <div style={sectionTitleRowStyle}>
              <h3 style={sectionTitleStyle}>规则库</h3>
              <span style={countStyle}>{rules.length} 条规则</span>
            </div>

            <div style={matrixStyle(activeClis.length)}>
              <div style={headCellStyle}>规则</div>
              {activeClis.map((cli) => (
                <div key={cli.cli} style={{ ...headCellStyle, textAlign: "center", textTransform: "uppercase" }}>
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
      <h3 style={sectionTitleStyle}>当前启用状态</h3>
      <div style={statusGridStyle}>
        {statuses.map((status) => (
          <div key={status.cli} style={statusCardStyle(Boolean(status.currentRule))}>
            <div style={cliLabelStyle}>{status.cli}</div>
            {status.currentRule ? (
              <div style={currentRuleStyle}>
                <Check size={15} color="#188038" />
                <span>{status.currentRule.name}.md</span>
              </div>
            ) : (
              <div style={emptyRuleStyle}>未启用规则</div>
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
      <div style={bodyCellStyle}>
        <div style={ruleNameCellStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={ruleNameStyle}>{rule.name}.md</div>
          </div>
          <button className="button" style={smallButtonStyle} onClick={() => onEdit(rule)}>
            <Pencil size={13} />
            编辑
          </button>
        </div>
      </div>
      {clis.map((cli) => {
        const linked = rule.linked.includes(cli);
        return (
          <div key={cli} style={stateCellStyle}>
            {linked ? (
              <span style={currentPillStyle}>
                <Check size={14} />
                当前
              </span>
            ) : (
              <button className="button" style={switchButtonStyle} onClick={() => onSwitch(rule, cli)}>
                切换
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

const pagePanelStyle: React.CSSProperties = {
  display: "grid",
  gap: 22,
  padding: 20,
};

const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
};

const sectionTitleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: "0 0 10px",
  fontSize: 17,
  letterSpacing: "-0.01em",
};

const countStyle: React.CSSProperties = {
  color: "#6e6e73",
  fontSize: 13,
};

const statusGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: 12,
};

function statusCardStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? "1px solid #b7e4c7" : "1px solid #e5e5e7",
    borderRadius: 12,
    padding: "13px 14px",
    background: active ? "linear-gradient(180deg, #f4fff7 0%, #ffffff 100%)" : "#fafafa",
    boxShadow: active ? "0 1px 2px rgba(24, 128, 56, 0.06)" : "none",
  };
}

const cliLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6e6e73",
  textTransform: "uppercase",
  marginBottom: 7,
  letterSpacing: "0.04em",
};

const currentRuleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontWeight: 700,
  color: "#111827",
};

const emptyRuleStyle: React.CSSProperties = {
  color: "#86868b",
  fontSize: 13,
};

function matrixStyle(cliCount: number): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `minmax(240px, 1fr) repeat(${cliCount}, minmax(112px, 138px))`,
    border: "1px solid #e5e5e7",
    borderRadius: 12,
    overflow: "hidden",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
  };
}

const headCellStyle: React.CSSProperties = {
  padding: "11px 14px",
  background: "#f7f7f8",
  borderBottom: "1px solid #e5e5e7",
  fontWeight: 700,
  fontSize: 12,
  color: "#4b5563",
};

const bodyCellStyle: React.CSSProperties = {
  padding: "11px 14px",
  borderBottom: "1px solid #f0f0f2",
  borderRight: "1px solid #f0f0f2",
  minHeight: 54,
};

const stateCellStyle: React.CSSProperties = {
  ...bodyCellStyle,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const ruleNameCellStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const ruleNameStyle: React.CSSProperties = {
  fontWeight: 700,
  color: "#111827",
};

const currentPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  color: "#188038",
  background: "#e8f8ec",
  border: "1px solid #c6efd1",
  borderRadius: 999,
  padding: "4px 9px",
  fontWeight: 700,
  fontSize: 12,
};

const smallButtonStyle: React.CSSProperties = {
  padding: "5px 10px",
  minHeight: 30,
  fontSize: 12,
  cursor: "pointer",
};

const switchButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  minWidth: 58,
};
