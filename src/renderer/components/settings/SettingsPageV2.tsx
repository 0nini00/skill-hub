import { CheckCircle2, FolderPlus, KeyRound, Link2, Copy, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import type { AiConfig } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";
import { useToast } from "../ui/Toast";

// 已知 CLI 候选（用于在未检测到时展示提示），检测到的 CLI 会动态并入
const KNOWN_CLIS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex CLI" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "cursor", label: "Cursor" },
];

// 可见 CLI 回退：未配置时显示所有检测到的 CLI
function resolveVisibleClis(configured: string[], detected: string[]): string[] {
  return configured.length > 0 ? configured : detected;
}

interface SettingsPageProps {
  onStatus(message: string): void;
  /** 所有检测到的 CLI（来自顶层 AppState，避免重复全量构建） */
  detectedClis: string[];
  /** 配置中显示的 CLI（来自顶层 AppState） */
  visibleClis: string[];
  /** 顶层刷新，用于 CLI 显示变更后同步全局状态 */
  onRefresh(): void;
  /** 顶层共享的 AI 配置（避免挂载时重复读取） */
  aiConfig: AiConfig;
  /** 保存后同步回顶层 */
  onAiConfigChange(config: AiConfig): void;
}

export function SettingsPageV2({ onStatus, detectedClis: propDetectedClis, visibleClis: propVisibleClis, onRefresh, aiConfig, onAiConfigChange }: SettingsPageProps) {
  const [apiUrl, setApiUrl] = useState(() => aiConfig.api_url ?? "");
  // API Key 不回显明文（后端只返回占位符），留空 = 保持不变
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(() => aiConfig.model ?? "");
  const [proxy, setProxy] = useState(() => aiConfig.proxy ?? "");
  // 可见 CLI：本地可乐观更新，但随顶层 state 同步（切换视图/刷新后保持一致）
  const [visibleClis, setVisibleClis] = useState<string[]>(() =>
    resolveVisibleClis(propVisibleClis, propDetectedClis)
  );
  const [linkMode, setLinkMode] = useState<string>("copy");
  const [converting, setConverting] = useState(false);
  const [customClis, setCustomClis] = useState<Record<string, string[]>>({});
  const [customDir, setCustomDir] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const toast = useToast();

  // 加载链接模式与自定义 CLI 列表
  useEffect(() => {
    skillHubApi.getConfig().then((config) => {
      setLinkMode(config.link_mode ?? "copy");
      setCustomClis(config.custom_clis ?? {});
    }).catch((err) => {
      console.error("getConfig error:", err);
    });
  }, []);

  // 顶层刷新后同步自定义 CLI 列表
  useEffect(() => {
    skillHubApi.getConfig().then((config) => {
      setCustomClis(config.custom_clis ?? {});
    }).catch(() => {});
  }, [propDetectedClis]);

  // 顶层配置变化（例如在导入页保存代理）时同步表单。
  // apiKey 不回显：用户已输入的内容不被动覆盖，保持留空=不变语义
  useEffect(() => {
    setApiUrl(aiConfig.api_url ?? "");
    setModel(aiConfig.model ?? "");
    setProxy(aiConfig.proxy ?? "");
  }, [aiConfig]);

  // 顶层 state 变化（刷新/其他视图修改后）同步本地可见列表
  useEffect(() => {
    setVisibleClis(resolveVisibleClis(propVisibleClis, propDetectedClis));
  }, [propVisibleClis, propDetectedClis]);

  // 动态 CLI 列表：只显示已检测到的 CLI（内置 + 自定义），未检测到的不展示
  const allClis = useMemo(() => {
    const known = KNOWN_CLIS.filter((item) => propDetectedClis.includes(item.id));
    const extra = propDetectedClis
      .filter((id) => !KNOWN_CLIS.some((item) => item.id === id))
      .map((id) => ({ id, label: id }));
    return [...known, ...extra];
  }, [propDetectedClis]);

  async function saveAiConfig(clearKey = false) {
    const result = await skillHubApi.setAiConfig({
      api_url: apiUrl,
      // 留空 = 保留原 key（后端处理）；清除时发送哨兵 __CLEAR__
      api_key: clearKey ? "__CLEAR__" : apiKey.trim(),
      model,
      proxy,
    });
    if (result.ok) {
      // 顶层同步：key 留空时沿用原配置（避免把已配置状态清掉），清除时置空
      onAiConfigChange({
        api_url: apiUrl,
        api_key: clearKey ? undefined : apiKey.trim() ? apiKey.trim() : aiConfig.api_key,
        model,
        proxy,
      });
      if (clearKey) setApiKey("");
      toast("AI 配置已保存", "success");
    } else {
      toast(result.message || "AI 配置保存失败", "error");
    }
  }

  async function clearApiKey() {
    await saveAiConfig(true);
  }

  async function pickCustomDir() {
    const dir = await skillHubApi.selectDirectory();
    if (!dir) return;
    setCustomDir(dir);
    // 默认名称 = 目录名，用户可改
    const name = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    setCustomLabel(name);
  }

  async function addCustomCli() {
    if (!customDir) {
      toast("请先选择目录", "error");
      return;
    }
    setAddingCustom(true);
    try {
      const result = await skillHubApi.addCustomCli(customLabel, customDir);
      if (result.ok) {
        toast("自定义 CLI 已添加", "success");
        setCustomDir("");
        setCustomLabel("");
        const config = await skillHubApi.getConfig();
        setCustomClis(config.custom_clis ?? {});
        onRefresh();
      } else {
        toast(result.message || "添加失败", "error");
      }
    } catch (e: any) {
      toast(`添加失败: ${e.message || e}`, "error");
    } finally {
      setAddingCustom(false);
    }
  }

  async function removeCustomCli(id: string) {
    try {
      const result = await skillHubApi.removeCustomCli(id);
      if (result.ok) {
        toast(`已移除自定义 CLI「${id}」`, "success");
        setCustomClis((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        onRefresh();
      } else {
        toast(result.message || "移除失败", "error");
      }
    } catch (e: any) {
      toast(`移除失败: ${e.message || e}`, "error");
    }
  }

  const toggleCli = useCallback(async (cliId: string) => {
    const next = visibleClis.includes(cliId)
      ? visibleClis.filter(c => c !== cliId)
      : [...visibleClis, cliId];
    setVisibleClis(next);
    try {
      await skillHubApi.setVisibleClis(next);
      toast("已更新显示的 CLI", "success");
      // 顶层 state 同步，返回 Skills 页时列即时生效
      onRefresh();
    } catch (e: any) {
      toast(`保存失败: ${e.message || e}`, "error");
    }
  }, [visibleClis, toast, onRefresh]);

  const switchLinkMode = useCallback(async (newMode: string) => {
    if (newMode === linkMode || converting) return;
    setConverting(true);
    onStatus(`正在切换为 ${newMode === "symlink" ? "软链接" : "复制"} 模式...`);
    try {
      const result = await skillHubApi.setLinkMode(newMode);
      if (result.ok) {
        setLinkMode(newMode);
        const data = result.data;
        const converted = data?.converted ?? 0;
        const errCount = data?.errors?.length ?? 0;
        const modeLabel = newMode === "symlink" ? "软链接" : "复制";
        const msg = converted > 0
          ? `已切换为${modeLabel}模式，转换了 ${converted} 个技能${errCount > 0 ? `（${errCount} 个失败）` : ""}`
          : `已切换为${modeLabel}模式`;
        onStatus(msg);
      } else {
        onStatus(result.message || "切换失败");
      }
    } catch (e: any) {
      onStatus(`切换失败: ${e.message || e}`);
    } finally {
      setConverting(false);
    }
  }, [linkMode, converting, onStatus]);

  return (
    <div className="page-stack">
      <section className="panel settings-panel">
        <div className="settings-title-row">
          <div className="card-icon"><KeyRound size={18} /></div>
          <div>
            <h3>AI 摘要配置</h3>
            <p>用于 Skills 自动摘要生成。</p>
          </div>
        </div>
        <div className="form-grid two-column">
          <TextInput
            label="API URL"
            value={apiUrl}
            onChange={(event) => setApiUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
          <TextInput
            label="模型名称"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="gpt-4o-mini"
          />
          <div className="api-key-field">
            <TextInput
              label="API Key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={aiConfig.api_key ? "已保存（留空保持不变）" : "输入新的 API Key"}
            />
            {aiConfig.api_key && (
              <button
                type="button"
                className="api-key-clear"
                onClick={clearApiKey}
                title="清除 Key"
                aria-label="清除 Key"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <TextInput
            label="网络代理"
            value={proxy}
            onChange={(event) => setProxy(event.target.value)}
            placeholder="http://127.0.0.1:7890"
          />
        </div>
        <div className="panel-actions settings-actions">
          <Button variant="primary" onClick={() => saveAiConfig()}>保存配置</Button>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="settings-title-row">
          <div className="card-icon"><Link2 size={18} /></div>
          <div>
            <h3>Skills 同步方式</h3>
            <p>控制 Hub 中的技能如何同步到各 CLI 目录。切换时会自动转换已有的技能。</p>
          </div>
        </div>
        <div className="link-mode-row">
          <LinkModeCard
            icon={<Copy size={20} />}
            title="复制模式"
            desc="每个 CLI 独立副本，互不影响"
            active={linkMode === "copy"}
            disabled={converting}
            onClick={() => switchLinkMode("copy")}
          />
          <LinkModeCard
            icon={<Link2 size={20} />}
            title="软链接模式"
            desc="CLI 指向 Hub 的同一份，修改实时同步"
            active={linkMode === "symlink"}
            disabled={converting}
            onClick={() => switchLinkMode("symlink")}
          />
        </div>
        {converting && (
          <div className="converting-hint">
            正在转换中，请勿关闭...
          </div>
        )}
      </section>

      <section className="panel settings-panel">
        <div className="settings-title-row">
          <div className="card-icon"><Settings2 size={18} /></div>
          <div>
            <h3>CLI 显示设置</h3>
            <p>选择在主页面显示哪些 CLI，取消勾选则隐藏该列。</p>
          </div>
        </div>
        <div className="cli-card-grid">
          {allClis.map((cli) => {
            const visible = visibleClis.includes(cli.id);
            return (
              <CliToggleCard
                key={cli.id}
                name={cli.label}
                visible={visible}
                onToggle={() => toggleCli(cli.id)}
              />
            );
          })}
          {allClis.length === 0 && (
            <p className="custom-cli-empty">尚未检测到任何 CLI。在下方添加自定义 CLI 目录后即可显示。</p>
          )}
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="settings-title-row">
          <div className="card-icon"><FolderPlus size={18} /></div>
          <div>
            <h3>自定义 CLI</h3>
            <p>指向其他 CLI 的目录（或其 skills 目录），自动识别其中的技能。添加后可在上方勾选显示，并在 Skills 页管理。</p>
          </div>
        </div>

        <div className="custom-cli-add-row">
          <Button variant="secondary" icon={<FolderPlus size={16} />} onClick={pickCustomDir}>
            选择目录
          </Button>
          {customDir && (
            <>
              <TextInput
                label="CLI 名称（可选）"
                value={customLabel}
                onChange={(event) => setCustomLabel(event.target.value)}
                placeholder="自动取目录名"
              />
              <Button variant="primary" onClick={addCustomCli} disabled={addingCustom}>
                {addingCustom ? "添加中..." : "添加"}
              </Button>
            </>
          )}
        </div>
        {customDir && (
          <div className="custom-cli-dir-hint">
            已选目录：<code>{customDir}</code>
          </div>
        )}

        <div className="custom-cli-list">
          {Object.entries(customClis).map(([id, dirs]) => {
            const detected = propDetectedClis.includes(id);
            return (
              <div className="custom-cli-item" key={id}>
                <div className="custom-cli-item-info">
                  <strong>{id}</strong>
                  <span className="custom-cli-item-path">{dirs.join("、")}</span>
                </div>
                <span className={`custom-cli-status ${detected ? "detected" : "missing"}`}>
                  {detected ? (
                    <><CheckCircle2 size={13} />已检测</>
                  ) : (
                    "目录不可用"
                  )}
                </span>
                <button
                  type="button"
                  className="custom-cli-remove"
                  onClick={() => removeCustomCli(id)}
                  title="移除该自定义 CLI"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {Object.keys(customClis).length === 0 && (
            <p className="custom-cli-empty">尚未添加自定义 CLI。选择目录后会自动识别其中的 skills 子目录。</p>
          )}
        </div>
      </section>
    </div>
  );
}

interface LinkModeCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}

function LinkModeCard({ icon, title, desc, active, disabled, onClick }: LinkModeCardProps) {
  return (
    <div
      className={`link-mode-card ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="link-mode-card-header">
        <span className="link-mode-icon">{icon}</span>
        <strong className="link-mode-title">{title}</strong>
        {active && <span className="link-mode-current">当前</span>}
      </div>
      <p className="link-mode-desc">{desc}</p>
    </div>
  );
}

interface CliToggleCardProps {
  name: string;
  visible: boolean;
  onToggle: () => void;
}

function CliToggleCard({ name, visible, onToggle }: CliToggleCardProps) {
  return (
    <label className="cli-status-card clickable">
      <div className="cli-card-check">
        <input
          type="checkbox"
          checked={visible}
          onChange={onToggle}
        />
        <strong>{name}</strong>
      </div>
      <span>
        <><CheckCircle2 size={14} />已检测</>
      </span>
    </label>
  );
}
