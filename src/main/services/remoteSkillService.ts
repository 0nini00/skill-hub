import fs from "node:fs";
import path from "node:path";
import { projectCliDirs, skillHubSingleReposDir } from "../database/paths";
import { getAiConfig } from "./configService";
import { removeTree, runProcess } from "./fileSystemService";
import { installSkillDir } from "./skillInstallService";
import { repoNameFromUrl, sha1, slug } from "./skillUtils";

function buildProxyArgs(): string[] {
  const proxy = getAiConfig().proxy ?? "";
  if (!proxy) return [];
  return ["-c", `http.proxy=${proxy}`, "-c", `https.proxy=${proxy}`];
}

export async function installUrl(repoUrl: string, forcedSlug?: string) {
  const url = repoUrl.trim();
  if (!/^https?:\/\//.test(url)) {
    throw new Error("请提供 http 或 https 开头的 Git 仓库链接");
  }

  const cacheDir = prepareCloneDir(url);
  const result = await runProcess(
    "git",
    [...buildProxyArgs(), "clone", "--depth", "1", url, cacheDir],
    {},
    undefined,
    90000,
  );
  if (result.code !== 0) {
    throw new Error(`下载仓库失败: ${(result.stderr || result.stdout).trim()}`);
  }

  const skillDir = findSingleSkillDir(cacheDir);
  const installSlug = forcedSlug || (path.resolve(skillDir) === path.resolve(cacheDir)
    ? repoNameFromUrl(url)
    : slug(path.basename(skillDir)));
  return installSkillDir(skillDir, `url:${url}`, installSlug);
}

function prepareCloneDir(url: string): string {
  const baseDir = cacheDirForUrl(url);
  if (!fs.existsSync(baseDir)) {
    return baseDir;
  }
  try {
    removeTree(baseDir);
    return baseDir;
  } catch {
    const stamp = new Date().toISOString().replace(/\D/g, "");
    return `${baseDir}-${stamp}`;
  }
}

function cacheDirForUrl(url: string): string {
  return path.join(skillHubSingleReposDir, `${repoNameFromUrl(url)}-${sha1(url).slice(0, 10)}`);
}

function findSingleSkillDir(repoPath: string): string {
  if (fs.existsSync(path.join(repoPath, "SKILL.md"))) {
    return repoPath;
  }

  const manifestPath = path.join(repoPath, "skill.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as { name?: string };
      const manifestSlug = slug(manifest.name ?? "");
      if (manifestSlug) {
        const candidates = Object.keys(projectCliDirs).map((cli) => path.join(repoPath, `.${cli}`, "skills", manifestSlug));
        for (const childName of fs.readdirSync(repoPath)) {
          candidates.push(path.join(repoPath, childName, "skills", manifestSlug));
        }
        for (const candidate of candidates) {
          if (fs.existsSync(path.join(candidate, "SKILL.md"))) {
            return candidate;
          }
        }
      }
    } catch {
      // 忽略无效 manifest，继续搜索 SKILL.md。
    }
  }

  const skillDirs = [...new Set(findSkillFiles(repoPath).map((item) => path.dirname(item)))];
  if (!skillDirs.length) {
    throw new Error("仓库中未找到 SKILL.md");
  }
  if (skillDirs.length > 1) {
    throw new Error("该仓库包含多个 SKILL.md，不适合作为单个 skill 链接直接安装");
  }
  return skillDirs[0];
}

function findSkillFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const results: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop() as string;
    if (current.split(path.sep).includes(".git")) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(entryPath);
      }
    }
  }
  return results;
}
