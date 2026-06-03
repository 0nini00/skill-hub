import fs from "node:fs";
import path from "node:path";
import type { CliRow } from "../../shared/types/skill";
import { userHome } from "../database/paths";

// 只支持三个核心 CLI
export function getCliRuleDefinitions(): Record<string, string[]> {
  return {
    claude: [
      path.join(userHome, ".claude"),
      path.join(userHome, "AppData", "Roaming", "Claude"),
      path.join(userHome, ".config", "claude"),
    ],
    codex: [
      path.join(userHome, ".codex"),
      path.join(userHome, ".config", "codex"),
    ],
    gemini: [
      path.join(userHome, ".gemini"),
      path.join(userHome, ".config", "gemini"),
    ],
  };
}

export function getRuleFileNameForCli(cli: string): string {
  if (cli === "claude") return "CLAUDE.md";
  if (cli === "gemini") return "GEMINI.md";
  return "AGENTS.md";
}

export function getRuleFileNamesForCli(cli: string): string[] {
  if (cli === "claude") return ["CLAUDE.md", "AGENTS.md"];
  if (cli === "gemini") return ["GEMINI.md", "AGENTS.md"];
  return ["AGENTS.md"];
}

export function getCliDefinitions(): Record<string, string[]> {
  const definitions: Record<string, string[]> = {
    claude: [
      path.join(userHome, ".claude", "skills"),
      path.join(userHome, "AppData", "Roaming", "Claude", "skills"),
      path.join(userHome, ".config", "claude", "skills"),
    ],
    codex: [
      path.join(userHome, ".codex", "skills"),
      path.join(userHome, ".config", "codex", "skills"),
    ],
    gemini: [
      path.join(userHome, ".gemini", "skills"),
      path.join(userHome, ".config", "gemini", "skills"),
    ],
  };

  return definitions;
}

export function detectCliRows(): CliRow[] {
  return Object.entries(getCliDefinitions()).flatMap(([cli, paths]) => {
    const existing = paths.find((item) => fs.existsSync(item));
    return existing ? [{ cli, path: existing }] : [];
  });
}
