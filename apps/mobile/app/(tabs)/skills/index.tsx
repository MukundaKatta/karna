import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  Switch,
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppStore, type Skill } from '@/lib/store';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';
import { SkillCard } from '@/components/SkillCard';

export default function SkillsScreen() {
  const darkMode = useAppStore((s) => s.darkMode);
  const skills = useAppStore((s) => s.skills);
  const toggleSkill = useAppStore((s) => s.toggleSkill);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const activeSkills = skills.filter((s) => s.active);
  const inactiveSkills = skills.filter((s) => !s.active);

  const handleToggle = useCallback(
    (id: string) => {
      toggleSkill(id);
    },
    [toggleSkill],
  );

  const handlePress = useCallback((skill: Skill) => {
    setSelectedSkill(skill);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Skill>) => (
      <SkillCard skill={item} onToggle={handleToggle} onPress={handlePress} />
    ),
    [handleToggle, handlePress],
  );

  const keyExtractor = useCallback((item: Skill) => item.id, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Active Skills */}
        {activeSkills.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[styles.sectionHeader, { color: colors.textSecondary }]}
            >
              Active Skills ({activeSkills.length})
            </Text>
            <View style={styles.grid}>
              {activeSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onToggle={handleToggle}
                  onPress={handlePress}
                />
              ))}
            </View>
          </View>
        )}

        {/* Inactive Skills */}
        {inactiveSkills.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[styles.sectionHeader, { color: colors.textSecondary }]}
            >
              Available Skills ({inactiveSkills.length})
            </Text>
            <View style={styles.grid}>
              {inactiveSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onToggle={handleToggle}
                  onPress={handlePress}
                />
              ))}
            </View>
          </View>
        )}

        {/* Empty State */}
        {skills.length === 0 && (
          <View style={styles.emptyContainer}>
            <Feather name="zap" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No skills installed
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: colors.textSecondary }]}
            >
              Skills extend Karna&apos;s capabilities. Connect to a Gateway to
              discover available skills.
            </Text>
          </View>
        )}

        {/* Install New Skills */}
        <View style={styles.section}>
          <Text
            style={[styles.sectionHeader, { color: colors.textSecondary }]}
          >
            Discover
          </Text>
          <Pressable
            style={[
              styles.installCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.installIcon,
                { backgroundColor: colors.primary + '15' },
              ]}
            >
              <Feather name="download" size={24} color={colors.primary} />
            </View>
            <View style={styles.installContent}>
              <Text style={[styles.installTitle, { color: colors.text }]}>
                Browse Skill Library
              </Text>
              <Text
                style={[
                  styles.installSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                Find and install new skills from the Karna marketplace
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={20}
              color={colors.textTertiary}
            />
          </Pressable>
        </View>
      </ScrollView>

      {/* Skill Detail Modal */}
      <Modal
        visible={selectedSkill !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedSkill(null)}
      >
        {selectedSkill && (
          <View
            style={[
              styles.modalContainer,
              { backgroundColor: colors.background },
            ]}
          >
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setSelectedSkill(null)}>
                <Feather name="x" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent}>
              <View
                style={[
                  styles.modalIcon,
                  {
                    backgroundColor: selectedSkill.active
                      ? colors.primary + '15'
                      : colors.surfaceAlt,
                  },
                ]}
              >
                <Feather
                  name={
                    (selectedSkill.icon as keyof typeof Feather.glyphMap) ||
                    'box'
                  }
                  size={40}
                  color={
                    selectedSkill.active ? colors.primary : colors.textTertiary
                  }
                />
              </View>

              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedSkill.name}
              </Text>
              <Text
                style={[
                  styles.modalVersion,
                  { color: colors.textTertiary },
                ]}
              >
                Version {selectedSkill.version}
              </Text>

              <Text
                style={[
                  styles.modalDescription,
                  { color: colors.textSecondary },
                ]}
              >
                {selectedSkill.description}
              </Text>

              <View
                style={[
                  styles.toggleRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.toggleLabel, { color: colors.text }]}>
                  Enabled
                </Text>
                <Switch
                  value={selectedSkill.active}
                  onValueChange={() => {
                    handleToggle(selectedSkill.id);
                    setSelectedSkill({
                      ...selectedSkill,
                      active: !selectedSkill.active,
                    });
                  }}
                  trackColor={{
                    false: colors.surfaceAlt,
                    true: colors.primary + '60',
                  }}
                  thumbColor={
                    selectedSkill.active ? colors.primary : colors.textTertiary
                  }
                />
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.xxxxl,
  },
  section: {
    marginTop: Spacing.xl,
  },
  sectionHeader: {
    ...Typography.captionBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
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
  installCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    gap: Spacing.md,
  },
  installIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  installContent: {
    flex: 1,
  },
  installTitle: {
    ...Typography.bodyBold,
  },
  installSubtitle: {
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  modalContent: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxxl,
  },
  modalIcon: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    ...Typography.title,
    textAlign: 'center',
  },
  modalVersion: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  modalDescription: {
    ...Typography.body,
    textAlign: 'center',
    marginTop: Spacing.xl,
    lineHeight: 24,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  toggleLabel: {
    ...Typography.bodyBold,
  },
});
