import { CheckCircle2, KeyRound, Link2, Copy, Settings2 } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

const ALL_CLIS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "cursor", label: "Cursor" },
];

interface SettingsPageProps {
  onStatus(message: string): void;
}

export function SettingsPageV2({ onStatus }: SettingsPageProps) {
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [proxy, setProxy] = useState("");
  const [visibleClis, setVisibleClis] = useState<string[]>([]);
  const [detectedClis, setDetectedClis] = useState<string[]>([]);
  const [linkMode, setLinkMode] = useState<string>("copy");
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    skillHubApi.getAiConfig().then((config) => {
      setApiUrl(config.api_url ?? "");
      setApiKey(config.api_key ?? "");
      setModel(config.model ?? "");
      setProxy(config.proxy ?? "");
    }).catch((err) => {
      console.error("getAiConfig error:", err);
    });

    // 加载 CLI 配置
    skillHubApi.getAppState().then((state) => {
      setDetectedClis(state.detectedClis.map(c => c.cli));
      setVisibleClis(state.visibleClis.length > 0
        ? state.visibleClis
        : state.detectedClis.map(c => c.cli));
    }).catch((err) => {
      console.error("getState error:", err);
    });

    // 加载链接模式
    skillHubApi.getConfig().then((config) => {
      setLinkMode(config.link_mode ?? "copy");
    }).catch((err) => {
      console.error("getConfig error:", err);
    });
  }, []);

  async function saveAiConfig() {
    const result = await skillHubApi.setAiConfig({
      api_url: apiUrl,
      api_key: apiKey,
      model,
      proxy,
    });
    onStatus(result.ok ? "AI 配置已保存" : result.message || "AI 配置保存失败");
  }

  const toggleCli = useCallback(async (cliId: string) => {
    const next = visibleClis.includes(cliId)
      ? visibleClis.filter(c => c !== cliId)
      : [...visibleClis, cliId];
    setVisibleClis(next);
    try {
      await skillHubApi.setVisibleClis(next);
      onStatus(`已更新显示的 CLI`);
    } catch (e: any) {
      onStatus(`保存失败: ${e.message || e}`);
    }
  }, [visibleClis, onStatus]);

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
          <TextInput
            label="API Key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <TextInput
            label="网络代理"
            value={proxy}
            onChange={(event) => setProxy(event.target.value)}
            placeholder="http://127.0.0.1:7890"
          />
        </div>
        <div className="panel-actions settings-actions">
          <Button variant="primary" onClick={saveAiConfig}>保存配置</Button>
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
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
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
          <div style={{ marginTop: "12px", color: "#1976d2", fontSize: "13px" }}>
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
          {ALL_CLIS.map((cli) => {
            const detected = detectedClis.includes(cli.id);
            const visible = visibleClis.includes(cli.id);
            return (
              <CliToggleCard
                key={cli.id}
                name={cli.label}
                detected={detected}
                visible={visible}
                onToggle={() => toggleCli(cli.id)}
              />
            );
          })}
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
      onClick={disabled ? undefined : onClick}
      style={{
        flex: 1,
        padding: "16px",
        border: active ? "2px solid #4a9eff" : "2px solid #e0e0e0",
        borderRadius: "8px",
        background: active ? "#f0f7ff" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
        <span style={{ color: active ? "#4a9eff" : "#888" }}>{icon}</span>
        <strong style={{ color: active ? "#333" : "#555", fontSize: "14px" }}>{title}</strong>
        {active && <span style={{ color: "#4a9eff", fontSize: "12px", marginLeft: "auto" }}>当前</span>}
      </div>
      <p style={{ margin: 0, fontSize: "13px", color: "#888" }}>{desc}</p>
    </div>
  );
}

interface CliToggleCardProps {
  name: string;
  detected: boolean;
  visible: boolean;
  onToggle: () => void;
}

function CliToggleCard({ name, detected, visible, onToggle }: CliToggleCardProps) {
  return (
    <div
      className="cli-status-card"
      onClick={detected ? onToggle : undefined}
      style={{ cursor: detected ? "pointer" : "default", opacity: detected ? 1 : 0.5 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          type="checkbox"
          checked={visible}
          disabled={!detected}
          onChange={detected ? onToggle : undefined}
          style={{ cursor: detected ? "pointer" : "default" }}
        />
        <strong>{name}</strong>
      </div>
      <span>
        {detected ? (
          <><CheckCircle2 size={14} />已检测</>
        ) : (
          "未检测到"
        )}
      </span>
    </div>
  );
}
