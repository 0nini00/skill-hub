export const CATEGORY_ALL = "全部";
const CATEGORY_OTHER = "其他";

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
