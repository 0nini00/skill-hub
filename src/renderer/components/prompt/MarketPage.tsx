import { FileUp, Link2 } from "lucide-react";
import { useState } from "react";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";
import { useToast } from "../ui/Toast";

interface MarketPageProps {
  onRefreshApp(): void;
}

type TabId = "git" | "local";

export function MarketPage({ onRefreshApp }: MarketPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>("git");
  const [repoUrl, setRepoUrl] = useState("");
  const toast = useToast();

  async function installUrl() {
    const url = repoUrl.trim();
    if (!url) {
      toast("请填写 Git 仓库链接", "info");
      return;
    }

    try {
      const result = await skillHubApi.gitImport(url);
      if (result.ok) {
        setRepoUrl("");
        toast(`技能「${result.data?.slug}」已导入`, "success");
        onRefreshApp();
      } else {
        toast(result.message || result.stderr || "导入失败", "error");
      }
    } catch (e: any) {
      toast(`导入失败: ${e.message || e}`, "error");
    }
  }

  async function importLocal() {
    try {
      const result = await skillHubApi.importLocal();
      if (result.ok) {
        const { type, name } = result.data || {};
        if (type === "skill") {
          toast(`Skill「${name}」已导入`, "success");
        } else if (type === "rule") {
          toast(`Rule「${name}」已导入`, "success");
        } else {
          toast("导入成功", "success");
        }
        onRefreshApp();
      } else {
        toast(result.message || "导入失败", "error");
      }
    } catch (e: any) {
      toast(`导入失败: ${e.message || e}`, "error");
    }
  }

  return (
    <div className="page-stack">
      {/* 标签页导航 */}
      <div className="import-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "git"}
          className={`tab-button ${activeTab === "git" ? "active" : ""}`}
          onClick={() => setActiveTab("git")}
          type="button"
        >
          <Link2 size={16} aria-hidden="true" />
          Git 导入
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "local"}
          className={`tab-button ${activeTab === "local" ? "active" : ""}`}
          onClick={() => setActiveTab("local")}
          type="button"
        >
          <FileUp size={16} aria-hidden="true" />
          本地导入
        </button>
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
