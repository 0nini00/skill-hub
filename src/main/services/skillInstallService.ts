import fs from "node:fs";
import path from "node:path";
import { projectCliDirs, skillHubSkillsDir } from "../database/paths";
import { openDatabase } from "../database/sqlite";
import { getCliDefinitions } from "./cliRegistryService";
import {
  copyDirectory,
  createLink,
  isDirectChildPath,
  isDirectory,
  isLinkLike,
  isPathInside,
  recyclePath,
  removeLink,
} from "./fileSystemService";
import { findMatchingSkillDir, getSkillSourcePath } from "./skillLibraryService";
import { extractSkillName, now, slug } from "./skillUtils";

interface DeleteTarget {
  path: string;
  scope: string;
}

export function upsertSkill(name: string, source: string, forcedSlug?: string): string {
  const skillSlug = forcedSlug || slug(name);
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM ignored_skills WHERE slug=?").run(skillSlug);
    db.prepare("DELETE FROM hidden_skills WHERE slug=?").run(skillSlug);
    db.prepare(`
      INSERT INTO skills (name, slug, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name=excluded.name,
        source=excluded.source,
        updated_at=excluded.updated_at
    `).run(name, skillSlug, source, now(), now());
    return skillSlug;
  } finally {
    db.close();
  }
}

export function installSkillDir(sourceDir: string, source: string, forcedSlug?: string) {
  const skillSlug = forcedSlug || slug(path.basename(sourceDir));
  if (!skillSlug) {
    throw new Error("无法生成技能 slug");
  }
  const destination = path.join(skillHubSkillsDir, skillSlug);
  copyDirectory(sourceDir, destination);
  const skillName = extractSkillName(destination);
  upsertSkill(skillName, source, skillSlug);
  fs.writeFileSync(
    path.join(destination, "meta.json"),
    `${JSON.stringify(
      {
        name: skillName,
        slug: skillSlug,
        source,
        updated_at: now(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return { ok: true, name: skillName, slug: skillSlug, path: destination };
}

export function resolveCliPath(cli: string): string {
  const paths = getCliDefinitions()[cli] ?? [];
  if (!paths.length) {
    throw new Error(`未知 CLI: ${cli}`);
  }
  return paths.find((item) => fs.existsSync(item))
    ?? paths.find((item) => fs.existsSync(path.dirname(item)))
    ?? paths[0];
}

export function targetForSkill(cli: string, skillSlug: string): string {
  const targetBase = resolveCliPath(cli);
  fs.mkdirSync(targetBase, { recursive: true });
  return path.join(targetBase, skillSlug);
}

export function linkSkill(skillNameOrSlug: string, cli: string) {
  const skillSlug = slug(skillNameOrSlug);
  const source = getSkillSourcePath(skillSlug);
  if (!source) {
    throw new Error(`源技能不存在: ${skillSlug}`);
  }
  const target = targetForSkill(cli, skillSlug);
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) {
    return { ok: true, path: target, message: "源和目标一致，无需链接" };
  }
  if (fs.existsSync(target) || isLinkLike(target)) {
    if (!isLinkLike(target)) {
      throw new Error(`目标已存在且不是链接，拒绝覆盖: ${target}`);
    }
    removeLink(target);
  }
  createLink(source, target);
  return { ok: true, path: target };
}

export function unlinkSkill(skillNameOrSlug: string, cli: string) {
  const skillSlug = slug(skillNameOrSlug);
  const removed: string[] = [];
  const skipped: string[] = [];
  for (const basePath of getCliDefinitions()[cli] ?? []) {
    const target = path.join(basePath, skillSlug);
    if (!fs.existsSync(target)) {
      continue;
    }
    if (isLinkLike(target)) {
      removeLink(target);
      removed.push(target);
    } else {
      skipped.push(target);
    }
  }
  return { ok: true, removed, skipped };
}

export function hideSkill(skillNameOrSlug: string) {
  const skillSlug = slug(skillNameOrSlug);
  if (!skillSlug) {
    throw new Error("技能名称无效");
  }
  const db = openDatabase();
  try {
    db.prepare(`
      INSERT INTO hidden_skills (slug, hidden_at)
      VALUES (?, ?)
      ON CONFLICT(slug) DO UPDATE SET hidden_at=excluded.hidden_at
    `).run(skillSlug, now());
    return { ok: true, hidden: skillSlug };
  } finally {
    db.close();
  }
}

export function unhideSkill(skillNameOrSlug: string) {
  const skillSlug = slug(skillNameOrSlug);
  if (!skillSlug) {
    throw new Error("技能名称无效");
  }
  const source = findSkillSourceWithOrigin(skillSlug);
  if (!source) {
    throw new Error("未在 Skill Hub 库或任何已配置 CLI skills 目录中找到这个 skill，无法恢复");
  }
  const db = openDatabase();
  try {
    const exists = db.prepare("SELECT 1 AS ok FROM skills WHERE slug=?").get(skillSlug);
    if (!exists) {
      db.close();
      upsertSkill(extractSkillName(source.path), source.origin, skillSlug);
      const nextDb = openDatabase();
      nextDb.prepare("DELETE FROM hidden_skills WHERE slug=?").run(skillSlug);
      nextDb.prepare("DELETE FROM ignored_skills WHERE slug=?").run(skillSlug);
      nextDb.close();
      return { ok: true, visible: skillSlug, name: extractSkillName(source.path), source: source.origin };
    }
    db.prepare("DELETE FROM hidden_skills WHERE slug=?").run(skillSlug);
    db.prepare("DELETE FROM ignored_skills WHERE slug=?").run(skillSlug);
    return { ok: true, visible: skillSlug, name: extractSkillName(source.path), source: source.origin };
  } finally {
    try {
      db.close();
    } catch {
      // Database may already be closed while inserting a missing skill.
    }
  }
}

export async function deleteSkill(skillNameOrSlug: string) {
  const skillSlug = slug(skillNameOrSlug);
  if (!skillSlug) {
    throw new Error("技能名称无效");
  }
  const targets = collectSkillDeleteTargets(skillSlug);
  const deleted: DeleteTarget[] = [];
  for (const target of targets) {
    await recyclePath(target.path);
    deleted.push(target);
  }
  const db = openDatabase();
  try {
    db.prepare("DELETE FROM skills WHERE slug=?").run(skillSlug);
    db.prepare("DELETE FROM hidden_skills WHERE slug=?").run(skillSlug);
    db.prepare("DELETE FROM ignored_skills WHERE slug=?").run(skillSlug);
  } finally {
    db.close();
  }
  return { ok: true, deleted: skillSlug, targets: deleted };
}

export function installProjectSkills(projectPath: string, skillList: string, cliList: string) {
  const projectDir = path.resolve(projectPath);
  if (!isDirectory(projectDir)) {
    throw new Error("项目路径不存在");
  }
  const skillSlugs = skillList.split(",").map((item) => slug(item)).filter(Boolean);
  const clis = cliList.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!skillSlugs.length) {
    throw new Error("请至少选择一个技能");
  }
  if (!clis.length) {
    throw new Error("请至少选择一个 CLI");
  }

  const installed: Array<{ slug: string; cli: string; path: string }> = [];
  const skipped: Array<{ slug: string; cli?: string; reason: string }> = [];
  for (const skillSlug of skillSlugs) {
    let projectSkillDir = "";
    try {
      projectSkillDir = copyLibrarySkillToProject(skillSlug, projectDir);
    } catch (error) {
      skipped.push({ slug: skillSlug, reason: error instanceof Error ? error.message : "复制技能失败" });
      continue;
    }
    for (const cli of clis) {
      const relativeTarget = projectCliDirs[cli];
      if (!relativeTarget) {
        skipped.push({ slug: skillSlug, cli, reason: "暂不支持该 CLI 的项目安装路径" });
        continue;
      }
      const target = path.join(projectDir, relativeTarget, skillSlug);
      try {
        createLink(projectSkillDir, target);
        installed.push({ slug: skillSlug, cli, path: target });
      } catch (error) {
        skipped.push({ slug: skillSlug, cli, reason: error instanceof Error ? error.message : "创建链接失败" });
      }
    }
  }
  return { ok: true, project_path: projectDir, installed, skipped };
}

function copyLibrarySkillToProject(skillSlug: string, projectDir: string): string {
  const source = getSkillSourcePath(skillSlug);
  if (!source || !fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new Error(`技能缺少 SKILL.md: ${skillSlug}`);
  }
  const projectStore = path.join(projectDir, ".skill-hub", "project-skills");
  fs.mkdirSync(projectStore, { recursive: true });
  const destination = path.join(projectStore, skillSlug);
  if (!isPathInside(destination, projectStore)) {
    throw new Error("项目技能路径不安全");
  }
  copyDirectory(source, destination);
  return destination;
}

function collectSkillDeleteTargets(skillSlug: string): DeleteTarget[] {
  const targets: DeleteTarget[] = [];
  const seen = new Set<string>();

  function addTarget(targetPath: string, root: string, scope: string): void {
    if (!fs.existsSync(targetPath)) {
      return;
    }
    if (path.basename(targetPath) !== `${skillSlug}.SKILL.md` && slug(path.basename(targetPath)) !== skillSlug) {
      return;
    }
    if (!isDirectChildPath(targetPath, root)) {
      throw new Error(`删除路径不在受控 skills 目录下: ${targetPath}`);
    }
    if (isDirectory(targetPath) && !isLinkLike(targetPath) && !fs.existsSync(path.join(targetPath, "SKILL.md"))) {
      return;
    }
    const key = path.resolve(targetPath).toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    targets.push({ path: targetPath, scope });
  }

  addTarget(path.join(skillHubSkillsDir, skillSlug), skillHubSkillsDir, "skill-hub");
  for (const [cli, paths] of Object.entries(getCliDefinitions())) {
    for (const basePath of paths) {
      if (!isDirectory(basePath)) {
        continue;
      }
      addTarget(path.join(basePath, skillSlug), basePath, cli);
      addTarget(path.join(basePath, `${skillSlug}.SKILL.md`), basePath, cli);
      for (const childName of fs.readdirSync(basePath)) {
        if (slug(childName) === skillSlug) {
          addTarget(path.join(basePath, childName), basePath, cli);
        }
      }
    }
  }
  return targets;
}

function findSkillSourceWithOrigin(skillSlug: string): { path: string; origin: string } | null {
  const hubPath = path.join(skillHubSkillsDir, skillSlug);
  if (fs.existsSync(path.join(hubPath, "SKILL.md"))) {
    return { path: hubPath, origin: "hub" };
  }
  for (const [cli, paths] of Object.entries(getCliDefinitions())) {
    for (const basePath of paths) {
      const candidate = findMatchingSkillDir(basePath, skillSlug);
      if (candidate) {
        return { path: candidate, origin: `detected:${cli}` };
      }
    }
  }
  return null;
}
