import { FileUp, Link2, Network } from "lucide-react";
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

type TabId = "git" | "local";

export function MarketPage({ onRefreshApp, onStatus }: MarketPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("git");
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

    try {
      const result = await skillHubApi.gitImport(url);
      if (result.ok) {
        setRepoUrl("");
        onStatus(`技能「${result.data?.slug}」已导入`);
        onRefreshApp();
      } else {
        onStatus(result.message || result.stderr || "导入失败");
      }
    } catch (e: any) {
      onStatus(`导入失败: ${e.message || e}`);
    }
  }

  async function importLocal() {
    try {
      const result = await skillHubApi.importLocal();
      if (result.ok) {
        const { type, name } = result.data || {};
        if (type === "skill") {
          onStatus(`Skill「${name}」已导入`);
        } else if (type === "rule") {
          onStatus(`Rule「${name}」已导入`);
        } else {
          onStatus("导入成功");
        }
        onRefreshApp();
      } else {
        onStatus(result.message || "导入失败");
      }
    } catch (e: any) {
      onStatus(`导入失败: ${e.message || e}`);
    }
  }

  return (
    <div className="page-stack">
      {/* 标签页导航 */}
      <div style={{
        display: "flex",
        gap: "8px",
        padding: "16px 24px 0",
        borderBottom: "1px solid #333",
      }}>
        <TabButton
          active={activeTab === "git"}
          onClick={() => setActiveTab("git")}
          icon={<Link2 size={16} />}
        >
          Git 导入
        </TabButton>
        <TabButton
          active={activeTab === "local"}
          onClick={() => setActiveTab("local")}
          icon={<FileUp size={16} />}
        >
          本地导入
        </TabButton>
      </div>

      {/* 标签页内容 */}
      {activeTab === "git" && (
        <section className="panel import-console">
          <div className="import-actions-grid">
            <div className="import-action-card primary-import-card">
              <div className="import-card-header">
                <span className="card-icon"><Link2 size={18} /></span>
                <div>
                  <h3>从 Git 导入</h3>
                  <p>输入仓库地址，自动拉取并加入 Skill Hub。</p>
                </div>
              </div>
              <div className="import-inline-control">
                <TextInput
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/example/skill-repo"
                />
                <Button variant="primary" icon={<Link2 size={16} />} onClick={installUrl}>导入</Button>
              </div>
            </div>
          </div>

          <div className="proxy-strip">
            <div className="proxy-strip-title">
              <span className="card-icon small-card-icon"><Network size={15} /></span>
              <div>
                <strong>网络代理</strong>
                <span>用于 Git 下载和摘要请求</span>
              </div>
            </div>
            <div className="proxy-strip-control">
              <TextInput
                value={proxy}
                onChange={(event) => setProxy(event.target.value)}
                placeholder="http://127.0.0.1:7890"
              />
              <Button onClick={saveProxy}>保存</Button>
            </div>
          </div>
        </section>
      )}

      {activeTab === "local" && (
        <section className="panel import-console">
          <div className="import-actions-grid">
            <div className="import-action-card local-import-card">
              <div className="import-card-header">
                <span className="card-icon"><FileUp size={18} /></span>
                <div>
                  <h3>从本地导入</h3>
                  <p>选择本地 Skill 或 Rule 文件。</p>
                </div>
              </div>
              <Button variant="success" icon={<FileUp size={16} />} onClick={importLocal}>
                选择文件或文件夹
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function TabButton({ active, onClick, icon, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        background: active ? "#2a2a2a" : "transparent",
        color: active ? "#fff" : "#888",
        border: "none",
        borderBottom: active ? "2px solid #4a9eff" : "2px solid transparent",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: active ? 600 : 400,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        transition: "all 0.2s",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = "#ccc";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = "#888";
        }
      }}
    >
      {icon}
      {children}
    </button>
  );
}
