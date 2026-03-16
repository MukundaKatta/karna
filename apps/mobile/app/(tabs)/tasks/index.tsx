import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  TextInput,
  Modal,
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppStore, type Reminder } from '@/lib/store';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';
import { TaskCard } from '@/components/TaskCard';

export default function TasksScreen() {
  const darkMode = useAppStore((s) => s.darkMode);
  const reminders = useAppStore((s) => s.reminders);
  const addReminder = useAppStore((s) => s.addReminder);
  const completeReminder = useAppStore((s) => s.completeReminder);
  const deleteReminder = useAppStore((s) => s.deleteReminder);
  const updateReminder = useAppStore((s) => s.updateReminder);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const pendingReminders = reminders.filter((r) => r.status !== 'done');
  const completedReminders = reminders.filter((r) => r.status === 'done');

  const handleAdd = useCallback(() => {
    if (!newTitle.trim()) return;

    const reminder: Reminder = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title: newTitle.trim(),
      description: newDescription.trim() || undefined,
      status: 'pending',
      createdAt: Date.now(),
    };

    addReminder(reminder);
    setNewTitle('');
    setNewDescription('');
    setShowAddModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [newTitle, newDescription, addReminder]);

  const handleComplete = useCallback(
    (id: string) => {
      completeReminder(id);
    },
    [completeReminder],
  );

  const handleSnooze = useCallback(
    (id: string) => {
      // Snooze by 1 hour
      const reminder = reminders.find((r) => r.id === id);
      if (reminder) {
        updateReminder(id, {
          dueDate: Date.now() + 3600000,
        });
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [reminders, updateReminder],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteReminder(id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    [deleteReminder],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Reminder>) => (
      <TaskCard
        reminder={item}
        onComplete={handleComplete}
        onSnooze={handleSnooze}
        onDelete={handleDelete}
      />
    ),
    [handleComplete, handleSnooze, handleDelete],
  );

  const keyExtractor = useCallback((item: Reminder) => item.id, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Section Tabs */}
      <View style={styles.content}>
        <FlatList
          data={[...pendingReminders, ...completedReminders]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            pendingReminders.length > 0 ? (
              <Text
                style={[styles.sectionHeader, { color: colors.textSecondary }]}
              >
                Active ({pendingReminders.length})
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather
                name="check-square"
                size={48}
                color={colors.textTertiary}
              />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No tasks yet
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                Ask Karna to create reminders or add them here
              </Text>
            </View>
          }
        />
      </View>

      {/* FAB */}
      <Pressable
        onPress={() => setShowAddModal(true)}
        style={[styles.fab, { backgroundColor: colors.primary }]}
      >
        <Feather name="plus" size={24} color="#FFFFFF" />
      </Pressable>

      {/* Add Task Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View
          style={[
            styles.modalContainer,
            { backgroundColor: colors.background },
          ]}
        >
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowAddModal(false)}>
              <Text style={[styles.modalCancel, { color: colors.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              New Task
            </Text>
            <Pressable onPress={handleAdd}>
              <Text
                style={[
                  styles.modalSave,
                  {
                    color: newTitle.trim()
                      ? colors.primary
                      : colors.textTertiary,
                  },
                ]}
              >
                Add
              </Text>
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <TextInput
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.inputBackground,
                },
              ]}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Task title"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <TextInput
              style={[
                styles.modalInput,
                styles.modalTextArea,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.inputBackground,
                },
              ]}
              value={newDescription}
              onChangeText={setNewDescription}
              placeholder="Description (optional)"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  list: {
    paddingVertical: Spacing.sm,
  },
  sectionHeader: {
    ...Typography.captionBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 120,
  },
  emptyTitle: {
    ...Typography.subtitle,
    marginTop: Spacing.lg,
  },
  emptySubtitle: {
    ...Typography.body,
    marginTop: Spacing.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing.xxxl,
  },
  fab: {
    position: 'absolute',
    right: Spacing.xl,
    bottom: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  modalCancel: {
    ...Typography.body,
  },
  modalTitle: {
    ...Typography.bodyBold,
  },
  modalSave: {
    ...Typography.bodyBold,
  },
  modalBody: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  modalInput: {
    ...Typography.input,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  modalTextArea: {
    minHeight: 100,
    paddingTop: Spacing.md,
  },
});
