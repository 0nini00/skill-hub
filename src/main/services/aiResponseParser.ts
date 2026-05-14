export interface ParsedAiSummary {
  summary: string;
  category: string;
}

export function parseAiSummaryContent(content: string): ParsedAiSummary {
  const text = content.trim();
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ParsedAiSummary>;
      return {
        summary: cleanSummaryText(parsed.summary ?? text),
        category: String(parsed.category ?? "").trim(),
      };
    } catch {
      // Continue with the next candidate.
    }
  }
  return {
    summary: cleanSummaryText(text),
    category: "",
  };
}

export function cleanSummaryText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as Partial<ParsedAiSummary>;
      if (parsed.summary) {
        return String(parsed.summary).replace(/\s+/g, " ").slice(0, 120);
      }
    } catch {
      // Keep the original text if no JSON candidate parses.
    }
  }
  return stripCodeFence(text).replace(/\s+/g, " ").slice(0, 120);
}

export function cleanCategory(value: unknown): string {
  return String(value ?? "").trim();
}

function jsonCandidates(text: string): string[] {
  const stripped = stripCodeFence(text);
  const candidates = [text, stripped];
  const objectMatch = stripped.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidates.push(objectMatch[0]);
  }
  return [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
