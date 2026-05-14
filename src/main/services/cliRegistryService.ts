import fs from "node:fs";
import path from "node:path";
import type { CliRow } from "../../shared/types/skill";
import { userHome } from "../database/paths";
import { getConfig } from "./configService";

export function getCliDefinitions(): Record<string, string[]> {
  const definitions: Record<string, string[]> = {
    alma: [path.join(userHome, ".config", "alma", "skills"), path.join(userHome, ".alma", "skills")],
    claude: [
      path.join(userHome, ".claude", "skills"),
      path.join(userHome, "AppData", "Roaming", "Claude", "skills"),
      path.join(userHome, ".config", "claude", "skills"),
    ],
    cursor: [
      path.join(userHome, ".config", "cursor", "skills"),
      path.join(userHome, "AppData", "Roaming", "Cursor", "skills"),
      path.join(userHome, ".cursor", "skills"),
    ],
    continue: [
      path.join(userHome, ".continue", "skills"),
      path.join(userHome, ".continue", "prompts"),
      path.join(userHome, ".config", "continue", "skills"),
    ],
    gemini: [path.join(userHome, ".gemini", "skills"), path.join(userHome, ".config", "gemini", "skills")],
    codex: [path.join(userHome, ".codex", "skills"), path.join(userHome, ".config", "codex", "skills")],
    aion: [
      path.join(userHome, "AppData", "Roaming", "AionUi", "config", "skills"),
      path.join(userHome, ".config", "aion", "skills"),
      path.join(userHome, ".aion", "skills"),
    ],
  };

  const customClis = getConfig().custom_clis ?? {};
  for (const [name, paths] of Object.entries(customClis)) {
    if (!Array.isArray(paths)) continue;
    if (name in definitions) {
      console.warn(`[skill-hub] 自定义 CLI "${name}" 与内置同名，已忽略以保护内置定义`);
      continue;
    }
    definitions[name] = paths;
  }
  return definitions;
}

export function detectCliRows(): CliRow[] {
  return Object.entries(getCliDefinitions()).flatMap(([cli, paths]) => {
    const existing = paths.find((item) => fs.existsSync(item));
    return existing ? [{ cli, path: existing }] : [];
  });
}
