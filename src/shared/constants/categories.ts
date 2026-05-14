export const CATEGORY_ALL = "全部";
export const CATEGORY_OTHER = "其他";

export const CATEGORY_OPTIONS = [
  CATEGORY_ALL,
  "开发工程",
  "学术研究",
  "网络信息",
  "文档数据",
  "文件系统",
  "任务规划",
  "沟通协作",
  "设计媒体",
  "Agent 管理",
  CATEGORY_OTHER,
] as const;

export type SkillCategory = (typeof CATEGORY_OPTIONS)[number];

export const CATEGORY_SLUG_MAP: Record<string, SkillCategory> = {
  "academic-editor": "学术研究",
  "adaptive-coder": "开发工程",
  browser: "网络信息",
  "cli-design-framework": "开发工程",
  "coding-agent": "开发工程",
  "file-manager": "文件系统",
  "image-gen": "设计媒体",
  "literature-search": "学术研究",
  "memory-management": "Agent 管理",
  "mission-control": "任务规划",
  notebook: "文档数据",
  "plan-mode": "任务规划",
  reactions: "沟通协作",
  "safe-delete": "文件系统",
  scheduler: "任务规划",
  "send-file": "沟通协作",
  "skill-hub": "Agent 管理",
  "skill-search": "Agent 管理",
  "system-info": "文件系统",
  tasks: "任务规划",
  "thread-management": "沟通协作",
  todo: "任务规划",
  "ui-ux-pro-max": "设计媒体",
  "web-fetch": "网络信息",
  "web-search": "网络信息",
};

export const CATEGORY_KEYWORDS: Array<[SkillCategory, string[]]> = [
  ["开发工程", ["code", "coding", "developer", "python", "javascript", "typescript", "api", "cli", "git", "test", "debug", "refactor", "代码", "编程", "开发", "接口", "测试", "调试", "重构"]],
  ["学术研究", ["academic", "research", "literature", "citation", "paper", "latex", "研究", "文献", "学术", "论文", "综述"]],
  ["网络信息", ["browser", "web", "website", "fetch", "search", "http", "url", "chrome", "网页", "浏览器", "网络", "搜索"]],
  ["文档数据", ["document", "docx", "markdown", "spreadsheet", "excel", "csv", "slide", "ppt", "pdf", "notebook", "文档", "表格", "数据", "幻灯片"]],
  ["文件系统", ["file", "folder", "delete", "disk", "process", "system", "shell", "terminal", "filesystem", "文件", "目录", "删除", "磁盘", "系统", "终端"]],
  ["任务规划", ["task", "todo", "schedule", "project", "mission", "automation", "reminder", "plan", "任务", "待办", "计划", "项目", "提醒", "自动化"]],
  ["沟通协作", ["chat", "thread", "message", "send", "reaction", "telegram", "discord", "feishu", "沟通", "协作", "消息", "会话", "发送"]],
  ["设计媒体", ["image", "photo", "visual", "media", "video", "audio", "voice", "design", "comic", "ui", "ux", "图像", "图片", "视觉", "媒体", "视频", "音频", "设计"]],
  ["Agent 管理", ["agent", "alma", "memory", "conversation", "config", "智能体", "记忆", "配置"]],
];

export interface SkillCategoryInput {
  name?: string;
  slug?: string;
  summary?: string;
  category?: string;
  repo?: string;
}

export function inferSkillCategory(input: SkillCategoryInput): SkillCategory {
  if (input.category && input.category !== CATEGORY_ALL && CATEGORY_OPTIONS.includes(input.category as SkillCategory)) {
    return input.category as SkillCategory;
  }

  const baseSlug = (input.slug ?? "").replace(/-\d+$/, "");
  const mapped = CATEGORY_SLUG_MAP[baseSlug];
  if (mapped) {
    return mapped;
  }

  const text = `${input.name ?? ""} ${input.slug ?? ""} ${input.summary ?? ""} ${input.repo ?? ""}`.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
      return category;
    }
  }
  return CATEGORY_OTHER;
}
