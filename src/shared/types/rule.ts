export interface RuleRow {
  name: string;
  slug: string;
  preview: string;
  path: string;
  linked: string[]; // 哪些 CLI 启用了这个规则
  scope: "global" | "project"; // 全局规则 vs 项目规则
  folder?: string; // 文件夹路径（未来扩展）
  isNative?: boolean; // 是否是 CLI 原生文件（非托管）
  cliOwner?: string; // 如果是原生文件，属于哪个 CLI
}

export interface CliRuleStatus {
  cli: string;
  currentRule: RuleRow | null; // 当前启用的规则
  available: RuleRow[]; // 可选规则列表
}
