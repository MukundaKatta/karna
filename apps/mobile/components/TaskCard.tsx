import React, { useRef } from 'react';
import { Animated, Alert, View, Text, StyleSheet, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppStore, type Reminder } from '@/lib/store';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';
import { formatReminderDueDate } from '@/lib/date-format';

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
  const swipeableRef = useRef<Swipeable>(null);
  const removeProgress = useRef(new Animated.Value(1)).current;
  const isRemoving = useRef(false);

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
    ? formatReminderDueDate(reminder.dueDate)
    : null;

  const isOverdue =
    reminder.dueDate &&
    reminder.dueDate < Date.now() &&
    reminder.status !== 'done';

  const handleComplete = async () => {
    swipeableRef.current?.close();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onComplete(reminder.id);
  };

  const handleSwipeOpen = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const animateAndDelete = async () => {
    if (isRemoving.current) return;
    isRemoving.current = true;
    swipeableRef.current?.close();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    Animated.timing(removeProgress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) onDelete(reminder.id);
    });
  };

  const handleDeleteRequest = () => {
    swipeableRef.current?.close();
    Alert.alert(
      'Delete task?',
      reminder.title,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void animateAndDelete();
          },
        },
      ],
    );
  };

  const handleSwipeableOpen = (direction: 'left' | 'right') => {
    handleSwipeOpen();
    if (direction === 'left') {
      void handleComplete();
      return;
    }
    handleDeleteRequest();
  };

  const renderLeftActions = () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Complete ${reminder.title}`}
      onPress={handleComplete}
      style={[styles.swipeAction, { backgroundColor: colors.success }]}
    >
      <Feather name="check" size={20} color="#FFFFFF" />
      <Text style={styles.swipeActionText}>Done</Text>
    </Pressable>
  );

  const renderRightActions = () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Delete ${reminder.title}`}
      onPress={handleDeleteRequest}
      style={[styles.swipeAction, { backgroundColor: colors.error }]}
    >
      <Feather name="trash-2" size={20} color="#FFFFFF" />
      <Text style={styles.swipeActionText}>Delete</Text>
    </Pressable>
  );

  return (
    <Animated.View
      style={[
        styles.swipeContainer,
        {
          opacity: removeProgress,
          transform: [{ scaleY: removeProgress }],
          marginVertical: removeProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, Spacing.sm],
          }),
        },
      ]}
    >
      <Swipeable
        ref={swipeableRef}
        renderLeftActions={renderLeftActions}
        renderRightActions={renderRightActions}
        leftThreshold={48}
        rightThreshold={48}
        overshootLeft={false}
        overshootRight={false}
        onSwipeableWillOpen={handleSwipeOpen}
        onSwipeableOpen={handleSwipeableOpen}
      >
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
                onPress={handleDeleteRequest}
                style={[styles.actionButton, { backgroundColor: colors.surfaceAlt }]}
              >
                <Feather name="trash-2" size={14} color={colors.error} />
              </Pressable>
            </View>
          </View>
        </View>
      </Swipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  swipeContainer: {
    marginHorizontal: Spacing.lg,
    overflow: 'hidden',
    borderRadius: BorderRadius.lg,
  },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
  },
  swipeAction: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  swipeActionText: {
    ...Typography.small,
    color: '#FFFFFF',
    fontWeight: '700',
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
