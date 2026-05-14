import type { AiConfig, AppState, BackendResult } from "@shared/types/skill";

export const skillHubApi = {
  getAppState(): Promise<AppState> {
    return window.skillHub.getAppState();
  },
  runBackend<T = unknown>(args: string[]): Promise<BackendResult<T>> {
    return window.skillHub.runBackend<T>(args);
  },
  getAiConfig(): Promise<AiConfig> {
    return window.skillHub.getAiConfig();
  },
  setAiConfig(config: Required<AiConfig>): Promise<BackendResult> {
    return window.skillHub.setAiConfig(config);
  },
  selectDirectory(): Promise<string | null> {
    return window.skillHub.selectDirectory();
  },
  openPath(path: string): Promise<boolean> {
    return window.skillHub.openPath(path);
  },
};
