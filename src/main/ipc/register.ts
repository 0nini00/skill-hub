import { dialog, ipcMain, shell } from "electron";
import { CHANNELS } from "../../shared/constants/channels";
import { getAppState } from "../services/skillService";
import { getAiConfig, setAiConfig } from "../services/settingsService";
import { runBackend } from "../services/backendService";

export function registerIpcHandlers(): void {
  ipcMain.handle(CHANNELS.appState, () => getAppState());
  ipcMain.handle(CHANNELS.backend, (_event, args: string[]) => runBackend(args));
  ipcMain.handle(CHANNELS.selectDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle(CHANNELS.openPath, async (_event, targetPath: string) => {
    if (!targetPath) {
      return false;
    }
    await shell.openPath(targetPath);
    return true;
  });
  ipcMain.handle("skill-hub:get-ai-config", () => getAiConfig());
  ipcMain.handle("skill-hub:set-ai-config", (_event, config) => setAiConfig(config));
}
