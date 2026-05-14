import type { AppState } from "../../shared/types/skill";
import { runBackend } from "./backendService";

export async function getAppState(): Promise<AppState> {
  const result = await runBackend<AppState>(["app-state"]);
  if (!result.ok || !result.data) {
    throw new Error(result.message || "读取应用状态失败");
  }
  return result.data;
}
