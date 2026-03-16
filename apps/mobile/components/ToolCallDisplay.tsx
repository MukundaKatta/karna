import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppStore, type ToolCall } from '@/lib/store';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';

interface ToolCallDisplayProps {
  toolCall: ToolCall;
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    running: 'loader' as const,
    success: 'check-circle' as const,
    error: 'x-circle' as const,
  }[toolCall.status];

  const statusColor = {
    running: colors.warning,
    success: colors.success,
    error: colors.error,
  }[toolCall.status];

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={styles.header}
      >
        <Feather name={statusIcon} size={14} color={statusColor} />
        <Text
          style={[styles.toolName, { color: colors.text }]}
          numberOfLines={1}
        >
          {toolCall.name}
        </Text>
        {toolCall.duration !== undefined && (
          <Text style={[styles.duration, { color: colors.textTertiary }]}>
            {toolCall.duration}ms
          </Text>
        )}
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textTertiary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.details}>
          {toolCall.input && (
            <View style={styles.section}>
              <Text
                style={[styles.sectionLabel, { color: colors.textSecondary }]}
              >
                Input
              </Text>
              <View
                style={[
                  styles.codeBlock,
                  { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text style={[styles.codeText, { color: colors.text }]}>
                  {JSON.stringify(toolCall.input, null, 2)}
                </Text>
              </View>
            </View>
          )}
          {toolCall.output && (
            <View style={styles.section}>
              <Text
                style={[styles.sectionLabel, { color: colors.textSecondary }]}
              >
                Output
              </Text>
              <View
                style={[
                  styles.codeBlock,
                  { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <Text
                  style={[styles.codeText, { color: colors.text }]}
                  numberOfLines={20}
                >
                  {toolCall.output}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginVertical: Spacing.xs,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  toolName: {
    ...Typography.captionBold,
    flex: 1,
  },
  duration: {
    ...Typography.small,
  },
  details: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  section: {
    marginTop: Spacing.sm,
  },
  sectionLabel: {
    ...Typography.small,
    fontWeight: '600',
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  codeBlock: {
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  codeText: {
    ...Typography.code,
    fontSize: 12,
  },
});
