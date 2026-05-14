import { BrowserWindow, globalShortcut } from "electron";

export function registerShortcuts(getWindow: () => BrowserWindow | null): void {
  globalShortcut.register("CommandOrControl+R", () => {
    getWindow()?.webContents.reload();
  });
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
