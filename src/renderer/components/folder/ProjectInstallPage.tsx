import { FolderInput, PackageCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { CliRow, SkillRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { TextInput } from "../ui/TextInput";

interface ProjectInstallPageProps {
  skills: SkillRow[];
  detectedClis: CliRow[];
  onStatus(message: string): void;
}

export function ProjectInstallPage({ skills, detectedClis, onStatus }: ProjectInstallPageProps) {
  const [projectPath, setProjectPath] = useState("");
  const [query, setQuery] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedClis, setSelectedClis] = useState<string[]>([]);

  const filteredSkills = useMemo(
    () =>
      skills.filter((row) => {
        const haystack = `${row.name} ${row.slug} ${row.summary}`.toLowerCase();
        return !query.trim() || haystack.includes(query.trim().toLowerCase());
      }),
    [query, skills],
  );

  async function chooseProject() {
    const selected = await skillHubApi.selectDirectory();
    if (selected) setProjectPath(selected);
  }

  async function installToProject() {
    if (!projectPath.trim()) {
      onStatus("请选择项目目录");
      return;
    }
    if (!selectedSkills.length) {
      onStatus("请至少选择一个技能");
      return;
    }
    if (!selectedClis.length) {
      onStatus("请至少选择一个 CLI");
      return;
    }

    const res = await skillHubApi.installSkillsToProject(projectPath, selectedSkills, selectedClis);
    onStatus(res.ok ? "技能已安装到项目" : res.message || res.stderr || "安装失败");
  }

  if (!skills.length) {
    return <EmptyState message="技能库暂无技能，请先在导入页添加。" />;
  }

  return (
    <div className="page-stack">
      <section className="panel project-install-panel">
        <div className="project-hero">
          <div className="card-icon"><FolderInput size={18} /></div>
          <div>
            <h3>项目安装</h3>
            <p>选择项目目录、目标 CLI 和要安装的 Skills。</p>
          </div>
        </div>

        <div className="project-path-card">
          <TextInput value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="选择项目路径" />
          <Button icon={<FolderInput size={16} />} onClick={chooseProject}>选择项目</Button>
        </div>

        <div className="project-section-block">
          <div className="project-section-title">目标 CLI</div>
          <div className="pill-row">
            {detectedClis.map((cli) => (
              <button
                key={cli.cli}
                type="button"
                className={`pill ${selectedClis.includes(cli.cli) ? "selected" : ""}`}
                onClick={() =>
                  setSelectedClis((current) =>
                    current.includes(cli.cli) ? current.filter((item) => item !== cli.cli) : [...current, cli.cli],
                  )
                }
              >
                {cli.cli}
              </button>
            ))}
          </div>
        </div>

        <div className="project-section-block">
          <div className="project-skill-toolbar">
            <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能" />
            <Button onClick={() => setSelectedSkills(filteredSkills.map((row) => row.slug))}>全选</Button>
            <Button onClick={() => setSelectedSkills([])}>清空</Button>
            <span className="toolbar-count">已选 {selectedSkills.length} / {filteredSkills.length}</span>
            <Button variant="primary" icon={<PackageCheck size={16} />} onClick={installToProject}>安装到项目</Button>
          </div>

          <div className="project-skill-grid">
            {filteredSkills.map((row) => {
              const checked = selectedSkills.includes(row.slug);
              return (
                <label key={row.slug} className={`project-skill-card ${checked ? "selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelectedSkills((current) =>
                        event.target.checked ? [...current, row.slug] : current.filter((item) => item !== row.slug),
                      );
                    }}
                  />
                  <div>
                    <strong title={row.name}>{row.name}</strong>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
