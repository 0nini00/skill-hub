import { useEffect, useMemo, useState } from "react";
import { AppShell, type ViewId } from "./components/layout/AppShell";
import { MarketPage } from "./components/prompt/MarketPage";
import { ProjectInstallPage } from "./components/folder/ProjectInstallPage";
import { SettingsPageV2 } from "./components/settings/SettingsPageV2";
import { SkillMatrix } from "./components/skill/SkillMatrix";
import { RulesPageV2 } from "./components/rule/RulesPageV2";
import { skillHubApi } from "./services/skillHubApi";
import { useSkillHubState } from "./stores/useSkillHubState";

const viewTitles: Record<ViewId, string> = {
  skills: "Skills 管理",
  market: "导入 Skills",
  project: "项目安装",
  rules: "Rules 管理",
  settings: "设置",
};

export function App() {
  const [view, setView] = useState<ViewId>("skills");
  const {
    state,
    loading,
    status,
    error,
    visibleSkills,
    hiddenSkills,
    refresh,
    runAndRefresh,
    setStatus,
  } = useSkillHubState();

  // 只保留三个核心 CLI
  const CORE_CLIS = ["claude", "codex", "gemini"];
  const coreDetectedClis = state.detectedClis.filter(cli => CORE_CLIS.includes(cli.cli));
  const coreVisibleClis = state.visibleClis.filter(cli => CORE_CLIS.includes(cli));

  useEffect(() => {
    refresh();
  }, [refresh]);

  const title = useMemo(() => viewTitles[view], [view]);

  async function summarizeCurrentView() {
    setStatus("正在生成 AI 摘要...");
    try {
      await skillHubApi.aiSummarize("", "");
      setStatus("AI 摘要生成完成");
      await refresh();
    } catch (e: any) {
      setStatus(`AI 摘要失败: ${e.message || e}`);
    }
  }

  return (
    <AppShell
      view={view}
      title={title}
      status={error || status}
      loading={loading}
      summaryLabel="AI 摘要"
      showSummaryAction={true}
      onViewChange={setView}
      onRefresh={refresh}
      onSummarize={summarizeCurrentView}
    >
      {view === "skills" ? (
        <SkillMatrix
          skills={visibleSkills}
          hiddenSkills={hiddenSkills}
          detectedClis={coreDetectedClis}
          visibleClis={coreVisibleClis}
          onRefresh={refresh}
          onRun={runAndRefresh}
        />
      ) : null}

      {view === "market" ? (
        <MarketPage
          onRefreshApp={refresh}
          onStatus={setStatus}
          onRun={runAndRefresh}
        />
      ) : null}

      {view === "project" ? (
        <ProjectInstallPage
          skills={visibleSkills}
          detectedClis={coreDetectedClis}
          onRun={runAndRefresh}
          onStatus={setStatus}
        />
      ) : null}

      {view === "rules" ? (
        <RulesPageV2
          detectedClis={coreDetectedClis}
          visibleClis={coreVisibleClis}
          onRefresh={refresh}
          onRun={runAndRefresh}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsPageV2
          onStatus={setStatus}
        />
      ) : null}
    </AppShell>
  );
}
