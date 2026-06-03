import type { SkillSafetyFinding, SkillSafetyReport } from "../../shared/types/skill";

interface SafetyRule {
  code: string;
  severity: SkillSafetyFinding["severity"];
  title: string;
  pattern: RegExp;
  detail: string;
}

const DANGEROUS_PATTERNS: SafetyRule[] = [
  {
    code: "sudo",
    severity: "warn",
    title: "Sudo detected",
    pattern: /\b(?:sudo|doas)\b/i,
    detail: "SKILL.md contains commands that may require privilege escalation",
  },
  {
    code: "rm-rf",
    severity: "high",
    title: "Recursive delete detected",
    pattern: /\b(?:rm\s+.*-rf?\b|rmdir\s+\/[sS])/i,
    detail: "Dangerous recursive file deletion detected",
  },
  {
    code: "curl-pipe",
    severity: "high",
    title: "Curl pipe to shell detected",
    pattern: /\b(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|python|perl|ruby)/i,
    detail: "Piping network content directly to an interpreter is discouraged",
  },
  {
    code: "eval-exec",
    severity: "high",
    title: "Dynamic code execution detected",
    pattern: /\b(?:eval|exec|system|subprocess\.call|os\.system|spawn)\b/i,
    detail: "SKILL.md references functions that can execute arbitrary code",
  },
  {
    code: "env-secrets",
    severity: "warn",
    title: "Environment variable access detected",
    pattern: /\b(?:process\.env|os\.environ|getenv|\.env)\b/i,
    detail: "SKILL.md references environment variables; avoid leaking secrets",
  },
  {
    code: "powershell-danger",
    severity: "high",
    title: "PowerShell dangerous operation",
    pattern: /\b(?:Invoke-Expression|IEX|Invoke-WebRequest|Remove-Item\s+-Recurse)\b/i,
    detail: "Dangerous PowerShell operation detected",
  },
  {
    code: "chmod-777",
    severity: "warn",
    title: "Insecure permission setting",
    pattern: /\bchmod\s+777\b/,
    detail: "chmod 777 grants full access to all users",
  },
  {
    code: "git-force-push",
    severity: "warn",
    title: "Git force push detected",
    pattern: /\bgit\s+push\s+.*(?:--force|-f)\b/,
    detail: "Force push may overwrite remote history",
  },
  {
    code: "npx-unsafe",
    severity: "warn",
    title: "npx with unknown package",
    pattern: /\bnpx\b(?!\s+(?:-v|--version|--help|-h)\b)/i,
    detail: "npx may download and execute unverified packages",
  },
];

const SAFE_SCORE = 95;
const WARN_SCORE = 65;
const HIGH_SCORE = 30;
const BLOCKED_SCORE = 10;

export function scanSkillSafety(content: string, fileCount = 1): SkillSafetyReport {
  const findings: SkillSafetyFinding[] = [];

  for (const rule of DANGEROUS_PATTERNS) {
    const match = content.match(rule.pattern);
    if (match) {
      const contextStart = Math.max(0, (match.index || 0) - 40);
      const contextEnd = Math.min(content.length, (match.index || 0) + (match[0]?.length || 0) + 40);
      findings.push({
        code: rule.code,
        severity: rule.severity,
        title: rule.title,
        detail: rule.detail,
        evidence: content.slice(contextStart, contextEnd).replace(/\n/g, " "),
      });
    }
  }

  if (findings.length === 0) {
    return {
      level: "safe",
      summary: "No obvious safety issues detected",
      findings: [],
      recommendedAction: "allow",
      scannedAt: Date.now(),
      checkedFileCount: fileCount,
      scanMethod: "pattern",
      score: SAFE_SCORE,
    };
  }

  const hasHigh = findings.some((f) => f.severity === "high");
  const highCount = findings.filter((f) => f.severity === "high").length;

  if (hasHigh && highCount >= 3) {
    return {
      level: "blocked",
      summary: `Detected ${findings.length} safety issues (${highCount} high-risk)`,
      findings,
      recommendedAction: "block",
      scannedAt: Date.now(),
      checkedFileCount: fileCount,
      scanMethod: "pattern",
      score: BLOCKED_SCORE,
    };
  }

  if (hasHigh) {
    return {
      level: "high-risk",
      summary: `Detected ${findings.length} safety issues (includes high-risk)`,
      findings,
      recommendedAction: "review",
      scannedAt: Date.now(),
      checkedFileCount: fileCount,
      scanMethod: "pattern",
      score: HIGH_SCORE,
    };
  }

  return {
    level: "warn",
    summary: `Detected ${findings.length} safety warnings`,
    findings,
    recommendedAction: "review",
    scannedAt: Date.now(),
    checkedFileCount: fileCount,
    scanMethod: "pattern",
    score: WARN_SCORE,
  };
}
