import fs from "node:fs";
import path from "node:path";
import { ProxyAgent } from "undici";
import { CATEGORY_ALL, CATEGORY_OPTIONS, inferSkillCategory } from "../../shared/constants/categories";
import type { AiConfig } from "../../shared/types/skill";
import { openDatabase } from "../database/sqlite";
import { getAiConfig } from "./configService";
import { parseAiSummaryContent } from "./aiResponseParser";
import { getSkillSourcePath } from "./skillLibraryService";
import { markdownHash, now } from "./skillUtils";

interface AiSummaryResult {
  summary: string;
  category: string;
}

interface LocalAiSummaryStats {
  ok: true;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  results: Array<{ skill: string; summary: string; category: string }>;
  errors: Array<{ skill: string; message: string }>;
}

const aiCategories = CATEGORY_OPTIONS.filter((category) => category !== CATEGORY_ALL);

export async function autoSummarizeLocal(): Promise<LocalAiSummaryStats> {
  const config = getAiConfig();
  validateAiConfig(config);

  const db = openDatabase();
  const rows = db.prepare(`
    SELECT name, slug
    FROM skills
    ORDER BY COALESCE(updated_at, created_at, '') DESC, id DESC
  `).all() as unknown as Array<{ name: string; slug: string }>;
  db.close();

  const results: Array<{ skill: string; summary: string; category: string }> = [];
  const errors: Array<{ skill: string; message: string }> = [];
  let skipped = 0;

  for (const row of rows) {
    const skillDir = getSkillSourcePath(row.slug);
    if (!skillDir) {
      skipped += 1;
      continue;
    }

    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      skipped += 1;
      continue;
    }

    const metaPath = path.join(skillDir, "meta.json");
    const meta = readMeta(metaPath);
    const markdown = fs.readFileSync(skillFile, "utf-8");
    const sourceHash = markdownHash(markdown);

    if (hasCurrentSummary(meta, sourceHash, skillFile)) {
      rememberSummaryMeta(metaPath, meta, sourceHash, inferSkillCategory({
        name: String(meta.name ?? row.name ?? path.basename(skillDir)),
        slug: String(meta.slug ?? row.slug),
        summary: String(meta.ai_summary ?? ""),
        category: String(meta.category ?? ""),
      }));
      skipped += 1;
      continue;
    }

    let aiResult: AiSummaryResult;
    try {
      aiResult = await callAiSummary(markdown, config);
    } catch (error) {
      errors.push({ skill: row.slug, message: error instanceof Error ? error.message : "AI 摘要失败" });
      continue;
    }

    const category = inferSkillCategory({
      name: String(meta.name ?? row.name ?? path.basename(skillDir)),
      slug: String(meta.slug ?? row.slug),
      summary: aiResult.summary,
      category: aiResult.category,
    });
    const nextMeta = {
      ...meta,
      name: meta.name ?? row.name ?? path.basename(skillDir),
      slug: meta.slug ?? row.slug,
      ai_summary: aiResult.summary,
      source_hash: sourceHash,
      updated_at: now(),
      category,
    };
    fs.writeFileSync(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, "utf-8");
    results.push({ skill: row.slug, summary: aiResult.summary, category });
  }

  return {
    ok: true,
    total: rows.length,
    updated: results.length,
    skipped,
    failed: errors.length,
    results,
    errors,
  };
}

async function callAiSummary(markdown: string, config: AiConfig): Promise<AiSummaryResult> {
  validateAiConfig(config);
  const apiUrl = (config.api_url ?? "").trim();
  const apiKey = (config.api_key ?? "").trim();
  const model = (config.model ?? "").trim();
  const endpoint = apiUrl.replace(/\/+$/, "").endsWith("/chat/completions")
    ? apiUrl.replace(/\/+$/, "")
    : `${apiUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Skill-Hub/1.0",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You summarize SKILL.md files for a skill manager. Return only one valid JSON object. " +
            "All JSON values must be Simplified Chinese. Do not output Markdown, reasoning, or explanations. 不要使用表情符号。",
        },
        {
          role: "user",
          content:
            `请直接总结下面这个 SKILL.md 的能力边界，不要总结本请求本身。只输出严格 JSON：\n` +
            `{"summary":"用简体中文一句话概括能力边界，45字以内","category":"从以下分类中选择一个：${aiCategories.join(", ")}"}\n\n` +
            markdown.slice(0, 12000),
        },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    }),
    ...buildProxyDispatcher(config.proxy),
  } as RequestInit);

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`AI 请求失败: HTTP ${response.status} ${body.slice(0, 300)}`);
  }

  const result = JSON.parse(body) as Record<string, unknown>;
  const content = extractAiContent(result);
  if (!content) {
    const reason = readFirstChoiceText(result, "finish_reason");
    const reasoning = readFirstChoiceMessageText(result, "reasoning_content") || readFirstChoiceMessageText(result, "reasoning");
    if (reason === "length" && reasoning) {
      throw new Error("AI 只返回了推理内容，未输出最终摘要。请换用非推理模型，或提高 API 的输出 token 限制");
    }
    throw new Error("AI 返回内容为空");
  }

  const parsed = parseAiSummaryContent(content);
  if (!isUsableSummary(parsed.summary)) {
    throw new Error("AI 返回内容没有有效 summary");
  }
  return parsed;
}

function extractAiContent(result: Record<string, unknown>): string {
  const choices = Array.isArray(result.choices) ? result.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }
    const row = choice as Record<string, unknown>;
    const message = row.message;
    if (message && typeof message === "object") {
      const content = normalizeContent((message as Record<string, unknown>).content);
      if (content) {
        return content;
      }
    }

    const text = normalizeContent(row.text);
    if (text) {
      return text;
    }
  }
  return normalizeContent(result.output_text);
}

function normalizeContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        return typeof record.text === "string" ? record.text : "";
      }
      return "";
    })
    .join("")
    .trim();
}

function readFirstChoiceText(result: Record<string, unknown>, key: string): string {
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") {
    return "";
  }
  const value = (first as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function readFirstChoiceMessageText(result: Record<string, unknown>, key: string): string {
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") {
    return "";
  }
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") {
    return "";
  }
  const value = (message as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function validateAiConfig(config: AiConfig): void {
  if (!config.api_url?.trim() || !config.api_key?.trim() || !config.model?.trim()) {
    throw new Error("请先配置 AI 接口");
  }
}

function buildProxyDispatcher(proxyUrl: string | undefined): { dispatcher?: ProxyAgent } {
  const url = (proxyUrl ?? "").trim();
  if (!url) {
    return {};
  }
  try {
    return { dispatcher: new ProxyAgent(url) };
  } catch (error) {
    console.warn("[skill-hub] invalid proxy url, falling back to direct fetch:", url, error);
    return {};
  }
}

function readMeta(metaPath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(metaPath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hasCurrentSummary(meta: Record<string, unknown>, sourceHash: string, skillFile: string): boolean {
  if (typeof meta.ai_summary !== "string" || !isUsableSummary(meta.ai_summary)) {
    return false;
  }
  if (typeof meta.source_hash === "string" && meta.source_hash) {
    return meta.source_hash === sourceHash;
  }

  const updatedAt = Date.parse(String(meta.updated_at ?? ""));
  if (!Number.isFinite(updatedAt)) {
    return true;
  }
  try {
    return updatedAt >= fs.statSync(skillFile).mtimeMs;
  } catch {
    return true;
  }
}

function isUsableSummary(summary: string): boolean {
  const text = summary.trim();
  if (!text) {
    return false;
  }
  if (text.startsWith("{") || text.startsWith("[") || /^```/i.test(text)) {
    return false;
  }
  if (/["']?summary["']?\s*:/.test(text) || /["']?category["']?\s*:/.test(text)) {
    return false;
  }
  return true;
}

function rememberSummaryMeta(metaPath: string, meta: Record<string, unknown>, sourceHash: string, category: string): void {
  if (meta.source_hash === sourceHash && meta.category) {
    return;
  }
  try {
    fs.writeFileSync(metaPath, `${JSON.stringify({ ...meta, source_hash: sourceHash, category }, null, 2)}\n`, "utf-8");
  } catch {
    // 摘要本身仍可用，哈希写入失败不应影响界面读取。
  }
}
