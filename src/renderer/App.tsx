import { useEffect, useMemo, useState } from "react";
import { AppShell, type ViewId } from "./components/layout/AppShell";
import { Skeleton } from "./components/ui/Skeleton";
import { MarketPage } from "./components/prompt/MarketPage";
import { ProjectInstallPage } from "./components/folder/ProjectInstallPage";
import { SettingsPageV2 } from "./components/settings/SettingsPageV2";
import { SkillMatrix } from "./components/skill/SkillMatrix";
import { RulesPageV2 } from "./components/rule/RulesPageV2";
import type { AiConfig } from "@shared/types/skill";
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
  const [aiConfig, setAiConfig] = useState<AiConfig>({});
  const {
    state,
    loading,
    status,
    error,
    visibleSkills,
    hiddenSkills,
    refresh,
    setStatus,
  } = useSkillHubState();

  // 使用配置中的 visible_clis，未配置则显示所有检测到的 CLI
  const visibleCliNames = state.visibleClis.length > 0
    ? state.visibleClis
    : state.detectedClis.map(c => c.cli);
  const coreDetectedClis = state.detectedClis.filter(cli => visibleCliNames.includes(cli.cli));
  // 稳定引用:避免每次渲染生成新数组导致 SettingsPageV2 的同步 effect 反复触发
  const detectedCliNames = useMemo(() => state.detectedClis.map(c => c.cli), [state.detectedClis]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // AI 配置全局只加载一次，MarketPage / SettingsPageV2 共享，保存后同步
  useEffect(() => {
    skillHubApi.getAiConfig().then(setAiConfig).catch((err) => {
      console.error("getAiConfig error:", err);
    });
  }, []);

  const title = useMemo(() => viewTitles[view], [view]);

  async function summarizeCurrentView() {
    const targets = state.skills.filter((row) => !row.missing);
    if (!targets.length) {
      setStatus("没有可生成摘要的技能");
      return;
    }
    setStatus(`正在生成 AI 摘要 (0/${targets.length})...`);
    let success = 0;
    const failed: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      setStatus(`正在为「${row.name}」生成摘要 (${i + 1}/${targets.length})...`);
      try {
        await skillHubApi.aiSummarize(row.slug, "");
        success += 1;
      } catch (e: any) {
        failed.push(`${row.name}${e?.message ? `: ${e.message}` : ""}`);
      }
    }
    const failText = failed.length ? `，失败 ${failed.length} 个${failed.length <= 3 ? `（${failed.join("，")}）` : ""}` : "";
    setStatus(`AI 摘要完成: ${success}/${targets.length} 成功${failText}`);
    await refresh();
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
      {/* 首次加载：后端 get_app_state 全量构建期间显示骨架屏，不阻塞 UI 交互 */}
      {loading && !state.skills.length ? (
        <Skeleton />
      ) : view === "skills" ? (
        <SkillMatrix
          skills={visibleSkills}
          hiddenSkills={hiddenSkills}
          detectedClis={coreDetectedClis}
          onRefresh={refresh}
        />
      ) : null}

      {view === "market" ? (
        <MarketPage onRefreshApp={refresh} />
      ) : null}

      {view === "project" ? (
        <ProjectInstallPage
          skills={visibleSkills}
          detectedClis={coreDetectedClis}
          onStatus={setStatus}
        />
      ) : null}

      {view === "rules" ? (
        <RulesPageV2
          detectedClis={coreDetectedClis}
          onRefresh={refresh}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsPageV2
          onStatus={setStatus}
          detectedClis={detectedCliNames}
          visibleClis={state.visibleClis}
          onRefresh={refresh}
          aiConfig={aiConfig}
          onAiConfigChange={setAiConfig}
        />
      ) : null}
    </AppShell>
  );
}
