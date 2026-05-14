import { useCallback, useMemo, useState } from "react";
import type { AppState, BackendResult, SkillRow } from "@shared/types/skill";
import { inferSkillCategory } from "@shared/constants/categories";
import { skillHubApi } from "../services/skillHubApi";

interface SkillHubState {
  state: AppState;
  loading: boolean;
  status: string;
  error: string;
  visibleSkills: SkillRow[];
  hiddenSkills: SkillRow[];
  refresh(): Promise<void>;
  runAndRefresh(args: string[], successMessage: SuccessMessage): Promise<BackendResult>;
  setStatus(message: string): void;
}

export type SuccessMessage = string | ((result: BackendResult) => string);

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
      const skills = next.skills.map((row) => ({
        ...row,
        category: inferSkillCategory(row),
      }));
      setState({ ...next, skills });
      const hiddenCount = skills.filter((row) => row.hidden).length;
      setStatus(`已就绪: ${skills.length} 个技能${hiddenCount ? `，隐藏 ${hiddenCount} 个` : ""}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "同步失败";
      setError(message);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const runAndRefresh = useCallback(
    async (args: string[], successMessage: SuccessMessage) => {
      setLoading(true);
      setError("");
      setStatus("正在处理");
      try {
        const result = await skillHubApi.runBackend(args);
        if (!result.ok) {
          const message = result.message || "操作失败";
          setError(message);
          setStatus(message);
          return result;
        }
        await refresh();
        setStatus(typeof successMessage === "function" ? successMessage(result) : successMessage);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "操作失败";
        setError(message);
        setStatus(message);
        return {
          ok: false,
          data: null,
          stdout: "",
          stderr: message,
          message,
        };
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

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
    runAndRefresh,
    setStatus,
  };
}
