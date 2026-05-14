import fs from "node:fs";
import type { AiConfig } from "../../shared/types/skill";
import { ensureBaseDirs, skillHubAiConfigPath, skillHubConfigPath } from "../database/paths";

export interface SkillHubConfig {
  custom_clis?: Record<string, string[]>;
  visible_clis?: string[];
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureBaseDirs();
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function getConfig(): SkillHubConfig {
  return readJsonFile<SkillHubConfig>(skillHubConfigPath, {});
}

export function saveConfig(config: SkillHubConfig): void {
  writeJsonFile(skillHubConfigPath, config);
}

export function getVisibleClis(): string[] {
  return getConfig().visible_clis ?? [];
}

export function setVisibleClis(clis: string[]): void {
  const config = getConfig();
  config.visible_clis = clis.map((item) => item.trim().toLowerCase()).filter(Boolean);
  saveConfig(config);
}

export const BUILTIN_CLI_NAMES = ["alma", "claude", "cursor", "continue", "gemini", "codex", "aion"] as const;

export function addCustomCli(name: string, skillsPath: string): void {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new Error("CLI 名称不能为空");
  }
  if ((BUILTIN_CLI_NAMES as readonly string[]).includes(normalized)) {
    throw new Error(`不能用内置 CLI 名称作为自定义 CLI: ${normalized}`);
  }
  const config = getConfig();
  const customClis = config.custom_clis ?? {};
  customClis[normalized] = [skillsPath];
  config.custom_clis = customClis;
  saveConfig(config);
}

export function removeCustomCli(name: string): void {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new Error("CLI 名称不能为空");
  }
  const config = getConfig();
  if (!config.custom_clis || !(normalized in config.custom_clis)) {
    return;
  }
  delete config.custom_clis[normalized];
  saveConfig(config);
}

export function getAiConfig(): AiConfig {
  return readJsonFile<AiConfig>(skillHubAiConfigPath, {});
}

export function setAiConfig(config: Required<AiConfig>): void {
  writeJsonFile(skillHubAiConfigPath, {
    api_url: config.api_url,
    api_key: config.api_key,
    model: config.model,
    proxy: config.proxy,
  });
}
