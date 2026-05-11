// ─── Memory Prompt-Injection Safety ────────────────────────────────────────

export interface MemorySafetyResult {
  original: string;
  sanitized: string;
  suspicious: boolean;
  reasons: string[];
}

const INJECTION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "instruction_override",
    pattern: /\b(ignore|forget|disregard|override)\s+(all\s+)?(previous|prior|above|system|developer)\s+instructions?\b/i,
  },
  {
    reason: "role_header",
    pattern: /(^|\n)\s*(system|developer|assistant|tool)\s*:/i,
  },
  {
    reason: "prompt_exfiltration",
    pattern: /\b(reveal|print|show|leak|dump)\s+(the\s+)?(system prompt|developer message|hidden instructions|instructions)\b/i,
  },
  {
    reason: "role_reassignment",
    pattern: /\b(you are now|act as|pretend to be)\s+(a\s+)?(system|developer|admin|jailbreak|different assistant)\b/i,
  },
  {
    reason: "policy_bypass",
    pattern: /\b(do not obey|bypass|jailbreak|disable safety|ignore safety)\b/i,
  },
  {
    reason: "chatml_tag",
    pattern: /<\s*\/?\s*(system|developer|assistant|tool|user)\b/i,
  },
];

const REDACTION = "[redacted memory instruction]";

export function analyzeMemorySafety(value: string): MemorySafetyResult {
  const original = value;
  const normalized = stripControlChars(value).trim();
  const reasons = new Set<string>();

  for (const { reason, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      reasons.add(reason);
    }
  }

  const sanitized = sanitizeMemoryText(normalized);

  return {
    original,
    sanitized,
    suspicious: reasons.size > 0 || sanitized !== normalized,
    reasons: Array.from(reasons),
  };
}

export function sanitizeMemoryText(value: string): string {
  return stripControlChars(value)
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      return INJECTION_PATTERNS.some(({ pattern }) => pattern.test(trimmed))
        ? REDACTION
        : trimmed;
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000)
    .trim();
}

export function sanitizeMemoryTags(tags: string[] | undefined): string[] {
  if (!tags) return [];

  const safeTags = tags
    .map((tag) => sanitizeMemoryText(tag).replace(/\s+/g, "-").slice(0, 64))
    .filter((tag) => tag && tag !== REDACTION);

  return Array.from(new Set(safeTags));
}

function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
