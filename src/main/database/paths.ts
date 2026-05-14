import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export const userHome = os.homedir();
export const skillHubBaseDir = path.join(userHome, ".config", "skill-hub");
export const skillHubDbPath = path.join(skillHubBaseDir, "usage.db");
export const skillHubSkillsDir = path.join(skillHubBaseDir, "skills");
export const skillHubAdaptersDir = path.join(skillHubBaseDir, "adapters");
export const skillHubReposDir = path.join(skillHubBaseDir, "repos");
export const skillHubSingleReposDir = path.join(skillHubBaseDir, "single-repos");
export const skillHubConfigPath = path.join(skillHubBaseDir, "config.json");
export const skillHubAiConfigPath = path.join(skillHubBaseDir, "ai_config.json");
export const skillHubRemoteSummariesPath = path.join(skillHubBaseDir, "remote_summaries.json");

export const projectCliDirs: Record<string, string> = {
  alma: ".alma/skills",
  claude: ".claude/skills",
  cursor: ".cursor/skills",
  continue: ".continue/skills",
  gemini: ".gemini/skills",
  codex: ".codex/skills",
  opencode: ".opencode/skills",
};

export const builtinRepos = [
  "https://github.com/JimLiu/baoyu-skills",
  "https://github.com/ComposioHQ/awesome-claude-prompts",
  "https://github.com/anthropics/skills",
  "https://github.com/cexll/myclaude",
  "https://github.com/google-gemini/gemini-cli",
  "https://github.com/addyosmani/agent-skills",
];

export function ensureBaseDirs(): void {
  for (const dir of [
    skillHubBaseDir,
    skillHubSkillsDir,
    skillHubAdaptersDir,
    skillHubReposDir,
    skillHubSingleReposDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
