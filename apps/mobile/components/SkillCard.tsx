import React from 'react';
import { View, Text, StyleSheet, Pressable, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppStore, type Skill } from '@/lib/store';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';

interface SkillCardProps {
  skill: Skill;
  onToggle: (id: string) => void;
  onPress: (skill: Skill) => void;
}

export function SkillCard({ skill, onToggle, onPress }: SkillCardProps) {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const iconName = (skill.icon as keyof typeof Feather.glyphMap) || 'box';

  return (
    <Pressable
      onPress={() => onPress(skill)}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: skill.active ? colors.primary : colors.border,
          borderWidth: skill.active ? 1.5 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: skill.active
              ? colors.primary + '15'
              : colors.surfaceAlt,
          },
        ]}
      >
        <Feather
          name={iconName}
          size={24}
          color={skill.active ? colors.primary : colors.textTertiary}
        />
      </View>

      <Text
        style={[styles.name, { color: colors.text }]}
        numberOfLines={1}
      >
        {skill.name}
      </Text>

      <Text
        style={[styles.description, { color: colors.textSecondary }]}
        numberOfLines={2}
      >
        {skill.description}
      </Text>

      <View style={styles.footer}>
        <Text style={[styles.version, { color: colors.textTertiary }]}>
          v{skill.version}
        </Text>
        <Switch
          value={skill.active}
          onValueChange={() => onToggle(skill.id)}
          trackColor={{
            false: colors.surfaceAlt,
            true: colors.primary + '60',
          }}
          thumbColor={skill.active ? colors.primary : colors.textTertiary}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '48%',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  name: {
    ...Typography.bodyBold,
    marginBottom: Spacing.xs,
  },
  description: {
    ...Typography.caption,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  version: {
    ...Typography.small,
  },
});
