import { dialog, ipcMain, shell } from "electron";
import { CHANNELS } from "../../shared/constants/channels";
import { getAppState } from "../services/skillService";
import { listSkillFiles, readSkillFile, writeSkillFile, deleteSkillFile } from "../services/skillFileService";
import { scanSkillSafety } from "../services/skillSafetyService";
import { listRules, readRule, writeRule, createRule, deleteRule, linkRuleToCli, unlinkRuleFromCli, getCliRuleStatus } from "../services/ruleService";
import { exportAsSkillMd, exportAsJson } from "../services/skillUtils";
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

  // New PromptHub-inspired features
  ipcMain.handle(CHANNELS.listSkillFiles, (_event, slug: string) => listSkillFiles(slug));
  ipcMain.handle(CHANNELS.readSkillFile, (_event, slug: string, relativePath: string) =>
    readSkillFile(slug, relativePath),
  );
  ipcMain.handle(CHANNELS.writeSkillFile, (_event, slug: string, relativePath: string, content: string) =>
    writeSkillFile(slug, relativePath, content),
  );
  ipcMain.handle(CHANNELS.deleteSkillFile, (_event, slug: string, relativePath: string) =>
    deleteSkillFile(slug, relativePath),
  );
  ipcMain.handle(CHANNELS.scanSkillSafety, async (_event, slug: string) => {
    const { getSkillSourcePath } = await import("../services/skillLibraryService.js");
    const skillDir = getSkillSourcePath(slug);
    if (!skillDir) return null;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) return null;
    const content = fs.readFileSync(skillMdPath, "utf-8");
    return scanSkillSafety(content);
  });
  ipcMain.handle(CHANNELS.exportSkill, async (_event, slug: string, format: string) => {
    const state = await getAppState();
    const row = state.skills.find((s) => s.slug === slug);
    if (!row) return "";
    if (format === "json") return exportAsJson(row);
    return exportAsSkillMd(row);
  });

  ipcMain.handle(CHANNELS.listRules, () => listRules());
  ipcMain.handle(CHANNELS.readRule, (_event, slug: string) => readRule(slug));
  ipcMain.handle(CHANNELS.writeRule, (_event, slug: string, content: string) =>
    writeRule(slug, content),
  );
  ipcMain.handle(CHANNELS.createRule, (_event, name: string, content: string) =>
    createRule(name, content),
  );
  ipcMain.handle(CHANNELS.deleteRule, (_event, slug: string) => { deleteRule(slug); });
  ipcMain.handle(CHANNELS.linkRule, (_event, slug: string, cli: string) =>
    linkRuleToCli(slug, cli),
  );
  ipcMain.handle(CHANNELS.unlinkRule, (_event, slug: string, cli: string) =>
    unlinkRuleFromCli(slug, cli),
  );
  ipcMain.handle(CHANNELS.getCliRuleStatus, () => getCliRuleStatus());
}
