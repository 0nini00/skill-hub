import type { AiConfig, AppState, BackendResult } from "./skill";

export interface SkillHubApi {
  getAppState(): Promise<AppState>;
  runBackend<T = unknown>(args: string[]): Promise<BackendResult<T>>;
  getAiConfig(): Promise<AiConfig>;
  setAiConfig(config: Required<AiConfig>): Promise<BackendResult>;
  selectDirectory(): Promise<string | null>;
  openPath(path: string): Promise<boolean>;
}

declare global {
  interface Window {
    skillHub: SkillHubApi;
  }
}
