import { useEffect, useState } from "react";
import type { BackendResult } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

interface MarketPageProps {
  onRefreshApp(): void;
  onStatus(message: string): void;
  onRun(args: string[], successMessage: string | ((result: BackendResult) => string)): Promise<BackendResult>;
}

export function MarketPage({ onRefreshApp, onStatus, onRun }: MarketPageProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [proxy, setProxy] = useState("");

  useEffect(() => {
    skillHubApi.getAiConfig().then((config) => {
      setProxy(config.proxy ?? "");
    }).catch((err) => {
      console.error("getAiConfig error:", err);
    });
  }, []);

  async function saveProxy() {
    const config = await skillHubApi.getAiConfig();
    const result = await skillHubApi.setAiConfig({
      api_url: config.api_url ?? "",
      api_key: config.api_key ?? "",
      model: config.model ?? "",
      proxy: proxy.trim(),
    });
    onStatus(result.ok ? "网络代理已保存" : result.message || "网络代理保存失败");
  }

  async function installUrl() {
    const url = repoUrl.trim();
    if (!url) {
      onStatus("请填写 Git 仓库链接");
      return;
    }

    const result = await onRun(["install-url", "--url", url], "链接技能已添加");
    if (result.ok) {
      setRepoUrl("");
      onRefreshApp();
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>网络代理</h3>
            <p>Git 下载和 AI 摘要请求会优先使用这里的代理地址。</p>
          </div>
        </div>
        <div className="inline-form">
          <TextInput
            label="代理地址"
            value={proxy}
            onChange={(event) => setProxy(event.target.value)}
            placeholder="http://127.0.0.1:7890"
          />
          <Button variant="primary" onClick={saveProxy}>
            保存代理
          </Button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>添加单个 Skill</h3>
            <p>粘贴包含 SKILL.md 的 Git 仓库链接。</p>
          </div>
        </div>
        <div className="inline-form">
          <TextInput
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/example/skill-repo"
          />
          <Button variant="primary" onClick={installUrl}>
            添加到技能库
          </Button>
        </div>
      </section>
    </div>
  );
}
