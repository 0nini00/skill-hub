import { contextBridge, ipcRenderer } from "electron";
import type { AiConfig, BackendResult, SkillFileEntry, SkillExportOptions, SkillSafetyReport } from "../shared/types/skill";
import type { RuleRow, CliRuleStatus } from "../shared/types/rule";
import type { SkillHubApi } from "../shared/types/electron-api";

const CHANNELS = {
  appState: "skill-hub:app-state",
  backend: "skill-hub:backend",
  selectDirectory: "skill-hub:select-directory",
  openPath: "skill-hub:open-path",
  listSkillFiles: "skill-hub:list-skill-files",
  readSkillFile: "skill-hub:read-skill-file",
  writeSkillFile: "skill-hub:write-skill-file",
  deleteSkillFile: "skill-hub:delete-skill-file",
  scanSkillSafety: "skill-hub:scan-skill-safety",
  exportSkill: "skill-hub:export-skill",
  listRules: "skill-hub:list-rules",
  readRule: "skill-hub:read-rule",
  writeRule: "skill-hub:write-rule",
  createRule: "skill-hub:create-rule",
  deleteRule: "skill-hub:delete-rule",
  linkRule: "skill-hub:link-rule",
  unlinkRule: "skill-hub:unlink-rule",
  getCliRuleStatus: "skill-hub:get-cli-rule-status",
} as const;

const api: SkillHubApi = {
  getAppState: () => ipcRenderer.invoke(CHANNELS.appState),
  runBackend: <T = unknown>(args: string[]): Promise<BackendResult<T>> =>
    ipcRenderer.invoke(CHANNELS.backend, args),
  getAiConfig: () => ipcRenderer.invoke("skill-hub:get-ai-config"),
  setAiConfig: (config: Required<AiConfig>) =>
    ipcRenderer.invoke("skill-hub:set-ai-config", config),
  selectDirectory: () => ipcRenderer.invoke(CHANNELS.selectDirectory),
  openPath: (targetPath: string) => ipcRenderer.invoke(CHANNELS.openPath, targetPath),
  listSkillFiles: (slug: string) => ipcRenderer.invoke(CHANNELS.listSkillFiles, slug),
  readSkillFile: (slug: string, relativePath: string) =>
    ipcRenderer.invoke(CHANNELS.readSkillFile, slug, relativePath),
  writeSkillFile: (slug: string, relativePath: string, content: string) =>
    ipcRenderer.invoke(CHANNELS.writeSkillFile, slug, relativePath, content),
  deleteSkillFile: (slug: string, relativePath: string) =>
    ipcRenderer.invoke(CHANNELS.deleteSkillFile, slug, relativePath),
  scanSkillSafety: (slug: string) => ipcRenderer.invoke(CHANNELS.scanSkillSafety, slug),
  exportSkill: (slug: string, format: string) =>
    ipcRenderer.invoke(CHANNELS.exportSkill, slug, format),
  listRules: () => ipcRenderer.invoke(CHANNELS.listRules),
  readRule: (slug: string) => ipcRenderer.invoke(CHANNELS.readRule, slug),
  writeRule: (slug: string, content: string) =>
    ipcRenderer.invoke(CHANNELS.writeRule, slug, content),
  createRule: (name: string, content: string) =>
    ipcRenderer.invoke(CHANNELS.createRule, name, content),
  deleteRule: (slug: string) => ipcRenderer.invoke(CHANNELS.deleteRule, slug),
  linkRule: (slug: string, cli: string) =>
    ipcRenderer.invoke(CHANNELS.linkRule, slug, cli),
  unlinkRule: (slug: string, cli: string) =>
    ipcRenderer.invoke(CHANNELS.unlinkRule, slug, cli),
  getCliRuleStatus: () => ipcRenderer.invoke(CHANNELS.getCliRuleStatus),
};

contextBridge.exposeInMainWorld("skillHub", api);
