import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AiConfig, AppState, BackendResult, SkillHubConfig } from "@shared/types/skill";
import type { RuleRow, CliRuleStatus } from "@shared/types/rule";

/**
 * Tauri 唯一后端通道：所有调用均走 invoke。
 */
export const skillHubApi = {
  async getAppState(): Promise<AppState> {
    return invoke<AppState>("get_app_state");
  },

  async getAiConfig(): Promise<AiConfig> {
    return invoke<AiConfig>("read_ai_config");
  },

  async getConfig(): Promise<SkillHubConfig> {
    return invoke<SkillHubConfig>("read_config");
  },

  async setAiConfig(config: Required<AiConfig>): Promise<BackendResult> {
    return invoke<BackendResult>("write_ai_config", { config });
  },

  async selectDirectory(): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return null;
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  },

  async openPath(path: string): Promise<boolean> {
    return invoke<boolean>("open_path", { path });
  },

  async linkSkill(cli: string, slug: string): Promise<BackendResult> {
    return invoke<BackendResult>("link_skill", { cli, slug });
  },

  async unlinkSkill(cli: string, slug: string): Promise<BackendResult> {
    return invoke<BackendResult>("unlink_skill", { cli, slug });
  },

  async hideSkill(slug: string): Promise<BackendResult> {
    return invoke<BackendResult>("set_skill_hidden", { slug, hidden: true });
  },

  async unhideSkill(slug: string): Promise<BackendResult> {
    return invoke<BackendResult>("set_skill_hidden", { slug, hidden: false });
  },

  async deleteSkill(slug: string): Promise<BackendResult> {
    return invoke<BackendResult>("delete_skill", { slug });
  },

  async gitImport(url: string): Promise<BackendResult<{ slug: string }>> {
    return invoke<BackendResult<{ slug: string }>>("git_import", { url });
  },

  async importLocal(): Promise<BackendResult<{ type: "skill" | "rule"; name: string }>> {
    return invoke<BackendResult<{ type: "skill" | "rule"; name: string }>>("import_local");
  },

  async aiSummarize(slug: string, content: string): Promise<BackendResult> {
    return invoke<BackendResult>("ai_summarize", { slug, content });
  },

  async installSkillsToProject(projectPath: string, slugs: string[], clis: string[]): Promise<BackendResult> {
    return invoke<BackendResult>("install_skills_to_project", { projectPath, slugs, clis });
  },

  async setVisibleClis(clis: string[]): Promise<BackendResult> {
    return invoke<BackendResult>("update_config", { visibleClis: clis.join(",") });
  },

  async setLinkMode(mode: string): Promise<BackendResult<{ mode: string; converted: number; errors: string[] }>> {
    return invoke("update_config", { linkMode: mode });
  },

  async addCustomCli(label: string, dir: string): Promise<BackendResult<{ id: string }>> {
    return invoke<BackendResult<{ id: string }>>("add_custom_cli", { label, dir });
  },

  async removeCustomCli(id: string): Promise<BackendResult<{ removed: boolean }>> {
    return invoke<BackendResult<{ removed: boolean }>>("remove_custom_cli", { id });
  },

  async readRule(slug: string): Promise<string | null> {
    return invoke<string | null>("read_rule", { slug });
  },

  async writeRule(slug: string, content: string): Promise<string> {
    return invoke<string>("write_rule", { slug, content });
  },

  async createRule(name: string, content: string): Promise<RuleRow> {
    return invoke<RuleRow>("create_rule", { name, content });
  },

  async deleteRule(slug: string): Promise<void> {
    return invoke<void>("delete_rule", { slug });
  },

  async renameRule(oldSlug: string, newName: string): Promise<{ oldSlug: string; newSlug: string; newName: string; path: string }> {
    return invoke<{ oldSlug: string; newSlug: string; newName: string; path: string }>("rename_rule", { oldSlug, newName });
  },

  async linkRule(slug: string, cli: string): Promise<string> {
    return invoke<string>("link_rule", { slug, cli });
  },

  async getCliRuleStatus(): Promise<CliRuleStatus[]> {
    return invoke<CliRuleStatus[]>("get_cli_rule_status");
  },
};
