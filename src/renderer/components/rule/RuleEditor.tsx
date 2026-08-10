import DOMPurify from "dompurify";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { useConfirm } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";

interface RuleEditorProps {
  name: string;
  slug: string;
  content: string;
  isNew: boolean;
  onBack(): void;
  onSave(oldSlug: string, slug: string, content: string, newName?: string): Promise<void>;
  onDelete(slug: string): Promise<void>;
}

export function RuleEditor({ name, slug, content, isNew, onBack, onSave, onDelete }: RuleEditorProps) {
  const [text, setText] = useState(content);
  const [ruleName, setRuleName] = useState(name);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    setText(content);
    setRuleName(name);
  }, [content, name]);

  // marked 渲染 + DOMPurify 消毒，防止注入脚本
  const previewHtml = useMemo(() => {
    const raw = marked.parse(text || "", { gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(raw);
  }, [text]);

  async function handleSave() {
    if (!ruleName.trim()) {
      toast("请输入规则名称", "info");
      return;
    }
    setSaving(true);
    try {
      const newSlug = ruleName.trim().toLowerCase().replace(/\s+/g, "-");
      const s = isNew ? newSlug : slug;
      const changedName = !isNew && ruleName.trim() !== name ? ruleName.trim() : undefined;
      await onSave(slug, s, text, changedName);
      setSaving(false);
      toast(isNew ? "规则已创建" : "规则已保存", "success");
      onBack();
    } catch (e) {
      setSaving(false);
      toast(`保存失败: ${e}`, "error");
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "删除规则",
      message: "确定要删除此规则吗？",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await onDelete(slug);
      toast("规则已删除", "success");
    } catch (e) {
      toast(`删除失败: ${e}`, "error");
    }
  }

  return (
    <div className="page-stack rule-editor-page">
      <section className="panel rule-editor-panel">
        <div className="rule-editor-toolbar">
          <Button icon={<ArrowLeft size={16} />} onClick={onBack}>返回</Button>
          <div className="rule-editor-title">
              <input
                className="text-input rule-name-input"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder={isNew ? "规则名称" : name}
              />
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
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
