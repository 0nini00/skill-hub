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

export interface SkillHubConfig {
  /** 自定义 CLI：cli_id -> 用户配置的目录列表（目录可为 CLI 根目录或 skills 目录） */
  custom_clis?: Record<string, string[]>;
  visible_clis?: string[];
  hidden_skills?: string[];
  link_mode?: string;
}
