import { contextBridge, ipcRenderer } from "electron";
import type { AiConfig, BackendResult } from "../shared/types/skill";
import type { SkillHubApi } from "../shared/types/electron-api";

const CHANNELS = {
  appState: "skill-hub:app-state",
  backend: "skill-hub:backend",
  selectDirectory: "skill-hub:select-directory",
  openPath: "skill-hub:open-path",
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
};

contextBridge.exposeInMainWorld("skillHub", api);
