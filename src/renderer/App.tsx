import { useEffect, useMemo, useState } from "react";
import { AppShell, type ViewId } from "./components/layout/AppShell";
import { MarketPage } from "./components/prompt/MarketPage";
import { ProjectInstallPage } from "./components/folder/ProjectInstallPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { SkillMatrix } from "./components/skill/SkillMatrix";
import { skillHubApi } from "./services/skillHubApi";
import { formatAiSummaryStatus } from "./services/statusMessages";
import { useSkillHubState } from "./stores/useSkillHubState";

const viewTitles: Record<ViewId, string> = {
  matrix: "主页",
  market: "skills导入",
  project: "项目安装",
  settings: "设置",
};

export function App() {
  const [view, setView] = useState<ViewId>("matrix");
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  const title = useMemo(() => viewTitles[view], [view]);

  async function summarizeCurrentView() {
    setStatus("正在生成 AI 摘要…");
    try {
      // 对每个没有摘要的技能调用 AI 生成
      for (const skill of visibleSkills) {
        if (skill.summary && skill.summary.length > 5) continue;
        // 简化：直接传空内容，后端会自动读取 SKILL.md
        await skillHubApi.aiSummarize(skill.slug, "");
        setStatus(`已生成: ${skill.name}`);
      }
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
      {view === "matrix" ? (
        <SkillMatrix
          skills={visibleSkills}
          hiddenSkills={hiddenSkills}
          detectedClis={state.detectedClis}
          visibleClis={state.visibleClis}
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
          detectedClis={state.detectedClis}
          onRun={runAndRefresh}
          onStatus={setStatus}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsPage
          detectedClis={state.detectedClis}
          visibleClis={state.visibleClis}
          onRefresh={refresh}
          onStatus={setStatus}
          onRun={runAndRefresh}
        />
      ) : null}
    </AppShell>
  );
}
