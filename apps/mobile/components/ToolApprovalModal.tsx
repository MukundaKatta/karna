import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { gatewayClient } from '@/lib/gateway-client';
import { useAppStore, type ToolApprovalRequest } from '@/lib/store';
import { BorderRadius, Spacing, Typography, getColors } from '@/lib/theme';

export function ToolApprovalModal() {
  const darkMode = useAppStore((s) => s.darkMode);
  const request = useAppStore((s) => s.pendingToolApproval);
  const colors = getColors(darkMode ? 'dark' : 'light');

  if (!request) return null;

  const riskColor = getRiskColor(request.riskLevel, colors);
  const parameters = formatParameters(request.arguments);

  return (
    <Modal visible transparent animationType="fade">
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.modal,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.header}>
            <View
              style={[styles.iconFrame, { backgroundColor: riskColor + '20' }]}
            >
              <Feather name="shield" size={22} color={riskColor} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: colors.text }]}>
                Approve tool?
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {request.toolName}
              </Text>
            </View>
          </View>

          <View style={styles.riskRow}>
            <Text style={[styles.riskLabel, { color: colors.textSecondary }]}>
              Risk
            </Text>
            <Text style={[styles.riskValue, { color: riskColor }]}>
              {request.riskLevel.toUpperCase()}
            </Text>
          </View>

          {request.description ? (
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {request.description}
            </Text>
          ) : null}

          <ScrollView
            style={[
              styles.parameters,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            contentContainerStyle={styles.parametersContent}
          >
            <Text style={[styles.parametersText, { color: colors.text }]}>
              {parameters}
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Deny tool request"
              onPress={() => deny(request)}
              style={[styles.button, { borderColor: colors.border }]}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>
                Deny
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve all tool requests for this session"
              onPress={() => approveAll(request)}
              style={[styles.button, { borderColor: colors.primary }]}
            >
              <Text style={[styles.buttonText, { color: colors.primary }]}>
                Approve All
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve tool request"
              onPress={() => approve(request)}
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.primaryButtonText}>Approve</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function approve(request: ToolApprovalRequest): void {
  gatewayClient.respondToToolApproval(request.toolCallId, true);
}

function approveAll(request: ToolApprovalRequest): void {
  gatewayClient.respondToToolApproval(request.toolCallId, true, {
    approveAllForSession: true,
  });
}

function deny(request: ToolApprovalRequest): void {
  gatewayClient.respondToToolApproval(request.toolCallId, false);
}

function formatParameters(parameters: Record<string, unknown> | undefined): string {
  if (!parameters || Object.keys(parameters).length === 0) {
    return 'No parameters provided.';
  }
  return JSON.stringify(parameters, null, 2);
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
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  modal: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconFrame: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...Typography.subtitle,
  },
  subtitle: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  riskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  riskLabel: {
    ...Typography.caption,
  },
  riskValue: {
    ...Typography.captionBold,
  },
  description: {
    ...Typography.body,
  },
  parameters: {
    maxHeight: 180,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
  },
  parametersContent: {
    padding: Spacing.md,
  },
  parametersText: {
    ...Typography.code,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  buttonText: {
    ...Typography.captionBold,
  },
  primaryButtonText: {
    ...Typography.captionBold,
    color: '#FFFFFF',
  },
});
