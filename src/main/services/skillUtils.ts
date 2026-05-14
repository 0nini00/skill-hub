import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
