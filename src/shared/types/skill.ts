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
