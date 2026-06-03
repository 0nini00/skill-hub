// YAML frontmatter parsed from a SKILL.md file
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  compatibility?: string[];
  protocol_type?: string;
}

export interface SkillFileEntry {
  relativePath: string;
  content: string;
  isDirectory: boolean;
  size?: number;
}

export type SkillSafetySeverity = "info" | "warn" | "high";
export type SkillSafetyLevel = "safe" | "warn" | "high-risk" | "blocked";

export interface SkillSafetyFinding {
  code: string;
  severity: SkillSafetySeverity;
  title: string;
  detail: string;
  filePath?: string;
  evidence?: string;
}

export interface SkillSafetyReport {
  level: SkillSafetyLevel;
  summary: string;
  findings: SkillSafetyFinding[];
  recommendedAction: "allow" | "review" | "block";
  scannedAt: number;
  checkedFileCount: number;
  scanMethod: "pattern";
  score: number;
}

export interface SkillExportOptions {
  format: "skill-md" | "json";
  destinationPath?: string;
}

export interface CliRow {
  cli: string;
  path: string;
}

export interface SkillRow {
  source: "hub" | "external";
  name: string;
  slug: string;
  hidden: boolean;
  missing: boolean;
  summary: string;
  category?: string;
  path: string;
  linked: string[];
  // Extended fields from SKILL.md frontmatter or meta.json
  frontmatter?: SkillFrontmatter;
  safetyReport?: SkillSafetyReport;
}

export interface AppState {
  skills: SkillRow[];
  detectedClis: CliRow[];
  visibleClis: string[];
}

export interface BackendResult<T = unknown> {
  ok: boolean;
  data: T | null;
  stdout: string;
  stderr: string;
  message?: string;
}

export interface AiConfig {
  api_url?: string;
  api_key?: string;
  model?: string;
  proxy?: string;
}
