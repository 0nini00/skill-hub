import { useMemo, useState } from "react";
import type { CliRow, SkillRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { TextInput } from "../ui/TextInput";

interface ProjectInstallPageProps {
  skills: SkillRow[];
  detectedClis: CliRow[];
  onRun(args: string[], successMessage: string): Promise<unknown>;
  onStatus(message: string): void;
}

export function ProjectInstallPage({ skills, detectedClis, onRun, onStatus }: ProjectInstallPageProps) {
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
    if (selected) {
      setProjectPath(selected);
    }
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
    await onRun(
      [
        "install-project-skills",
        "--project",
        projectPath,
        "--skills",
        selectedSkills.join(","),
        "--clis",
        selectedClis.join(","),
      ],
      "技能已安装到项目",
    );
  }

  if (!skills.length) {
    return <EmptyState message="技能库暂无技能，请先在 Skills 市场添加。" />;
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>项目目录</h3>
            <p>把选中的技能复制到项目内，并链接到项目级 CLI 目录。</p>
          </div>
        </div>
        <div className="inline-form">
          <TextInput value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="选择项目路径" />
          <Button onClick={chooseProject}>选择项目</Button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <h3>目标 CLI</h3>
        </div>
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
      </section>

      <section className="panel">
        <div className="toolbar">
          <TextInput label="筛选技能" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Button onClick={() => setSelectedSkills(filteredSkills.map((row) => row.slug))}>全选</Button>
          <Button onClick={() => setSelectedSkills([])}>清空</Button>
          <Button variant="primary" onClick={installToProject}>安装到项目</Button>
        </div>
        <div className="project-skill-list">
          {filteredSkills.map((row) => (
            <label key={row.slug} className="checkbox-row skill-check-row">
              <input
                type="checkbox"
                checked={selectedSkills.includes(row.slug)}
                onChange={(event) => {
                  setSelectedSkills((current) =>
                    event.target.checked ? [...current, row.slug] : current.filter((item) => item !== row.slug),
                  );
                }}
              />
              <span>{row.name}</span>
              <small>{row.summary}</small>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
