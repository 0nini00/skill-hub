interface AiSummaryStats {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
}

export function formatAiSummaryStatus(data: unknown, label: string): string {
  const stats = readAiSummaryStats(data);
  if (!stats) {
    return `${label}已更新`;
  }

  const failedText = stats.failed > 0 ? `，失败 ${stats.failed} 个` : "";
  if (stats.updated > 0) {
    return `${label}已更新 ${stats.updated} 个，跳过 ${stats.skipped} 个${failedText}`;
  }
  if (stats.failed > 0) {
    return `${label}没有成功更新，跳过 ${stats.skipped} 个，失败 ${stats.failed} 个`;
  }
  if (stats.total > 0) {
    return `${label}已是最新，跳过 ${stats.skipped} 个`;
  }
  return `${label}没有可处理的技能`;
}

function readAiSummaryStats(data: unknown): AiSummaryStats | null {
  if (Array.isArray(data)) {
    return {
      total: data.length,
      updated: data.length,
      skipped: 0,
      failed: 0,
    };
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
  return {
    total: readNumber(record.total),
    updated: readNumber(record.updated),
    skipped: readNumber(record.skipped),
    failed: readNumber(record.failed),
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
