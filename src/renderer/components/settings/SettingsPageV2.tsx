import { CheckCircle2, KeyRound, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

interface SettingsPageProps {
  onStatus(message: string): void;
}

export function SettingsPageV2({ onStatus }: SettingsPageProps) {
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [proxy, setProxy] = useState("");

  useEffect(() => {
    skillHubApi.getAiConfig().then((config) => {
      setApiUrl(config.api_url ?? "");
      setApiKey(config.api_key ?? "");
      setModel(config.model ?? "");
      setProxy(config.proxy ?? "");
    }).catch((err) => {
      console.error("getAiConfig error:", err);
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
          <div className="card-icon"><Settings2 size={18} /></div>
          <div>
            <h3>支持的 CLI</h3>
            <p>当前纳入 Skill Hub 管理的 CLI。</p>
          </div>
        </div>
        <div className="cli-card-grid">
          <CliStatusCard name="Claude Code" />
          <CliStatusCard name="Codex CLI" />
          <CliStatusCard name="Gemini CLI" />
        </div>
      </section>
    </div>
  );
}

interface CliStatusCardProps {
  name: string;
}

function CliStatusCard({ name }: CliStatusCardProps) {
  return (
    <div className="cli-status-card">
      <strong>{name}</strong>
      <span><CheckCircle2 size={14} />已检测</span>
    </div>
  );
}
