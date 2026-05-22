import fs from "node:fs";
import path from "node:path";
import type { AppState, CliRow, SkillRow } from "../../shared/types/skill";
import { openDatabase } from "../database/sqlite";
import { skillHubSkillsDir } from "../database/paths";
import { getVisibleClis } from "./configService";
import { detectCliRows, getCliDefinitions } from "./cliRegistryService";
import { isDirectory } from "./fileSystemService";
import { extractSkillName, extractSummaryFromSkillFile, slug } from "./skillUtils";

interface SkillDbRow {
  name: string;
  slug: string;
  hidden: number;
}

interface HiddenDbRow {
  slug: string;
}

export function getNativeAppState(): AppState {
  scanLocalSkills();
  const detectedClis = detectCliRows();
  const db = openDatabase();
  try {
    const skillRows = db.prepare(`
      SELECT skills.name AS name, skills.slug AS slug, hidden_skills.slug IS NOT NULL AS hidden
      FROM skills
      LEFT JOIN hidden_skills ON hidden_skills.slug = skills.slug
      ORDER BY COALESCE(updated_at, created_at, '') DESC, id DESC
    `).all() as unknown as SkillDbRow[];
    const hiddenMissingRows = db.prepare(`
      SELECT hidden_skills.slug AS slug
      FROM hidden_skills
      LEFT JOIN skills ON skills.slug = hidden_skills.slug
      WHERE skills.slug IS NULL
      ORDER BY hidden_skills.hidden_at DESC
    `).all() as unknown as HiddenDbRow[];

    const skills: SkillRow[] = skillRows.map((row) => {
      const sourcePath = getSkillSourcePath(row.slug, detectedClis);
      return {
        source: "hub",
        name: row.name,
        slug: row.slug,
        hidden: Boolean(row.hidden),
        missing: false,
        summary: getSkillSummary(sourcePath),
        category: getSkillCategory(sourcePath),
        path: sourcePath,
        linked: getLinkedClis(row.slug, detectedClis),
      };
    });

    for (const row of hiddenMissingRows) {
      skills.push({
        source: "hub",
        name: row.slug,
        slug: row.slug,
        hidden: true,
        missing: true,
        summary: "本地技能目录不存在，仅保留历史隐藏记录",
        category: "",
        path: "",
        linked: [],
      });
    }

    return {
      skills,
      detectedClis,
      visibleClis: getVisibleClis(),
    };
  } finally {
    db.close();
  }
}

export function scanLocalSkills(): Array<{ cli: string; name: string; slug: string }> {
  const db = openDatabase();
  try {
    const known = new Set((db.prepare("SELECT slug FROM skills").all() as Array<{ slug: string }>).map((row) => row.slug));
    const added: Array<{ cli: string; name: string; slug: string }> = [];
    const insert = db.prepare(`
      INSERT INTO skills (name, slug, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const sources: Array<{ cli: string; path: string; source: string }> = [
      { cli: "hub", path: skillHubSkillsDir, source: "hub" },
      ...detectCliRows().map((row) => ({ cli: row.cli, path: row.path, source: `detected:${row.cli}` })),
    ];

    for (const row of sources) {
      if (!isDirectory(row.path)) {
        continue;
      }
      for (const childName of fs.readdirSync(row.path)) {
        const skillDir = path.join(row.path, childName);
        if (!isDirectory(skillDir) || !fs.existsSync(path.join(skillDir, "SKILL.md"))) {
          continue;
        }
        const skillSlug = slug(childName);
        if (!skillSlug || known.has(skillSlug)) {
          continue;
        }
        const skillName = extractSkillName(skillDir);
        const timestamp = new Date().toISOString();
        insert.run(skillName, skillSlug, row.source, timestamp, timestamp);
        known.add(skillSlug);
        added.push({ cli: row.cli, name: skillName, slug: skillSlug });
      }
    }
    return added;
  } finally {
    db.close();
  }
}

export function getSkillSourcePath(skillSlug: string, detectedClis = detectCliRows()): string {
  const hubPath = path.join(skillHubSkillsDir, skillSlug);
  if (fs.existsSync(path.join(hubPath, "SKILL.md"))) {
    return hubPath;
  }
  for (const cli of detectedClis) {
    const candidate = findMatchingSkillDir(cli.path, skillSlug);
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

export function findMatchingSkillDir(basePath: string, skillSlug: string): string | null {
  const direct = path.join(basePath, skillSlug);
  if (fs.existsSync(path.join(direct, "SKILL.md"))) {
    return direct;
  }
  if (!isDirectory(basePath)) {
    return null;
  }
  for (const childName of fs.readdirSync(basePath)) {
    const candidate = path.join(basePath, childName);
    if (isDirectory(candidate) && slug(childName) === skillSlug && fs.existsSync(path.join(candidate, "SKILL.md"))) {
      return candidate;
    }
  }
  return null;
}

export function getLinkedClis(skillSlug: string, detectedClis: CliRow[]): string[] {
  return detectedClis
    .filter((cli) => {
      const basePath = cli.path;
      return fs.existsSync(path.join(basePath, skillSlug)) || fs.existsSync(path.join(basePath, `${skillSlug}.SKILL.md`));
    })
    .map((cli) => cli.cli);
}

function getSkillSummary(skillDir: string): string {
  if (!skillDir) {
    return "暂无内容";
  }
  const meta = readMeta(skillDir);
  const aiSummary = String(meta.ai_summary ?? "").trim();
  if (isUsableSummary(aiSummary)) {
    return aiSummary;
  }
  return extractSummaryFromSkillFile(path.join(skillDir, "SKILL.md")) || "暂无摘要";
}

function getSkillCategory(skillDir: string): string {
  if (!skillDir) {
    return "";
  }
  return String(readMeta(skillDir).category ?? "").trim();
}

function readMeta(skillDir: string): Record<string, unknown> {
  const metaPath = path.join(skillDir, "meta.json");
  try {
    if (!fs.existsSync(metaPath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isUsableSummary(summary: string): boolean {
  if (!summary) {
    return false;
  }
  if (summary.startsWith("{") || summary.startsWith("[") || /^```/i.test(summary)) {
    return false;
  }
  return !/["']?summary["']?\s*:/.test(summary) && !/["']?category["']?\s*:/.test(summary);
}

export function getNativeCliDefinitions(): Record<string, string[]> {
  return getCliDefinitions();
}
