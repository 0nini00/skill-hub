import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SkillFrontmatter, SkillRow } from "../../shared/types/skill";

export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function now(): string {
  return new Date().toISOString();
}

export function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, "");
  const name = cleaned.split("/").at(-1)?.replace(/\.git$/, "") ?? "";
  return slug(name) || "remote-skill";
}

export function sha1(text: string): string {
  return crypto.createHash("sha1").update(text, "utf-8").digest("hex");
}

export function markdownHash(markdown: string): string {
  return sha1(markdown);
}

export function extractSummaryFromSkillFile(skillFile: string): string {
  if (!fs.existsSync(skillFile)) {
    return "";
  }
  const lines = fs.readFileSync(skillFile, "utf-8").split(/\r?\n/);
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < Math.min(20, lines.length); index += 1) {
      const line = lines[index];
      if (line.startsWith("description:")) {
        return trim(line.split(":", 2)[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "");
      }
      if (line.trim() === "---") {
        break;
      }
    }
  }
  for (const line of lines) {
    const text = line.trim();
    if (text && !["#", "```", "<", "|", "---"].some((prefix) => text.startsWith(prefix))) {
      return trim(text);
    }
  }
  return "";
}

export function extractSkillName(skillDir: string): string {
  const skillFile = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    return path.basename(skillDir);
  }
  const lines = fs.readFileSync(skillFile, "utf-8").split(/\r?\n/);
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < Math.min(20, lines.length); index += 1) {
      if (lines[index].startsWith("name:")) {
        return lines[index].split(":", 2)[1]?.trim().replace(/^['"]|['"]$/g, "") || path.basename(skillDir);
      }
      if (lines[index].trim() === "---") {
        break;
      }
    }
  }
  return path.basename(skillDir);
}

function trim(text: string, limit = 80): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

// ---------------------------------------------------------------------------
// YAML frontmatter parsing
// ---------------------------------------------------------------------------

export function parseSkillMdFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const frontmatter: SkillFrontmatter = {};
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);

  if (!frontmatterMatch) {
    return { frontmatter, body: content.trim() };
  }

  const body = content.slice(frontmatterMatch[0].length).trim();

  for (const line of frontmatterMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      if (key === "tags") {
        frontmatter.tags = items;
      } else if (key === "compatibility") {
        frontmatter.compatibility = items;
      }
      continue;
    }

    if (key === "name") frontmatter.name = value;
    if (key === "description") frontmatter.description = value;
    if (key === "version") frontmatter.version = value;
    if (key === "author") frontmatter.author = value;
    if (key === "compatibility") frontmatter.compatibility = [value];
    if (key === "protocol_type") frontmatter.protocol_type = value;
    if (key === "tags" && !frontmatter.tags) {
      frontmatter.tags = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  return { frontmatter, body };
}

export function readSkillFrontmatter(skillDir: string): SkillFrontmatter {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    return {};
  }
  const raw = fs.readFileSync(skillMdPath, "utf-8");
  const { frontmatter } = parseSkillMdFrontmatter(raw);
  return frontmatter;
}

// ---------------------------------------------------------------------------
// Skill export
// ---------------------------------------------------------------------------

export function exportAsSkillMd(row: SkillRow): string {
  const yamlStr = (v: string): string =>
    /[:#\[\]{},\n\r\\]/.test(v)
      ? '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
      : v;

  const fm = row.frontmatter ?? {};
  const name = fm.name || row.name;
  const description = fm.description || row.summary || "";
  const version = fm.version || "1.0.0";
  const author = fm.author || "";
  const tags = fm.tags ?? [];
  const compatibility = fm.compatibility ?? ["skill-hub"];

  let bodyContent = row.summary;
  const skillMdPath = row.path ? path.join(row.path, "SKILL.md") : "";
  if (skillMdPath && fs.existsSync(skillMdPath)) {
    const raw = fs.readFileSync(skillMdPath, "utf-8");
    const { body } = parseSkillMdFrontmatter(raw);
    bodyContent = body || row.summary;
  }

  const fl: string[] = ["---"];
  fl.push("name: " + yamlStr(name));
  if (description) fl.push("description: " + yamlStr(description));
  if (version) fl.push("version: " + yamlStr(version));
  if (author) fl.push("author: " + yamlStr(author));
  if (tags.length > 0) {
    fl.push("tags: [" + tags.map(yamlStr).join(", ") + "]");
  }
  fl.push("compatibility: [" + compatibility.map(yamlStr).join(", ") + "]");
  fl.push("---");
  fl.push("");

  return fl.join("\n") + bodyContent;
}

export function exportAsJson(row: SkillRow): string {
  const fm = row.frontmatter ?? {};

  let instructions = "";
  const skillMdPath = row.path ? path.join(row.path, "SKILL.md") : "";
  if (skillMdPath && fs.existsSync(skillMdPath)) {
    instructions = fs.readFileSync(skillMdPath, "utf-8");
  }

  return JSON.stringify(
    {
      name: fm.name || row.name,
      description: fm.description || row.summary || "",
      version: fm.version || "1.0.0",
      author: fm.author || "",
      tags: fm.tags ?? [],
      instructions,
      category: row.category || "",
      source: row.source,
      exported_at: now(),
      format_version: "1.0",
    },
    null,
    2,
  );
}

