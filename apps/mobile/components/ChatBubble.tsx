import React, { memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useAppStore, type ChatMessage } from '@/lib/store';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';
import { ToolCallDisplay } from './ToolCallDisplay';

interface ChatBubbleProps {
  message: ChatMessage;
}

const COLLAPSE_THRESHOLD = 500;
const LONG_MESSAGE_LINE_THRESHOLD = 18;

export const ChatBubble = memo(function ChatBubble({ message }: ChatBubbleProps) {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');
  const isUser = message.role === 'user';
  const [showCopy, setShowCopy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { height } = useWindowDimensions();
  const isLongMessage =
    message.content.length > COLLAPSE_THRESHOLD ||
    message.content.split('\n').length > LONG_MESSAGE_LINE_THRESHOLD;
  const renderedContent =
    isLongMessage && !expanded
      ? `${message.content.slice(0, COLLAPSE_THRESHOLD).trimEnd()}…`
      : message.content;
  const maxScrollableHeight = Math.max(220, Math.round(height * 0.45));

  const handleLongPress = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowCopy(true);
    setTimeout(() => setShowCopy(false), 3000);
  }, []);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(message.content);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowCopy(false);
  }, [message.content]);

  const bubbleStyle: ViewStyle = {
    backgroundColor: isUser ? colors.userBubble : colors.assistantBubble,
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    maxWidth: '85%',
    borderRadius: BorderRadius.lg,
    borderBottomRightRadius: isUser ? BorderRadius.sm : BorderRadius.lg,
    borderBottomLeftRadius: isUser ? BorderRadius.lg : BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginVertical: Spacing.xs,
    marginHorizontal: Spacing.lg,
  };

  const textColor = isUser ? colors.userBubbleText : colors.assistantBubbleText;

  const time = new Date(message.timestamp);
  const timeStr = time.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View>
      <Pressable onLongPress={handleLongPress} style={bubbleStyle}>
        <ScrollView
          nestedScrollEnabled
          scrollEnabled={isLongMessage && expanded}
          showsVerticalScrollIndicator={isLongMessage && expanded}
          style={isLongMessage && expanded ? { maxHeight: maxScrollableHeight } : undefined}
        >
          <MarkdownText
            text={renderedContent}
            color={textColor}
            isUser={isUser}
          />
        </ScrollView>
        {isLongMessage && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show less message text' : 'Show more message text'}
            onPress={() => setExpanded((value) => !value)}
            style={styles.expandButton}
          >
            <Text
              style={[
                styles.expandText,
                { color: isUser ? colors.userBubbleText : colors.primary },
              ]}
            >
              {expanded ? 'Show less' : 'Show more'}
            </Text>
          </Pressable>
        )}
        <Text
          style={[
            styles.timestamp,
            {
              color: isUser
                ? 'rgba(255,255,255,0.6)'
                : colors.textTertiary,
              textAlign: isUser ? 'right' : 'left',
            },
          ]}
        >
          {timeStr}
        </Text>
      </Pressable>

      {showCopy && (
        <Pressable
          onPress={handleCopy}
          style={[
            styles.copyButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              marginHorizontal: Spacing.lg,
            },
          ]}
        >
          <Text style={[styles.copyText, { color: colors.primary }]}>
            Copy message
          </Text>
        </Pressable>
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <View style={styles.toolCallsContainer}>
          {message.toolCalls.map((tc) => (
            <ToolCallDisplay key={tc.id} toolCall={tc} />
          ))}
        </View>
      )}
    </View>
  );
});

// ── Minimal Markdown Renderer ────────────────────────────────────────────────

interface MarkdownTextProps {
  text: string;
  color: string;
  isUser: boolean;
}

function MarkdownText({ text, color, isUser }: MarkdownTextProps) {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const lines = text.split('\n');
  const blocks = toMarkdownBlocks(lines);

  return (
    <View>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return (
            <CodeBlock
              key={`code-${i}`}
              code={block.content}
              colors={colors}
              isUser={isUser}
            />
          );
        }

        const line = block.content;

        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <View key={i} style={styles.listItem}>
              <Text style={[styles.bullet, { color }]}>{'\u2022'}</Text>
              <Text style={[styles.bodyText, { color, flex: 1 }]}>
                {renderInlineMarkdown(line.slice(2), color, isUser, colors)}
              </Text>
            </View>
          );
        }

        if (/^\d+\.\s/.test(line)) {
          const match = line.match(/^(\d+\.)\s(.*)/);
          if (match) {
            return (
              <View key={i} style={styles.listItem}>
                <Text style={[styles.bullet, { color }]}>{match[1]}</Text>
                <Text style={[styles.bodyText, { color, flex: 1 }]}>
                  {renderInlineMarkdown(match[2], color, isUser, colors)}
                </Text>
              </View>
            );
          }
        }

        return (
          <Text key={i} style={[styles.bodyText, { color }]}>
            {renderInlineMarkdown(line, color, isUser, colors)}
          </Text>
        );
      })}
    </View>
  );
}

type MarkdownBlock =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string };

function toMarkdownBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ type: 'code', content: codeLines.join('\n') });
        codeLines = [];
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
    } else {
      blocks.push({ type: 'text', content: line });
    }
  }

  if (codeLines.length > 0) {
    blocks.push({ type: 'code', content: codeLines.join('\n') });
  }

  return blocks;
}

function CodeBlock({
  code,
  colors,
  isUser,
}: {
  code: string;
  colors: ReturnType<typeof getColors>;
  isUser: boolean;
}) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={[
        styles.codeBlock,
        {
          backgroundColor: isUser
            ? 'rgba(255,255,255,0.15)'
            : colors.surfaceAlt,
        },
      ]}
    >
      <Text style={[styles.codeBlockText, { color: isUser ? colors.userBubbleText : colors.text }]}>
        {code}
      </Text>
    </ScrollView>
  );
}

function renderInlineMarkdown(
  text: string,
  color: string,
  isUser: boolean,
  colors: ReturnType<typeof getColors>,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        parts.push(
          <Text key={key++}>{remaining.slice(0, boldMatch.index)}</Text>,
        );
      }
      parts.push(
        <Text key={key++} style={{ fontWeight: '700' }}>
          {boldMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/\*(.+?)\*/);
    if (italicMatch && italicMatch.index !== undefined) {
      if (italicMatch.index > 0) {
        parts.push(
          <Text key={key++}>{remaining.slice(0, italicMatch.index)}</Text>,
        );
      }
      parts.push(
        <Text key={key++} style={{ fontStyle: 'italic' }}>
          {italicMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(italicMatch.index + italicMatch[0].length);
      continue;
    }

    // Inline code
    const codeMatch = remaining.match(/`(.+?)`/);
    if (codeMatch && codeMatch.index !== undefined) {
      if (codeMatch.index > 0) {
        parts.push(
          <Text key={key++}>{remaining.slice(0, codeMatch.index)}</Text>,
        );
      }
      parts.push(
        <Text
          key={key++}
          style={[
            styles.inlineCode,
            {
              backgroundColor: isUser
                ? 'rgba(255,255,255,0.15)'
                : colors.surfaceAlt,
              color,
            },
          ]}
        >
          {codeMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
      continue;
    }

    // Plain text remainder
    parts.push(<Text key={key++}>{remaining}</Text>);
    break;
  }

  return parts;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bodyText: {
    ...Typography.body,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  timestamp: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  bullet: {
    ...Typography.body,
    lineHeight: 24,
    width: 16,
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 14,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  codeBlock: {
    borderRadius: BorderRadius.md,
    marginVertical: Spacing.xs,
    maxWidth: '100%',
  },
  codeBlockText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
    padding: Spacing.sm,
  },
  expandButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  expandText: {
    ...Typography.caption,
    fontWeight: '700',
  },
  copyButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.xs,
  },
  copyText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  toolCallsContainer: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
  },
});
