import { FilePlus, FileUp, Pencil, Trash2, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { RuleRow } from "@shared/types/rule";
import type { BackendResult, CliRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { RuleEditor } from "./RuleEditor";

interface RulesPageProps {
  detectedClis: CliRow[];
  visibleClis: string[];
  onRefresh(): void;
  onRun(args: string[], successMessage: string | ((result: BackendResult) => string)): Promise<BackendResult>;
}

export function RulesPage({ detectedClis, visibleClis, onRefresh }: RulesPageProps) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorSlug, setEditorSlug] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorName, setEditorName] = useState("");
  const [isNew, setIsNew] = useState(false);

  const RULE_CLIS = ["codex", "claude", "gemini"];
  const activeClis = detectedClis.filter(
    (c) => RULE_CLIS.includes(c.cli),
  );

  async function loadRules() {
    setLoading(true);
    try {
      const r = await skillHubApi.listRules();
      setRules(r);
    } catch (e) {
      console.error("Failed to load rules", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRules(); }, []);

  if (editorSlug !== null) {
    return (
      <RuleEditor
        name={editorName}
        slug={editorSlug}
        content={editorContent}
        isNew={isNew}
        onBack={() => { setEditorSlug(null); loadRules(); }}
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
      <section className="panel">
        <div className="toolbar">
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
          <Button
            icon={<FileUp size={16} />}
            onClick={async () => {
              try {
                const dir = await skillHubApi.selectDirectory();
                if (!dir) return;
                alert("请将 .md 文件放入 rules 目录后刷新: " + dir);
                // For now, just tell user to manually place files
                // Future: implement file picker for .md files
              } catch (e) {
                alert("导入失败: " + e);
              }
            }}
          >
            导入文件
          </Button>
        </div>

        {rules.length === 0 ? (
          <EmptyState message="暂无规则文件，点击新建规则开始" />
        ) : (
          <div className="matrix-table" role="table" aria-label="规则矩阵">
            <div className="matrix-row matrix-head" role="row">
              <div role="columnheader">规则文件</div>
              {activeClis.map((cli) => (
                <div key={cli.cli} role="columnheader" className="cli-cell">
                  {cli.cli}
                </div>
              ))}
            </div>
            {rules.map((rule) => (
              <div key={rule.slug} className="matrix-row" role="row">
                <div className="skill-info" role="cell">
                  <button
                    className="link-button skill-name"
                    type="button"
                    onClick={() => {
                      setEditorSlug(rule.slug);
                      setEditorName(rule.name);
                      setEditorContent("");
                      setIsNew(false);
                      skillHubApi.readRule(rule.slug).then((c) => {
                        if (c !== null) setEditorContent(c);
                      });
                    }}
                  >
                    {rule.name}.md
                  </button>
                  <p>{rule.preview || "暂无预览"}</p>
                  <div className="row-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditorSlug(rule.slug);
                        setEditorName(rule.name);
                        setIsNew(false);
                        skillHubApi.readRule(rule.slug).then((c) => {
                          if (c !== null) setEditorContent(c);
                        });
                      }}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      编辑
                    </button>
                    <button
                      type="button"
                      className="danger-link"
                      onClick={async () => {
                        const ok = window.confirm("确定要删除规则 " + rule.name + " 吗？");
                        if (!ok) return;
                        try {
                          await skillHubApi.deleteRule(rule.slug);
                          loadRules();
                        } catch (e) {
                          alert("删除失败: " + e);
                        }
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      删除
                    </button>
                  </div>
                </div>
                {activeClis.map((cli) => {
                  const linked = rule.linked?.includes(cli.cli) ?? false;
                  return (
                    <div key={cli.cli} className="cli-cell" role="cell">
                      <button
                        className={"toggle " + (linked ? "on" : "")}
                        type="button"
                        aria-pressed={linked}
                        onClick={async () => {
                          try {
                            if (linked) {
                              await skillHubApi.unlinkRule(rule.slug, cli.cli);
                            } else {
                              await skillHubApi.linkRule(rule.slug, cli.cli);
                            }
                            loadRules();
                          } catch (e) {
                            alert("操作失败: " + e);
                          }
                        }}
                      >
                        <Link2 size={15} aria-hidden="true" />
                        {linked ? "当前" : "切换"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
