import { useEffect, useMemo, useState } from "react";
import type { BackendResult, CliRow } from "@shared/types/skill";
import { skillHubApi } from "../../services/skillHubApi";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

interface SettingsPageProps {
  detectedClis: CliRow[];
  visibleClis: string[];
  onRefresh(): void;
  onStatus(message: string): void;
  onRun(args: string[], successMessage: string): Promise<BackendResult>;
}

export function SettingsPage({ detectedClis, visibleClis, onRefresh, onStatus, onRun }: SettingsPageProps) {
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [customName, setCustomName] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [proxy, setProxy] = useState("");
  const [customClis, setCustomClis] = useState<Record<string, string[]>>({});
  const [selectedClis, setSelectedClis] = useState<string[]>([]);

  async function loadCustomClis() {
    try {
      const result = await skillHubApi.runBackend<Record<string, string[]>>(["list-custom-clis"]);
      if (result.ok && result.data && typeof result.data === "object") {
        setCustomClis(result.data);
      }
    } catch (err) {
      console.error("list-custom-clis error:", err);
    }
  }

  useEffect(() => {
    skillHubApi.getAiConfig().then((config) => {
      setApiUrl(config.api_url ?? "");
      setApiKey(config.api_key ?? "");
      setModel(config.model ?? "");
      setProxy(config.proxy ?? "");
    }).catch((err) => {
      console.error("getAiConfig error:", err);
    });
    loadCustomClis();
  }, []);

  useEffect(() => {
    setSelectedClis(visibleClis.length ? visibleClis : detectedClis.map((item) => item.cli));
  }, [detectedClis, visibleClis]);

  const allSelected = useMemo(
    () => detectedClis.length > 0 && selectedClis.length === detectedClis.length,
    [detectedClis.length, selectedClis.length],
  );

  async function saveAiConfig() {
    const result = await skillHubApi.setAiConfig({
      api_url: apiUrl,
      api_key: apiKey,
      model,
      proxy,
    });
    onStatus(result.ok ? "AI 配置已保存" : result.message || "AI 配置保存失败");
  }

  async function addCustomCli() {
    if (!customName.trim() || !customPath.trim()) {
      onStatus("请填写 CLI 名称和路径");
      return;
    }
    await onRun(["add-custom-cli", "--name", customName.trim(), "--path", customPath.trim()], "自定义 CLI 已添加");
    setCustomName("");
    setCustomPath("");
    loadCustomClis();
  }

  async function removeCustomCliEntry(name: string) {
    await onRun(["remove-custom-cli", "--name", name], `已删除自定义 CLI: ${name}`);
    loadCustomClis();
  }

  async function choosePath() {
    const selected = await skillHubApi.selectDirectory();
    if (selected) {
      setCustomPath(selected);
    }
  }

  async function saveVisibleClis() {
    const result = await skillHubApi.setVisibleClis(selectedClis);
    if (result.ok) {
      onStatus("展示列已保存");
      // 保存成功后自动刷新，应用新配置
      onRefresh();
    } else {
      onStatus(result.message || "展示列保存失败");
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>AI 摘要配置</h3>
            <p>OpenAI-compatible 接口配置会保存在本机用户目录。</p>
          </div>
        </div>
        <div className="form-grid">
          <TextInput label="API URL" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
          <TextInput label="API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          <TextInput label="模型名称" value={model} onChange={(event) => setModel(event.target.value)} />
        </div>
        <div className="panel-actions">
          <Button variant="primary" onClick={saveAiConfig}>保存 AI 配置</Button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>自定义 CLI</h3>
            <p>把任意 CLI 的 skills 目录纳入矩阵。</p>
          </div>
        </div>
        <div className="form-grid two-column">
          <TextInput label="CLI 名称" value={customName} onChange={(event) => setCustomName(event.target.value)} />
          <div className="path-field">
            <TextInput label="Skills 文件夹路径" value={customPath} onChange={(event) => setCustomPath(event.target.value)} />
            <Button onClick={choosePath}>浏览</Button>
          </div>
        </div>
        <div className="panel-actions">
          <Button variant="success" onClick={addCustomCli}>添加自定义 CLI</Button>
        </div>
        {Object.keys(customClis).length > 0 && (
          <div className="checkbox-list" style={{ marginTop: 12 }}>
            {Object.entries(customClis).map(([name, paths]) => (
              <div key={name} className="checkbox-row" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>{name}</span>
                  <small>{(paths ?? []).join(", ")}</small>
                </div>
                <Button onClick={() => removeCustomCliEntry(name)}>删除</Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>矩阵显示列</h3>
            <p>控制主页矩阵展示哪些 CLI。</p>
          </div>
          <Button onClick={() => setSelectedClis(allSelected ? [] : detectedClis.map((item) => item.cli))}>
            {allSelected ? "清空" : "全选"}
          </Button>
        </div>
        <div className="checkbox-list">
          {detectedClis.map((cli) => (
            <label key={cli.cli} className="checkbox-row">
              <input
                type="checkbox"
                checked={selectedClis.includes(cli.cli)}
                onChange={(event) => {
                  setSelectedClis((current) =>
                    event.target.checked
                      ? [...current, cli.cli]
                      : current.filter((item) => item !== cli.cli),
                  );
                }}
              />
              <span>{cli.cli}</span>
              <small>{cli.path}</small>
            </label>
          ))}
        </div>
        <div className="panel-actions">
          <Button variant="primary" onClick={saveVisibleClis}>保存展示列</Button>
          <Button onClick={onRefresh}>重新检测</Button>
        </div>
      </section>
    </div>
  );
}
