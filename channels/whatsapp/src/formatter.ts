// ─── WhatsApp Formatter ─────────────────────────────────────────────────────
//
// Converts standard Markdown to WhatsApp-compatible formatting:
//   *bold*  _italic_  ~strikethrough~  ```code```  `inline code`
//

const WHATSAPP_MAX_MESSAGE_LENGTH = 65536;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Convert standard Markdown to WhatsApp formatting.
 *
 * WhatsApp supports:
 *   *bold*           (single asterisks)
 *   _italic_         (single underscores)
 *   ~strikethrough~  (single tildes)
 *   ```code```       (triple backticks for monospace)
 *   `inline code`    (single backticks — some clients)
 */
export function formatForWhatsApp(content: string): string {
  if (!content) return "";

  let result = content;

  // Convert **bold** -> *bold*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert ~~strikethrough~~ -> ~strikethrough~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // Italic with underscores is already compatible: _text_
  // Italic with single asterisks *text* conflicts with WhatsApp bold,
  // so we only convert underscore-style italic (already native)

  // Code blocks (```lang\ncode```) stay as-is since WhatsApp supports them
  // Inline code (`code`) stays as-is

  // Convert Markdown links [text](url) -> text (url)
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");

  // Convert Markdown headers (# Header) -> *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert bullet lists (- item) -> bullet character
  result = result.replace(/^[-*]\s+/gm, "\u2022 ");

  return result;
}

/**
 * Split a long message into chunks for WhatsApp.
 * WhatsApp supports much longer messages than Telegram, but we still
 * split at reasonable boundaries.
 */
export function splitLongMessage(
  text: string,
  maxLen: number = WHATSAPP_MAX_MESSAGE_LENGTH,
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
    if (splitIndex <= 0) {
      splitIndex = maxLen;
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function findSplitPoint(text: string, maxLen: number): number {
  const doubleNewline = text.lastIndexOf("\n\n", maxLen);
  if (doubleNewline > maxLen * 0.5) return doubleNewline;

  const singleNewline = text.lastIndexOf("\n", maxLen);
  if (singleNewline > maxLen * 0.5) return singleNewline;

  const space = text.lastIndexOf(" ", maxLen);
  if (space > maxLen * 0.3) return space;

  return -1;
}
