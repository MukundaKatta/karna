import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
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

export function ChatBubble({ message }: ChatBubbleProps) {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');
  const isUser = message.role === 'user';
  const [showCopy, setShowCopy] = useState(false);

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
        <MarkdownText text={message.content} color={textColor} isUser={isUser} />
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
}

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

  return (
    <View>
      {lines.map((line, i) => {
        if (line.startsWith('```')) {
          return null; // Code blocks handled by multi-line logic below
        }

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
