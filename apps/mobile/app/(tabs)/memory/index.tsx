import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  Pressable,
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppStore, type MemoryEntry } from '@/lib/store';
import { gatewayClient } from '@/lib/gateway-client';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';

type MemoryCategory = 'all' | MemoryEntry['category'];

const CATEGORIES: { key: MemoryCategory; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'all', label: 'All', icon: 'grid' },
  { key: 'fact', label: 'Facts', icon: 'book-open' },
  { key: 'preference', label: 'Preferences', icon: 'heart' },
  { key: 'event', label: 'Events', icon: 'calendar' },
  { key: 'task', label: 'Tasks', icon: 'check-square' },
];

export default function MemoryScreen() {
  const darkMode = useAppStore((s) => s.darkMode);
  const memories = useAppStore((s) => s.memories);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredMemories = memories.filter((m) => {
    const matchesCategory =
      selectedCategory === 'all' || m.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (query.length >= 2) {
        gatewayClient.send({
          type: 'memory.search',
          payload: { query, category: selectedCategory === 'all' ? undefined : selectedCategory },
        });
      }
    },
    [selectedCategory],
  );

  const importanceColor = (importance: number) => {
    if (importance >= 0.8) return colors.error;
    if (importance >= 0.5) return colors.warning;
    return colors.textTertiary;
  };

  const categoryColor = (category: MemoryEntry['category']) => {
    const map = {
      fact: colors.primary,
      preference: colors.accent,
      event: colors.success,
      task: colors.warning,
    };
    return map[category];
  };

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MemoryEntry>) => {
      const isExpanded = expandedId === item.id;
      const catColor = categoryColor(item.category);
      const dateStr = new Date(item.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      return (
        <Pressable
          onPress={() => setExpandedId(isExpanded ? null : item.id)}
          style={[
            styles.memoryCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.cardHeader}>
            <View
              style={[
                styles.categoryBadge,
                { backgroundColor: catColor + '20' },
              ]}
            >
              <Text style={[styles.categoryText, { color: catColor }]}>
                {item.category}
              </Text>
            </View>
            <View style={styles.importanceRow}>
              <View
                style={[
                  styles.importanceDot,
                  { backgroundColor: importanceColor(item.importance) },
                ]}
              />
              <Text style={[styles.importanceText, { color: colors.textTertiary }]}>
                {Math.round(item.importance * 100)}%
              </Text>
            </View>
          </View>

          <Text
            style={[styles.memoryContent, { color: colors.text }]}
            numberOfLines={isExpanded ? undefined : 3}
          >
            {item.content}
          </Text>

          <View style={styles.cardFooter}>
            <Text style={[styles.dateText, { color: colors.textTertiary }]}>
              {dateStr}
            </Text>
            <Feather
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.textTertiary}
            />
          </View>
        </Pressable>
      );
    },
    [expandedId, colors],
  );

  const keyExtractor = useCallback((item: MemoryEntry) => item.id, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <Feather name="search" size={18} color={colors.textTertiary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={handleSearch}
            placeholder="Search memories..."
            placeholderTextColor={colors.textTertiary}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Feather name="x" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Category Filters */}
      <View style={styles.filterContainer}>
        <FlatList
          data={CATEGORIES}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          renderItem={({ item: cat }) => (
            <Pressable
              onPress={() => setSelectedCategory(cat.key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    selectedCategory === cat.key
                      ? colors.primary + '20'
                      : colors.surfaceAlt,
                  borderColor:
                    selectedCategory === cat.key
                      ? colors.primary
                      : 'transparent',
                },
              ]}
            >
              <Feather
                name={cat.icon}
                size={14}
                color={
                  selectedCategory === cat.key
                    ? colors.primary
                    : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.filterText,
                  {
                    color:
                      selectedCategory === cat.key
                        ? colors.primary
                        : colors.textSecondary,
                  },
                ]}
              >
                {cat.label}
              </Text>
            </Pressable>
          )}
          keyExtractor={(item) => item.key}
        />
      </View>

      {/* Results */}
      <FlatList
        data={filteredMemories}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather
              name="database"
              size={48}
              color={colors.textTertiary}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {searchQuery ? 'No memories found' : 'No memories yet'}
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: colors.textSecondary }]}
            >
              {searchQuery
                ? 'Try a different search term or category'
                : 'Karna will remember important things from your conversations'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: Spacing.sm,
  },
  searchInput: {
    ...Typography.input,
    flex: 1,
  },
  filterContainer: {
    marginTop: Spacing.md,
  },
  filterList: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  filterText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  list: {
    paddingVertical: Spacing.md,
  },
  memoryCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  categoryBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.full,
  },
  categoryText: {
    ...Typography.small,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  importanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  importanceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  importanceText: {
    ...Typography.small,
  },
  memoryContent: {
    ...Typography.body,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  dateText: {
    ...Typography.small,
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
});
