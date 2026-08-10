import { useCallback, useMemo, useState } from "react";
import type { AppState, SkillRow } from "@shared/types/skill";
import { skillHubApi } from "../services/skillHubApi";

interface SkillHubState {
  state: AppState;
  loading: boolean;
  status: string;
  error: string;
  visibleSkills: SkillRow[];
  hiddenSkills: SkillRow[];
  refresh(): Promise<void>;
  setStatus(message: string): void;
}

const emptyState: AppState = {
  skills: [],
  detectedClis: [],
  visibleClis: [],
};

export function useSkillHubState(): SkillHubState {
  const [state, setState] = useState<AppState>(emptyState);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setStatus("正在同步");
    try {
      const next = await skillHubApi.getAppState();
      // category 已由后端在 build_app_state 中推断并返回,前端无需再逐项计算
      setState(next);
      const hiddenCount = next.skills.filter((row) => row.hidden).length;
      setStatus(`已就绪: ${next.skills.length} 个技能${hiddenCount ? `，隐藏 ${hiddenCount} 个` : ""}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "同步失败";
      setError(message);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const visibleSkills = useMemo(() => state.skills.filter((row) => !row.hidden), [state.skills]);
  const hiddenSkills = useMemo(() => state.skills.filter((row) => row.hidden), [state.skills]);

  return {
    state,
    loading,
    status,
    error,
    visibleSkills,
    hiddenSkills,
    refresh,
    setStatus,
  };
}
