import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { gatewayClient } from '@/lib/gateway-client';
import { useAppStore, type ToolApprovalRequest } from '@/lib/store';
import { BorderRadius, Spacing, Typography, getColors } from '@/lib/theme';

/**
 * Human approval checkpoints surface (issue #586).
 *
 * Lists tool calls awaiting human approval and lets the user act on them inline.
 * The store currently tracks a single in-flight approval (`pendingToolApproval`),
 * so this renders that one when present. The full-screen {@link ToolApprovalModal}
 * (rendered globally in the tabs layout) handles the detailed review; this card
 * gives the approval a persistent, discoverable home inside the Tasks tab and an
 * inline approve/deny shortcut.
 */
export function PendingApprovals() {
  const darkMode = useAppStore((s) => s.darkMode);
  const request = useAppStore((s) => s.pendingToolApproval);
  const colors = getColors(darkMode ? 'dark' : 'light');

  if (!request) return null;

  const riskColor = getRiskColor(request.riskLevel, colors);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
        Pending Approvals (1)
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: riskColor },
        ]}
      >
        <View style={styles.header}>
          <View style={[styles.iconFrame, { backgroundColor: riskColor + '20' }]}>
            <Feather name="shield" size={18} color={riskColor} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {request.toolName}
            </Text>
            <Text style={[styles.subtitle, { color: riskColor }]}>
              {request.riskLevel.toUpperCase()} RISK
            </Text>
          </View>
        </View>

        {request.description ? (
          <Text
            style={[styles.description, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {request.description}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Deny pending tool request"
            onPress={() => deny(request)}
            style={[styles.button, { borderColor: colors.border }]}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>Deny</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Approve pending tool request"
            onPress={() => approve(request)}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.primaryButtonText}>Approve</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function approve(request: ToolApprovalRequest): void {
  gatewayClient.respondToToolApproval(request.toolCallId, true);
}

function deny(request: ToolApprovalRequest): void {
  gatewayClient.respondToToolApproval(request.toolCallId, false);
}

function getRiskColor(
  riskLevel: ToolApprovalRequest['riskLevel'],
  colors: ReturnType<typeof getColors>,
): string {
  if (riskLevel === 'critical') return colors.error;
  if (riskLevel === 'high') return colors.warning;
  if (riskLevel === 'medium') return colors.primary;
  return colors.success;
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  sectionHeader: {
    ...Typography.captionBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconFrame: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...Typography.bodyBold,
  },
  subtitle: {
    ...Typography.small,
    fontWeight: '600',
    marginTop: Spacing.xxs,
  },
  description: {
    ...Typography.caption,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  button: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    ...Typography.captionBold,
  },
  primaryButtonText: {
    ...Typography.captionBold,
    color: '#FFFFFF',
  },
});
