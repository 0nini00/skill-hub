import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { skillHubRulesDir, projectCliDirs } from "../database/paths";
import { getCliRuleDefinitions, getRuleFileNameForCli, getRuleFileNamesForCli } from "./cliRegistryService";
import { isLinkLike, removeLink } from "./fileSystemService";
import { slug, now } from "./skillUtils";
import type { RuleRow, CliRuleStatus } from "../../shared/types/rule";

function rulesDir(): string {
  const dir = skillHubRulesDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ruleSlugFromName(name: string): string {
  return slug(name);
}

function normalizedRuleContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function ruleContentKey(content: string): string {
  return crypto.createHash("md5").update(normalizedRuleContent(content)).digest("hex");
}

function inferRuleName(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes("simplified chinese") || lower.includes("简体中文")) return "simplified-chinese";

  for (const line of content.split(/\r?\n/)) {
    const compact = line
      .trim()
      .replace(/^#+/, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .split("-")
      .filter(Boolean)
      .slice(0, 4)
      .join("-");
    if (compact) return compact;
  }

  return "imported-rule";
}

function uniqueRuleSlug(baseSlug: string): string {
  let candidate = baseSlug;
  let index = 2;
  while (fs.existsSync(path.join(rulesDir(), candidate + ".md"))) {
    candidate = `${baseSlug}-${index}`;
    index += 1;
  }
  return candidate;
}

function findManagedRuleByContent(content: string): { slug: string; path: string } | null {
  const dir = rulesDir();
  if (!fs.existsSync(dir)) return null;
  const key = ruleContentKey(content);
  for (const fname of fs.readdirSync(dir)) {
    if (!fname.endsWith(".md")) continue;
    const full = path.join(dir, fname);
    if (!fs.statSync(full).isFile()) continue;
    const existing = fs.readFileSync(full, "utf-8");
    if (!existing.trim()) continue;
    if (ruleContentKey(existing) === key) {
      return { slug: fname.replace(/\.md$/, ""), path: full };
    }
  }
  return null;
}

function ensureManagedRuleFromContent(content: string): { slug: string; path: string } | null {
  if (!content.trim()) return null;
  const existing = findManagedRuleByContent(content);
  if (existing) return existing;

  const ruleSlug = uniqueRuleSlug(ruleSlugFromName(inferRuleName(content)));
  const target = path.join(rulesDir(), ruleSlug + ".md");
  fs.writeFileSync(target, content, "utf-8");
  return { slug: ruleSlug, path: target };
}

function readRuleContentBySlug(ruleSlug: string): string | null {
  const managed = path.join(rulesDir(), ruleSlug + ".md");
  if (fs.existsSync(managed)) return fs.readFileSync(managed, "utf-8");
  return null;
}

// 扫描全局 CLI 目录中的规则
function scanGlobalRules(cliDefs: Record<string, string[]>): RuleRow[] {
  const rows: RuleRow[] = [];
  const seen = new Set<string>();
  const RULE_CLIS = ["codex", "claude", "gemini"];

  for (const [cli, cliPaths] of Object.entries(cliDefs)) {
    if (!RULE_CLIS.includes(cli)) continue;
    for (const cliPath of cliPaths) {
      if (!fs.existsSync(cliPath)) continue;
      for (const fname of fs.readdirSync(cliPath)) {
        if (!getRuleFileNamesForCli(cli).includes(fname)) continue;
        const full = path.join(cliPath, fname);
        if (!fs.statSync(full).isFile()) continue;
        if (isLinkLike(full)) continue; // 跳过链接，链接由托管规则处理
        if (seen.has(full)) continue;

        const content = fs.readFileSync(full, "utf-8");
        if (!content.trim()) continue;
        const preview = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).slice(0, 2).join(" ").slice(0, 120);
        const managed = ensureManagedRuleFromContent(content);
        if (!managed) continue;
        const name = managed.slug;
        const ruleSlug = managed.slug;

        seen.add(full);
        const existing = rows.find((row) => row.slug === ruleSlug);
        if (existing) {
          if (!existing.linked.includes(cli)) existing.linked.push(cli);
          continue;
        }

        rows.push({
          name,
          slug: ruleSlug,
          preview,
          path: managed.path,
          linked: [cli],
          scope: "global",
          isNative: false
        });
      }
    }
  }
  return rows;
}

// 扫描项目级 CLI 目录中的规则（如 .claude/CLAUDE.md）
function scanProjectRules(projectRoot: string, cliDefs: Record<string, string[]>): RuleRow[] {
  const rows: RuleRow[] = [];
  const seen = new Set<string>();
  const RULE_CLIS = ["codex", "claude", "gemini"];

  for (const [cli, relPaths] of Object.entries(projectCliDirs)) {
    if (!RULE_CLIS.includes(cli)) continue;

    // 项目级规则在 .claude/, .codex/, .gemini/ 根目录
    const cliDir = path.join(projectRoot, relPaths.replace("/skills", ""));
    if (!fs.existsSync(cliDir)) continue;

    for (const fname of fs.readdirSync(cliDir)) {
      if (!getRuleFileNamesForCli(cli).includes(fname)) continue;
      const full = path.join(cliDir, fname);
      if (!fs.statSync(full).isFile()) continue;
      if (isLinkLike(full)) continue;
      if (seen.has(full)) continue;

      const content = fs.readFileSync(full, "utf-8");
      const preview = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).slice(0, 2).join(" ").slice(0, 120);
      const name = `project-${cli}-${fname.replace(/\.md$/, "")}`;

      seen.add(full);
      rows.push({
        name,
        slug: slug(name),
        preview,
        path: full,
        linked: [cli],
        scope: "project",
        isNative: true,
        cliOwner: cli
      });
    }
  }
  return rows;
}

export function listRules(): RuleRow[] {
  const base = rulesDir();
  const cliDefs = getCliRuleDefinitions();
  const seen = new Set<string>();
  const seenRuleContentKeys = new Set<string>();
  const rows: RuleRow[] = [];

  // 1. 扫描托管规则目录（~/.config/skill-hub/rules）
  if (fs.existsSync(base)) {
    for (const fname of fs.readdirSync(base)) {
      if (!fname.endsWith(".md")) continue;
      const full = path.join(base, fname);
      if (!fs.statSync(full).isFile()) continue;

      const content = fs.readFileSync(full, "utf-8");
      if (!content.trim()) continue;
      const contentKey = ruleContentKey(content);
      if (seenRuleContentKeys.has(contentKey)) continue;
      seenRuleContentKeys.add(contentKey);
      const preview = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).slice(0, 2).join(" ").slice(0, 120);
      const name = fname.replace(/\.md$/, "");
      const linked: string[] = [];

      // 通过内容判断 CLI 当前使用哪条规则，不再依赖软链接。
      for (const [cli, cliPaths] of Object.entries(cliDefs)) {
        const ruleFileName = getRuleFileNameForCli(cli);
        for (const cliPath of cliPaths) {
          const target = path.join(cliPath, ruleFileName);
          if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
          const targetContent = fs.readFileSync(target, "utf-8");
          if (targetContent.trim() && ruleContentKey(targetContent) === ruleContentKey(content)) {
            linked.push(cli);
            break;
          }
        }
      }

      seen.add(full);
      rows.push({
        name,
        slug: slug(name),
        preview,
        path: full,
        linked,
        scope: "global",
        isNative: false
      });
    }
  }

  // 2. 扫描全局 CLI 目录中的原生规则文件
  rows.push(...scanGlobalRules(cliDefs).filter(r => !seen.has(r.path)));

  // 3. 扫描当前项目的规则文件（如果在项目目录中运行）
  const cwd = process.cwd();
  const projectRules = scanProjectRules(cwd, cliDefs).filter(r => !seen.has(r.path));
  rows.push(...projectRules);

  return rows;
}

export function readRule(ruleSlug: string): string | null {
  return readRuleContentBySlug(ruleSlug);
}

export function writeRule(ruleSlug: string, content: string): string {
  const p = path.join(rulesDir(), ruleSlug + ".md");
  fs.writeFileSync(p, content, "utf-8");
  if (ruleSlug !== path.basename(p, ".md")) {
    const meta = { name: ruleSlug, updated_at: now() };
    fs.writeFileSync(p.replace(/\.md$/, ".meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  }
  return p;
}

export function createRule(name: string, content: string): RuleRow {
  const s = slug(name);
  const p = path.join(rulesDir(), s + ".md");
  if (fs.existsSync(p)) throw new Error("规则文件已存在: " + s);
  fs.writeFileSync(p, content || "# " + name + "\n\n", "utf-8");
  return {
    name,
    slug: s,
    preview: content.slice(0, 120),
    path: p,
    linked: [],
    scope: "global",
    isNative: false
  };
}

export function deleteRule(ruleSlug: string): void {
  const p = path.join(rulesDir(), ruleSlug + ".md");
  if (fs.existsSync(p)) fs.rmSync(p);
  const meta = path.join(rulesDir(), ruleSlug + ".meta.json");
  if (fs.existsSync(meta)) fs.rmSync(meta);
}

export function linkRuleToCli(ruleSlug: string, cli: string): string {
  const source = path.join(rulesDir(), ruleSlug + ".md");
  if (!fs.existsSync(source)) throw new Error("规则文件不存在: " + ruleSlug);
  const cliPaths = getCliRuleDefinitions()[cli];
  if (!cliPaths?.length) throw new Error("未知 CLI: " + cli);
  const cliDir = cliPaths.find((p) => fs.existsSync(p)) || cliPaths[0];
  if (!fs.existsSync(cliDir)) fs.mkdirSync(cliDir, { recursive: true });

  // 使用正确的规则文件名
  const ruleFileName = getRuleFileNameForCli(cli);
  const target = path.join(cliDir, ruleFileName);

  if (fs.existsSync(target) && isLinkLike(target)) removeLink(target);
  fs.copyFileSync(source, target);
  return target;
}

export function unlinkRuleFromCli(ruleSlug: string, cli: string): boolean {
  const source = path.join(rulesDir(), ruleSlug + ".md");
  const cliPaths = getCliRuleDefinitions()[cli];
  if (!cliPaths?.length) return false;

  const ruleFileName = getRuleFileNameForCli(cli);

  for (const cliPath of cliPaths) {
    const target = path.join(cliPath, ruleFileName);
    if (!isLinkLike(target)) continue;
    try {
      if (fs.realpathSync(target) === source) {
        removeLink(target);
        return true;
      }
    } catch {}
  }
  return false;
}

// 获取各个 CLI 的规则状态（当前启用的规则）
export function getCliRuleStatus(): CliRuleStatus[] {
  const allRules = listRules();
  const cliDefs = getCliRuleDefinitions();
  const RULE_CLIS = ["codex", "claude", "gemini"];
  const result: CliRuleStatus[] = [];

  for (const cli of RULE_CLIS) {
    const cliPaths = cliDefs[cli];
    if (!cliPaths?.length) continue;

    let currentRule: RuleRow | null = null;

    // 查找当前启用的规则（包括原生文件和链接的托管规则）
    for (const rule of allRules) {
      // 当前规则以实际链接/原生占用状态为准，避免按名称前缀误判其它 CLI 的规则。
      if (rule.linked.includes(cli)) {
        currentRule = rule;
        break;
      }
    }

    // 可切换规则：展示所有 Skill Hub 托管的全局规则。
    const available = allRules.filter(r => r.scope === "global" && !r.isNative);

    result.push({
      cli,
      currentRule,
      available
    });
  }

  return result;
}
