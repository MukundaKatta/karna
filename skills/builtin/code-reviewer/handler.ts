// ─── Code Reviewer Skill Handler ──────────────────────────────────────────
//
// Analyzes code for bugs, security issues, performance problems, and
// style improvements. Generates structured reviews with severity levels.
//
// ───────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:code-reviewer" });

// ─── Types ──────────────────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low";
type ReviewCategory = "bug" | "security" | "performance" | "style";

interface ReviewFinding {
  severity: Severity;
  category: ReviewCategory;
  description: string;
  line?: number;
  endLine?: number;
  suggestion: string;
  code?: string;
}

interface ReviewReport {
  filePath?: string;
  language?: string;
  findings: ReviewFinding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    grade: string;
  };
  reviewedAt: string;
}

// ─── Patterns ───────────────────────────────────────────────────────────────

interface CodePattern {
  pattern: RegExp;
  category: ReviewCategory;
  severity: Severity;
  description: string;
  suggestion: string;
  languages?: string[];
}

const SECURITY_PATTERNS: CodePattern[] = [
  {
    pattern: /(?:password|secret|api_key|apikey|token)\s*[:=]\s*['"][^'"]+['"]/gi,
    category: "security",
    severity: "critical",
    description: "Hardcoded secret or credential detected",
    suggestion: "Move secrets to environment variables or a secrets manager",
  },
  {
    pattern: /eval\s*\(/g,
    category: "security",
    severity: "high",
    description: "Use of eval() can lead to code injection",
    suggestion: "Avoid eval(). Use JSON.parse() for data or a safer alternative",
    languages: ["javascript", "typescript", "python"],
  },
  {
    pattern: /innerHTML\s*=/g,
    category: "security",
    severity: "high",
    description: "Direct innerHTML assignment may cause XSS",
    suggestion: "Use textContent, or sanitize HTML with DOMPurify before assigning",
    languages: ["javascript", "typescript"],
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    category: "security",
    severity: "medium",
    description: "dangerouslySetInnerHTML bypasses React's XSS protection",
    suggestion: "Ensure the HTML is sanitized before using dangerouslySetInnerHTML",
    languages: ["javascript", "typescript"],
  },
  {
    pattern: /exec\s*\(\s*['"`].*\$\{/g,
    category: "security",
    severity: "critical",
    description: "Command injection via string interpolation in exec()",
    suggestion: "Use parameterized commands or execFile() with an args array",
  },
  {
    pattern: /SELECT\s+.*\+\s*(?:req\.|input|user|param)/gi,
    category: "security",
    severity: "critical",
    description: "Potential SQL injection via string concatenation",
    suggestion: "Use parameterized queries or an ORM",
  },
];

const BUG_PATTERNS: CodePattern[] = [
  {
    pattern: /===?\s*undefined\s*\|\|\s*\w+\s*===?\s*null/g,
    category: "bug",
    severity: "low",
    description: "Verbose null/undefined check",
    suggestion: "Consider using the nullish coalescing operator (??) or optional chaining (?.)",
    languages: ["javascript", "typescript"],
  },
  {
    pattern: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g,
    category: "bug",
    severity: "high",
    description: "Empty catch block silently swallows errors",
    suggestion: "Log the error or rethrow. Silent catches hide bugs",
  },
  {
    pattern: /\.then\s*\([^)]*\)\s*(?!\.catch)/g,
    category: "bug",
    severity: "medium",
    description: "Promise chain without error handling",
    suggestion: "Add a .catch() handler or use async/await with try/catch",
    languages: ["javascript", "typescript"],
  },
  {
    pattern: /==\s*(?!=)/g,
    category: "bug",
    severity: "low",
    description: "Loose equality (==) can cause unexpected type coercion",
    suggestion: "Use strict equality (===) instead",
    languages: ["javascript", "typescript"],
  },
];

const PERFORMANCE_PATTERNS: CodePattern[] = [
  {
    pattern: /for\s*\(.*\)\s*\{[^}]*(?:await)\s/g,
    category: "performance",
    severity: "medium",
    description: "Sequential await inside a loop",
    suggestion: "Use Promise.all() or Promise.allSettled() for parallel execution if iterations are independent",
    languages: ["javascript", "typescript"],
  },
  {
    pattern: /JSON\.parse\(JSON\.stringify\(/g,
    category: "performance",
    severity: "medium",
    description: "Deep clone via JSON serialization is slow and loses non-serializable values",
    suggestion: "Use structuredClone() (Node 17+) or a library like lodash.cloneDeep",
    languages: ["javascript", "typescript"],
  },
  {
    pattern: /new\s+RegExp\(/g,
    category: "performance",
    severity: "low",
    description: "Dynamic RegExp created inside a potentially hot path",
    suggestion: "If the pattern is static, define the regex outside the function as a constant",
  },
];

const STYLE_PATTERNS: CodePattern[] = [
  {
    pattern: /console\.log\(/g,
    category: "style",
    severity: "low",
    description: "console.log should not be in production code",
    suggestion: "Use a proper logging library (e.g., pino, winston)",
    languages: ["javascript", "typescript"],
  },
  {
    pattern: /\/\/\s*TODO/gi,
    category: "style",
    severity: "low",
    description: "TODO comment found",
    suggestion: "Track TODOs in a task tracker or resolve before merging",
  },
  {
    pattern: /any(?:\s|;|,|\))/g,
    category: "style",
    severity: "medium",
    description: "Use of 'any' type reduces type safety",
    suggestion: "Replace with a specific type, unknown, or a generic",
    languages: ["typescript"],
  },
];

const ALL_PATTERNS = [
  ...SECURITY_PATTERNS,
  ...BUG_PATTERNS,
  ...PERFORMANCE_PATTERNS,
  ...STYLE_PATTERNS,
];

// ─── Handler ────────────────────────────────────────────────────────────────

export class CodeReviewerHandler implements SkillHandler {
  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Code reviewer skill initialized");
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing code review action");

    try {
      switch (action) {
        case "review":
          return this.reviewCode(input, context);
        case "diff":
          return this.reviewDiff(input);
        case "security":
          return this.securityScan(input, context);
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: `Action "${action}" is not supported`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "Code review action failed");
      return { success: false, output: `Failed: ${message}`, error: message };
    }
  }

  async dispose(): Promise<void> {
    logger.info("Code reviewer skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async reviewCode(
    input: Record<string, unknown>,
    _context: SkillContext
  ): Promise<SkillResult> {
    const code = (input["code"] as string) ?? "";
    const filePath = input["filePath"] as string | undefined;
    const language = (input["language"] as string) ?? this.detectLanguage(filePath ?? "", code);

    let sourceCode = code;

    if (!sourceCode && filePath) {
      // In production, would use file_read tool to read the file
      logger.debug({ filePath }, "Reading file for review");
      return {
        success: false,
        output: `File reading requires the file_read tool. Provide the code directly via the 'code' parameter, or ensure the files tool is available.`,
        error: "File read not available in stub mode",
      };
    }

    if (!sourceCode) {
      return {
        success: false,
        output: "No code provided. Use 'code' or 'filePath' parameter.",
        error: "No code to review",
      };
    }

    const findings = this.analyzeCode(sourceCode, language);
    const report = this.buildReport(findings, filePath, language);

    return {
      success: true,
      output: this.formatReport(report),
      data: report as unknown as Record<string, unknown>,
    };
  }

  private async reviewDiff(input: Record<string, unknown>): Promise<SkillResult> {
    const diff = (input["diff"] as string) ?? (input["args"] as string) ?? "";
    if (!diff.trim()) {
      return {
        success: false,
        output: "No diff provided. Pass a git diff via the 'diff' parameter.",
        error: "No diff to review",
      };
    }

    // Extract added lines from diff
    const addedLines = diff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");

    if (!addedLines.trim()) {
      return {
        success: true,
        output: "No added lines in the diff to review.",
      };
    }

    const findings = this.analyzeCode(addedLines, "unknown");
    const report = this.buildReport(findings, undefined, "diff");

    return {
      success: true,
      output: `Diff Review:\n\n${this.formatReport(report)}`,
      data: report as unknown as Record<string, unknown>,
    };
  }

  private async securityScan(
    input: Record<string, unknown>,
    _context: SkillContext
  ): Promise<SkillResult> {
    const code = (input["code"] as string) ?? "";
    if (!code) {
      return {
        success: false,
        output: "No code provided for security scan.",
        error: "No code",
      };
    }

    const language = (input["language"] as string) ?? "unknown";
    const findings = this.analyzeCode(code, language).filter(
      (f) => f.category === "security"
    );

    const report = this.buildReport(findings, input["filePath"] as string, language);

    if (findings.length === 0) {
      return {
        success: true,
        output: "No security issues detected in the provided code.",
        data: report as unknown as Record<string, unknown>,
      };
    }

    return {
      success: true,
      output: `Security Scan Results:\n\n${this.formatReport(report)}`,
      data: report as unknown as Record<string, unknown>,
    };
  }

  // ─── Analysis ──────────────────────────────────────────────────────────

  private analyzeCode(code: string, language: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const lines = code.split("\n");

    for (const pattern of ALL_PATTERNS) {
      // Skip patterns not applicable to this language
      if (
        pattern.languages &&
        language !== "unknown" &&
        !pattern.languages.includes(language)
      ) {
        continue;
      }

      // Reset regex state
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(code)) !== null) {
        // Find the line number
        const beforeMatch = code.slice(0, match.index);
        const lineNumber = beforeMatch.split("\n").length;

        findings.push({
          severity: pattern.severity,
          category: pattern.category,
          description: pattern.description,
          line: lineNumber,
          suggestion: pattern.suggestion,
          code: lines[lineNumber - 1]?.trim(),
        });
      }
    }

    // Sort by severity
    const severityOrder: Record<Severity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return findings;
  }

  private buildReport(
    findings: ReviewFinding[],
    filePath?: string,
    language?: string
  ): ReviewReport {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of findings) {
      counts[finding.severity]++;
    }

    // Calculate grade
    let grade: string;
    if (counts.critical > 0) grade = "F";
    else if (counts.high > 2) grade = "D";
    else if (counts.high > 0) grade = "C";
    else if (counts.medium > 3) grade = "C";
    else if (counts.medium > 0) grade = "B";
    else if (counts.low > 5) grade = "B";
    else if (counts.low > 0) grade = "A";
    else grade = "A+";

    return {
      filePath,
      language,
      findings,
      summary: {
        total: findings.length,
        ...counts,
        grade,
      },
      reviewedAt: new Date().toISOString(),
    };
  }

  // ─── Formatting ────────────────────────────────────────────────────────

  private formatReport(report: ReviewReport): string {
    const lines: string[] = [];

    if (report.filePath) {
      lines.push(`Code Review: ${report.filePath}`);
    }
    if (report.language) {
      lines.push(`Language: ${report.language}`);
    }
    lines.push(`${"─".repeat(50)}\n`);

    if (report.findings.length === 0) {
      lines.push("No issues found. Code looks clean!\n");
    } else {
      for (const finding of report.findings) {
        const sevLabel = `[${finding.severity.toUpperCase()}]`.padEnd(10);
        lines.push(
          `${sevLabel} ${finding.category}: ${finding.description}`
        );
        if (finding.line) {
          lines.push(`           Line: ${finding.line}${finding.endLine ? `-${finding.endLine}` : ""}`);
        }
        if (finding.code) {
          lines.push(`           Code: ${finding.code}`);
        }
        lines.push(`           Fix:  ${finding.suggestion}`);
        lines.push("");
      }
    }

    lines.push(`${"─".repeat(50)}`);
    lines.push(
      `Summary: ${report.summary.total} findings | Grade: ${report.summary.grade}`
    );
    lines.push(
      `  Critical: ${report.summary.critical} | High: ${report.summary.high} | Medium: ${report.summary.medium} | Low: ${report.summary.low}`
    );

    return lines.join("\n");
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private detectLanguage(filePath: string, _code: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      go: "go",
      rs: "rust",
      java: "java",
      c: "c",
      cpp: "cpp",
      h: "c",
      hpp: "cpp",
      rb: "ruby",
      php: "php",
      swift: "swift",
      kt: "kotlin",
    };
    return langMap[ext] ?? "unknown";
  }
}

export default CodeReviewerHandler;
