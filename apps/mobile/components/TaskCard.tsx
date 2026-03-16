import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppStore, type Reminder } from '@/lib/store';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';

interface TaskCardProps {
  reminder: Reminder;
  onComplete: (id: string) => void;
  onSnooze: (id: string) => void;
  onDelete: (id: string) => void;
}

export function TaskCard({
  reminder,
  onComplete,
  onSnooze,
  onDelete,
}: TaskCardProps) {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const statusConfig = {
    pending: { label: 'Pending', color: colors.warning, icon: 'clock' as const },
    'in-progress': {
      label: 'In Progress',
      color: colors.primary,
      icon: 'play-circle' as const,
    },
    done: { label: 'Done', color: colors.success, icon: 'check-circle' as const },
  }[reminder.status];

  const dueDateStr = reminder.dueDate
    ? new Date(reminder.dueDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const isOverdue =
    reminder.dueDate &&
    reminder.dueDate < Date.now() &&
    reminder.status !== 'done';

  const handleComplete = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onComplete(reminder.id);
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Pressable onPress={handleComplete} style={styles.checkButton}>
            <Feather
              name={
                reminder.status === 'done'
                  ? 'check-circle'
                  : 'circle'
              }
              size={22}
              color={
                reminder.status === 'done'
                  ? colors.success
                  : colors.textTertiary
              }
            />
          </Pressable>
          <View style={styles.titleContent}>
            <Text
              style={[
                styles.title,
                {
                  color: colors.text,
                  textDecorationLine:
                    reminder.status === 'done' ? 'line-through' : 'none',
                  opacity: reminder.status === 'done' ? 0.5 : 1,
                },
              ]}
              numberOfLines={2}
            >
              {reminder.title}
            </Text>
            {reminder.description && (
              <Text
                style={[styles.description, { color: colors.textSecondary }]}
                numberOfLines={2}
              >
                {reminder.description}
              </Text>
            )}
          </View>
        </View>

        <View
          style={[
            styles.statusBadge,
            { backgroundColor: statusConfig.color + '20' },
          ]}
        >
          <Feather name={statusConfig.icon} size={12} color={statusConfig.color} />
          <Text style={[styles.statusText, { color: statusConfig.color }]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        {dueDateStr && (
          <View style={styles.dateRow}>
            <Feather
              name="calendar"
              size={12}
              color={isOverdue ? colors.error : colors.textTertiary}
            />
            <Text
              style={[
                styles.dateText,
                { color: isOverdue ? colors.error : colors.textTertiary },
              ]}
            >
              {dueDateStr}
            </Text>
            {isOverdue && (
              <Text style={[styles.overdueLabel, { color: colors.error }]}>
                Overdue
              </Text>
            )}
          </View>
        )}

        <View style={styles.actions}>
          <Pressable
            onPress={() => onSnooze(reminder.id)}
            style={[styles.actionButton, { backgroundColor: colors.surfaceAlt }]}
          >
            <Feather name="clock" size={14} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => onDelete(reminder.id)}
            style={[styles.actionButton, { backgroundColor: colors.surfaceAlt }]}
          >
            <Feather name="trash-2" size={14} color={colors.error} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: Spacing.md,
  },
  checkButton: {
    paddingTop: 2,
  },
  titleContent: {
    flex: 1,
  },
  title: {
    ...Typography.bodyBold,
  },
  description: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  statusText: {
    ...Typography.small,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingLeft: 34,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dateText: {
    ...Typography.small,
  },
  overdueLabel: {
    ...Typography.small,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
