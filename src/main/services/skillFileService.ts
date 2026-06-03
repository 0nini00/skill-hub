import fs from "node:fs";
import path from "node:path";
import type { SkillFileEntry } from "../../shared/types/skill";
import { getSkillSourcePath } from "./skillLibraryService";

const TEXT_EXTENSIONS = new Set([
  ".md", ".py", ".js", ".ts", ".json", ".yaml", ".yml",
  ".txt", ".sh", ".toml", ".cfg", ".ini", ".css", ".html",
  ".xml", ".sql", ".r", ".jl", ".lua", ".rb", ".go", ".java",
  ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".cs", ".rs",
  ".tsx", ".jsx", ".mjs", ".cjs", ".env", ".gitignore",
]);

const MAX_WALK_DEPTH = 6;
const MAX_WALK_FILES = 300;

export function listSkillFiles(skillSlug: string): SkillFileEntry[] {
  const skillDir = getSkillSourcePath(skillSlug);
  if (!skillDir || !fs.existsSync(path.join(skillDir, "SKILL.md"))) {
    return [];
  }
  return walkDir(skillDir, skillDir, 0);
}

export function readSkillFile(skillSlug: string, relativePath: string): string | null {
  const skillDir = getSkillSourcePath(skillSlug);
  if (!skillDir) return null;
  const fullPath = path.resolve(skillDir, relativePath);
  if (!fullPath.startsWith(path.resolve(skillDir))) return null;
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

export function writeSkillFile(skillSlug: string, relativePath: string, content: string): boolean {
  const skillDir = getSkillSourcePath(skillSlug);
  if (!skillDir) return false;
  const fullPath = path.resolve(skillDir, relativePath);
  if (!fullPath.startsWith(path.resolve(skillDir))) return false;
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
  return true;
}

export function deleteSkillFile(skillSlug: string, relativePath: string): boolean {
  const skillDir = getSkillSourcePath(skillSlug);
  if (!skillDir) return false;
  const fullPath = path.resolve(skillDir, relativePath);
  if (!fullPath.startsWith(path.resolve(skillDir))) return false;
  if (relativePath === "" || relativePath === "." || relativePath === "SKILL.md") return false;
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
  return true;
}

function walkDir(
  baseDir: string,
  currentDir: string,
  depth: number,
  results: SkillFileEntry[] = [],
): SkillFileEntry[] {
  if (depth > MAX_WALK_DEPTH || results.length >= MAX_WALK_FILES) return results;
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      results.push({ relativePath: relativePath.replace(/\\/g, "/"), content: "", isDirectory: true });
      walkDir(baseDir, fullPath, depth + 1, results);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      let content = "";
      if (TEXT_EXTENSIONS.has(ext)) {
        try { content = fs.readFileSync(fullPath, "utf-8"); }
        catch { content = "[binary]"; }
      } else {
        content = "[binary]";
      }
      const stat = fs.statSync(fullPath);
      results.push({
        relativePath: relativePath.replace(/\\/g, "/"),
        content,
        isDirectory: false,
        size: stat.size,
      });
    }
  }
  return results;
}
