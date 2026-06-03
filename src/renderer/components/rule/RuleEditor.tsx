import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";

interface RuleEditorProps {
  name: string;
  slug: string;
  content: string;
  isNew: boolean;
  onBack(): void;
  onSave(slug: string, content: string): Promise<void>;
  onDelete(slug: string): Promise<void>;
}

export function RuleEditor({ name, slug, content, isNew, onBack, onSave, onDelete }: RuleEditorProps) {
  const [text, setText] = useState(content);
  const [ruleName, setRuleName] = useState(name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(content);
    setRuleName(name);
  }, [content, name]);

  async function handleSave() {
    if (!ruleName.trim()) { alert("请输入规则名称"); return; }
    setSaving(true);
    try {
      const s = isNew ? ruleName.trim().toLowerCase().replace(/\s+/g, "-") : slug;
      await onSave(s, text);
      setSaving(false);
      onBack();
    } catch (e) {
      setSaving(false);
      alert("保存失败: " + e);
    }
  }

  async function handleDelete() {
    const ok = window.confirm("确定要删除此规则吗？");
    if (!ok) return;
    try {
      await onDelete(slug);
    } catch (e) {
      alert("删除失败: " + e);
    }
  }

  return (
    <div className="page-stack rule-editor-page">
      <section className="panel rule-editor-panel">
        <div className="rule-editor-toolbar">
          <Button icon={<ArrowLeft size={16} />} onClick={onBack}>返回</Button>
          <div className="rule-editor-title">
            {isNew ? (
              <input
                className="text-input rule-name-input"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="规则名称"
              />
            ) : (
              <strong>{name}.md</strong>
            )}
          </div>
          <Button icon={<Save size={16} />} variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
          {!isNew ? (
            <Button icon={<Trash2 size={16} />} variant="danger" onClick={handleDelete}>删除</Button>
          ) : null}
        </div>

        <div className="rule-editor-grid">
          <div className="editor-pane">
            <div className="pane-title">编辑</div>
            <textarea
              className="rule-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="# 输入规则内容 (Markdown)..."
            />
          </div>
          <div className="preview-pane">
            <div className="pane-title">预览</div>
            <div
              className="markdown-preview"
              dangerouslySetInnerHTML={{
                __html: text
                  .replace(/^### (.+)$/gm, "<h3>$1</h3>")
                  .replace(/^## (.+)$/gm, "<h2>$1</h2>")
                  .replace(/^# (.+)$/gm, "<h1>$1</h1>")
                  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                  .replace(/\*(.+?)\*/g, "<em>$1</em>")
                  .replace(/`(.+?)`/g, "<code>$1</code>")
                  .replace(/\n/g, "<br>"),
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
