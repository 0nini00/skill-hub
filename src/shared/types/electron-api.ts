import type { AiConfig, AppState, BackendResult } from "./skill";

import type { SkillFileEntry, SkillExportOptions, SkillSafetyReport } from "./skill";
import type { RuleRow, CliRuleStatus } from "./rule";

export interface SkillHubApi {
  getAppState(): Promise<AppState>;
  runBackend<T = unknown>(args: string[]): Promise<BackendResult<T>>;
  getAiConfig(): Promise<AiConfig>;
  setAiConfig(config: Required<AiConfig>): Promise<BackendResult>;
  selectDirectory(): Promise<string | null>;
  openPath(path: string): Promise<boolean>;
  listSkillFiles(slug: string): Promise<SkillFileEntry[]>;
  readSkillFile(slug: string, relativePath: string): Promise<string | null>;
  writeSkillFile(slug: string, relativePath: string, content: string): Promise<boolean>;
  deleteSkillFile(slug: string, relativePath: string): Promise<boolean>;
  scanSkillSafety(slug: string): Promise<SkillSafetyReport>;
  exportSkill(slug: string, format: string): Promise<string>;
  listRules(): Promise<RuleRow[]>;
  readRule(slug: string): Promise<string | null>;
  writeRule(slug: string, content: string): Promise<string>;
  createRule(name: string, content: string): Promise<RuleRow>;
  deleteRule(slug: string): Promise<void>;
  linkRule(slug: string, cli: string): Promise<string>;
  unlinkRule(slug: string, cli: string): Promise<boolean>;
  getCliRuleStatus(): Promise<CliRuleStatus[]>;
}

declare global {
  interface Window {
    skillHub: SkillHubApi;
  }
}
