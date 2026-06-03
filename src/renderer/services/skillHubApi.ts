import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AiConfig, AppState, BackendResult, SkillFileEntry, SkillSafetyReport } from "@shared/types/skill";
import type { RuleRow, CliRuleStatus } from "@shared/types/rule";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 兼容层：
 * - Tauri：走 invoke / plugin-dialog / shell
 * - Electron（遗留）：走 preload 暴露的 window.skillHub
 */
export const skillHubApi = {
  async getAppState(): Promise<AppState> {
    if (isTauri()) {
      return invoke<AppState>("get_app_state");
    }
    return window.skillHub.getAppState();
  },

  async runBackend<T = unknown>(args: string[]): Promise<BackendResult<T>> {
    if (isTauri()) {
      // 第一阶段：先不给后端实现完整 CLI，避免 UI 崩溃
      return {
        ok: false,
        data: null,
        stdout: "",
        stderr: `当前命令暂未迁移到 Tauri: ${args.join(" ")}`,
        message: "命令未实现",
      };
    }
    return window.skillHub.runBackend<T>(args);
  },

  async getAiConfig(): Promise<AiConfig> {
    if (isTauri()) {
      return invoke<AiConfig>("read_ai_config");
    }
    return window.skillHub.getAiConfig();
  },

  async setAiConfig(config: Required<AiConfig>): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("write_ai_config", { config });
    }
    return window.skillHub.setAiConfig(config);
  },

  async selectDirectory(): Promise<string | null> {
    if (isTauri()) {
      // 使用 Tauri dialog 插件
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return null;
      return Array.isArray(selected) ? selected[0] ?? null : selected;
    }
    return window.skillHub.selectDirectory();
  },

  async openPath(path: string): Promise<boolean> {
    if (isTauri()) {
      return invoke<boolean>("open_path", { path });
    }
    return window.skillHub.openPath(path);
  },

  async linkSkill(cli: string, slug: string): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("link_skill", { cli, slug });
    }
    return window.skillHub.runBackend(["link-skill", slug, cli]);
  },

  async unlinkSkill(cli: string, slug: string): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("unlink_skill", { cli, slug });
    }
    return window.skillHub.runBackend(["unlink-skill", slug, cli]);
  },

  async hideSkill(slug: string): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("hide_skill", { slug });
    }
    return window.skillHub.runBackend(["hide-skill", slug]);
  },

  async unhideSkill(slug: string): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("unhide_skill", { slug });
    }
    return window.skillHub.runBackend(["unhide-skill", slug]);
  },

  async deleteSkill(slug: string): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("delete_skill", { slug });
    }
    return window.skillHub.runBackend(["delete-skill", slug]);
  },

  async gitImport(url: string): Promise<BackendResult<{ slug: string }>> {
    if (isTauri()) {
      return invoke<BackendResult<{ slug: string }>>("git_import", { url });
    }
    return window.skillHub.runBackend(["install-url", "--url", url]);
  },

  async importLocal(): Promise<BackendResult<{ type: "skill" | "rule"; name: string }>> {
    if (isTauri()) {
      return invoke<BackendResult<{ type: "skill" | "rule"; name: string }>>("import_local");
    }
    // Electron fallback - not implemented
    return {
      ok: false,
      data: null,
      stdout: "",
      stderr: "Electron 版本暂不支持本地导入",
      message: "Electron 版本暂不支持本地导入",
    };
  },

  async aiSummarize(slug: string, content: string): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("ai_summarize", { slug, content });
    }
    return window.skillHub.runBackend(["auto-summarize"]);
  },

  async installSkillsToProject(projectPath: string, slugs: string[], clis: string[]): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("install_skills_to_project", { projectPath, slugs, clis });
    }
    return window.skillHub.runBackend([
      "install-project-skills",
      "--project", projectPath,
      "--skills", slugs.join(","),
      "--clis", clis.join(","),
    ]);
  },

  async setVisibleClis(clis: string[]): Promise<BackendResult> {
    if (isTauri()) {
      return invoke<BackendResult>("set_visible_clis", { clis: clis.join(",") });
    }
    return window.skillHub.runBackend(["set-visible-clis", "--clis", clis.join(",")]);
  },

  async listSkillFiles(slug: string): Promise<SkillFileEntry[]> {
    if (isTauri()) {
      return invoke<SkillFileEntry[]>("list_skill_files", { slug });
    }
    return window.skillHub.listSkillFiles(slug);
  },

  async readSkillFile(slug: string, relativePath: string): Promise<string | null> {
    if (isTauri()) {
      return invoke<string | null>("read_skill_file", { slug, relativePath });
    }
    return window.skillHub.readSkillFile(slug, relativePath);
  },

  async writeSkillFile(slug: string, relativePath: string, content: string): Promise<boolean> {
    if (isTauri()) {
      return invoke<boolean>("write_skill_file", { slug, relativePath, content });
    }
    return window.skillHub.writeSkillFile(slug, relativePath, content);
  },

  async deleteSkillFile(slug: string, relativePath: string): Promise<boolean> {
    if (isTauri()) {
      return invoke<boolean>("delete_skill_file", { slug, relativePath });
    }
    return window.skillHub.deleteSkillFile(slug, relativePath);
  },

  async scanSkillSafety(slug: string): Promise<SkillSafetyReport | null> {
    if (isTauri()) {
      return invoke<SkillSafetyReport | null>("scan_skill_safety", { slug });
    }
    return window.skillHub.scanSkillSafety(slug);
  },

  async exportSkill(slug: string, format: "skill-md" | "json" = "skill-md"): Promise<string> {
    if (isTauri()) {
      return invoke<string>("export_skill", { slug, format });
    }
    return window.skillHub.exportSkill(slug, format);
  },

  async listRules(): Promise<RuleRow[]> {
    if (isTauri()) {
      return invoke<RuleRow[]>("list_rules");
    }
    return window.skillHub.listRules();
  },

  async readRule(slug: string): Promise<string | null> {
    if (isTauri()) {
      return invoke<string | null>("read_rule", { slug });
    }
    return window.skillHub.readRule(slug);
  },

  async writeRule(slug: string, content: string): Promise<string> {
    if (isTauri()) {
      return invoke<string>("write_rule", { slug, content });
    }
    return window.skillHub.writeRule(slug, content);
  },

  async createRule(name: string, content: string): Promise<RuleRow> {
    if (isTauri()) {
      return invoke<RuleRow>("create_rule", { name, content });
    }
    return window.skillHub.createRule(name, content);
  },

  async deleteRule(slug: string): Promise<void> {
    if (isTauri()) {
      return invoke<void>("delete_rule", { slug });
    }
    return window.skillHub.deleteRule(slug);
  },

  async linkRule(slug: string, cli: string): Promise<string> {
    if (isTauri()) {
      return invoke<string>("link_rule", { slug, cli });
    }
    return window.skillHub.linkRule(slug, cli);
  },

  async unlinkRule(slug: string, cli: string): Promise<boolean> {
    if (isTauri()) {
      return invoke<boolean>("unlink_rule", { slug, cli });
    }
    return window.skillHub.unlinkRule(slug, cli);
  },

  async getCliRuleStatus(): Promise<CliRuleStatus[]> {
    if (isTauri()) {
      return invoke<CliRuleStatus[]>("get_cli_rule_status");
    }
    return window.skillHub.getCliRuleStatus();
  },
};
