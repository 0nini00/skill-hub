#!/usr/bin/env node
// 一次性清理脚本：移除早期版本 auto-import 留下的孤儿 skill。
// 默认 dry-run，加 --apply 才会真删（删到回收站，Windows 用 PowerShell + Microsoft.VisualBasic.FileIO）。
//
// 用法:
//   node scripts/cleanup-orphan-skills.mjs                 # 预览：默认清理 auto:*
//   node scripts/cleanup-orphan-skills.mjs --include-watch # 预览：连 watch:* 一起清
//   node scripts/cleanup-orphan-skills.mjs --apply         # 真执行（送回收站，更新 usage.db）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const INCLUDE_WATCH = args.has("--include-watch");

const baseDir = path.join(os.homedir(), ".config", "skill-hub");
const skillsDir = path.join(baseDir, "skills");
const dbPath = path.join(baseDir, "usage.db");

if (!fs.existsSync(skillsDir)) {
  console.error(`未找到 skills 目录: ${skillsDir}`);
  process.exit(1);
}

const buckets = { remove: [], keep: [], broken: [] };

for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillDir = path.join(skillsDir, entry.name);
  const metaPath = path.join(skillDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    buckets.broken.push({ slug: entry.name, source: "(no meta.json)", path: skillDir });
    continue;
  }
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch (e) {
    buckets.broken.push({ slug: entry.name, source: `(unreadable meta: ${e.message})`, path: skillDir });
    continue;
  }
  const source = String(meta.source ?? "");
  const slug = String(meta.slug ?? entry.name);
  const isAuto = source.startsWith("auto:");
  const isWatch = source.startsWith("watch:");
  if (isAuto || (INCLUDE_WATCH && isWatch)) {
    buckets.remove.push({ slug, source, path: skillDir });
  } else {
    buckets.keep.push({ slug, source, path: skillDir });
  }
}

const summary = {
  total: buckets.remove.length + buckets.keep.length + buckets.broken.length,
  toRemove: buckets.remove.length,
  toKeep: buckets.keep.length,
  broken: buckets.broken.length,
};

console.log(`Skills 根目录: ${skillsDir}`);
console.log(`SQLite:        ${dbPath}`);
console.log(`扫描结果: 共 ${summary.total} 个 skill 目录`);
console.log(`  - 将清理 (auto:* ${INCLUDE_WATCH ? "+ watch:*" : ""}): ${summary.toRemove}`);
console.log(`  - 保留 (url: / repo: / detected: / 其他): ${summary.toKeep}`);
console.log(`  - 元数据缺失或损坏: ${summary.broken}`);
console.log("");

if (buckets.remove.length === 0) {
  console.log("没有需要清理的项。");
  process.exit(0);
}

console.log(`待清理列表（前 30 条预览）:`);
for (const item of buckets.remove.slice(0, 30)) {
  console.log(`  - ${item.slug.padEnd(28)} <- ${item.source}`);
}
if (buckets.remove.length > 30) {
  console.log(`  ... 还有 ${buckets.remove.length - 30} 个`);
}

if (buckets.broken.length) {
  console.log("");
  console.log(`元数据异常（默认保留，请手动决定是否清理）:`);
  for (const item of buckets.broken) {
    console.log(`  - ${item.slug.padEnd(28)} ${item.source}`);
  }
}

if (!APPLY) {
  console.log("");
  console.log("[dry-run] 未做任何改动。加 --apply 才会真删并更新数据库。");
  process.exit(0);
}

console.log("");
console.log("[apply] 开始送回收站 ...");

let removed = 0;
let failed = 0;
const removedSlugs = [];
for (const item of buckets.remove) {
  try {
    if (process.platform === "win32") {
      recycleToBinWindows(item.path);
    } else {
      fs.rmSync(item.path, { recursive: true, force: true });
    }
    if (!fs.existsSync(item.path)) {
      removed++;
      removedSlugs.push(item.slug);
    } else {
      failed++;
      console.error(`  ! 未删除: ${item.path}`);
    }
  } catch (e) {
    failed++;
    console.error(`  ! 失败: ${item.path} -> ${e.message}`);
  }
}

console.log(`已送回收站: ${removed} / 失败: ${failed}`);

if (removedSlugs.length && fs.existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath);
  try {
    const delSkill = db.prepare("DELETE FROM skills WHERE slug = ?");
    const delHidden = db.prepare("DELETE FROM hidden_skills WHERE slug = ?");
    const delIgnored = db.prepare("DELETE FROM ignored_skills WHERE slug = ?");
    let dbRows = 0;
    for (const slug of removedSlugs) {
      const r = delSkill.run(slug);
      delHidden.run(slug);
      delIgnored.run(slug);
      dbRows += Number(r.changes ?? 0);
    }
    console.log(`数据库 skills 表已清理: ${dbRows} 行`);
  } finally {
    db.close();
  }
}

console.log("完成。");

function recycleToBinWindows(targetPath) {
  const psScript = `
Add-Type -AssemblyName Microsoft.VisualBasic
$targetPath = $env:SKILL_HUB_DELETE_TARGET
if ([string]::IsNullOrWhiteSpace($targetPath)) { throw "SKILL_HUB_DELETE_TARGET is empty" }
$target = Get-Item -LiteralPath $targetPath -Force
if ($target.PSIsContainer) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($target.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($target.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
`;
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    {
      env: { ...process.env, SKILL_HUB_DELETE_TARGET: targetPath },
      encoding: "utf-8",
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `powershell exited ${result.status}`);
  }
}
