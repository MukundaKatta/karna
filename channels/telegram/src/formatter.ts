// ─── Telegram MarkdownV2 Formatter ──────────────────────────────────────────
//
// Telegram's MarkdownV2 requires escaping a specific set of characters.
// This module converts standard Markdown to Telegram-compatible MarkdownV2.

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// Characters that must be escaped in MarkdownV2 outside of code blocks
const SPECIAL_CHARS = /([_\[\]()~`>#+\-=|{}.!\\])/g;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Convert standard Markdown content to Telegram MarkdownV2 format.
 * Handles code blocks, inline code, bold, italic, links, and escaping.
 */
export function formatForTelegram(content: string): string {
  if (!content) return "";

  // Split content into code blocks and non-code segments
  const segments = splitByCodeBlocks(content);
  const formatted = segments
    .map((segment) => {
      if (segment.isCodeBlock) {
        return formatCodeBlock(segment.text, segment.language);
      }
      if (segment.isInlineCode) {
        return `\`${segment.text}\``;
      }
      return formatTextSegment(segment.text);
    })
    .join("");

  return formatted;
}

/**
 * Split a long message into chunks that fit within Telegram's message size limit.
 * Tries to split at natural boundaries (newlines, sentences, words).
 */
export function splitLongMessage(
  text: string,
  maxLen: number = TELEGRAM_MAX_MESSAGE_LENGTH,
): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = findSplitPoint(remaining, maxLen);

    // If no natural split point found, force split at maxLen
    if (splitIndex <= 0) {
      splitIndex = maxLen;
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Escape special characters for Telegram MarkdownV2.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(SPECIAL_CHARS, "\\$1");
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

interface TextSegment {
  text: string;
  isCodeBlock: boolean;
  isInlineCode: boolean;
  language?: string;
}

/**
 * Split content into alternating text and code block segments.
 */
function splitByCodeBlocks(content: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      segments.push(...splitByInlineCode(textBefore));
    }

    // Code block
    segments.push({
      text: match[2] ?? "",
      isCodeBlock: true,
      isInlineCode: false,
      language: match[1] || undefined,
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < content.length) {
    segments.push(...splitByInlineCode(content.slice(lastIndex)));
  }

  return segments;
}

/**
 * Split text by inline code segments.
 */
function splitByInlineCode(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const inlineCodeRegex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineCodeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        isCodeBlock: false,
        isInlineCode: false,
      });
    }

    segments.push({
      text: match[1] ?? "",
      isCodeBlock: false,
      isInlineCode: true,
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isCodeBlock: false,
      isInlineCode: false,
    });
  }

  return segments;
}

/**
 * Format a non-code text segment for MarkdownV2.
 */
function formatTextSegment(text: string): string {
  let result = text;

  // Convert bold: **text** -> *text* (after escaping)
  // We need to handle bold/italic before escaping
  const boldItalicParts: Array<{ original: string; replacement: string }> = [];

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, (_match, content: string) => {
    const placeholder = `\x00BOLD${boldItalicParts.length}\x00`;
    boldItalicParts.push({
      original: placeholder,
      replacement: `*${escapeMarkdown(content)}*`,
    });
    return placeholder;
  });

  // Italic: *text* or _text_
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_match, content: string) => {
    const placeholder = `\x00ITALIC${boldItalicParts.length}\x00`;
    boldItalicParts.push({
      original: placeholder,
      replacement: `_${escapeMarkdown(content)}_`,
    });
    return placeholder;
  });

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, (_match, content: string) => {
    const placeholder = `\x00STRIKE${boldItalicParts.length}\x00`;
    boldItalicParts.push({
      original: placeholder,
      replacement: `~${escapeMarkdown(content)}~`,
    });
    return placeholder;
  });

  // Links: [text](url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, (_match, linkText: string, url: string) => {
    const placeholder = `\x00LINK${boldItalicParts.length}\x00`;
    boldItalicParts.push({
      original: placeholder,
      replacement: `[${escapeMarkdown(linkText)}](${url})`,
    });
    return placeholder;
  });

  // Escape remaining special characters
  result = escapeMarkdown(result);

  // Restore formatted parts
  for (const part of boldItalicParts) {
    result = result.replace(part.original, part.replacement);
  }

  return result;
}

/**
 * Format a code block for MarkdownV2.
 */
function formatCodeBlock(code: string, language?: string): string {
  const lang = language ? language : "";
  return `\`\`\`${lang}\n${code}\`\`\``;
}

/**
 * Find the best point to split a message.
 * Prefers splitting at double newlines, then single newlines, then sentence endings, then spaces.
 */
function findSplitPoint(text: string, maxLen: number): number {
  // Try double newline
  const doubleNewline = text.lastIndexOf("\n\n", maxLen);
  if (doubleNewline > maxLen * 0.5) return doubleNewline;

  // Try single newline
  const singleNewline = text.lastIndexOf("\n", maxLen);
  if (singleNewline > maxLen * 0.5) return singleNewline;

  // Try sentence ending
  const sentenceEnd = findLastSentenceEnd(text, maxLen);
  if (sentenceEnd > maxLen * 0.5) return sentenceEnd + 1;

  // Try space
  const space = text.lastIndexOf(" ", maxLen);
  if (space > maxLen * 0.3) return space;

  return -1;
}

/**
 * Find the last sentence-ending punctuation within the limit.
 */
function findLastSentenceEnd(text: string, maxLen: number): number {
  const searchArea = text.slice(0, maxLen);
  let lastEnd = -1;

  for (let i = searchArea.length - 1; i >= 0; i--) {
    const char = searchArea[i];
    if (char === "." || char === "!" || char === "?") {
      lastEnd = i;
      break;
    }
  }

  return lastEnd;
}
