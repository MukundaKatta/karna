export const Colors = {
  light: {
    background: '#FFFFFF',
    surface: '#F8F9FA',
    surfaceAlt: '#F0F1F3',
    text: '#1A1A2E',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    primary: '#6366F1',
    primaryLight: '#A5B4FC',
    primaryDark: '#4F46E5',
    accent: '#8B5CF6',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    border: '#E5E7EB',
    borderLight: '#F3F4F6',
    userBubble: '#6366F1',
    userBubbleText: '#FFFFFF',
    assistantBubble: '#F3F4F6',
    assistantBubbleText: '#1A1A2E',
    inputBackground: '#F9FAFB',
    overlay: 'rgba(0, 0, 0, 0.5)',
    card: '#FFFFFF',
    tabBar: '#FFFFFF',
    tabBarBorder: '#E5E7EB',
    activeTab: '#6366F1',
    inactiveTab: '#9CA3AF',
  },
  dark: {
    background: '#0A0A0F',
    surface: '#1A1A2E',
    surfaceAlt: '#252540',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    textTertiary: '#6B7280',
    primary: '#818CF8',
    primaryLight: '#A5B4FC',
    primaryDark: '#6366F1',
    accent: '#A78BFA',
    success: '#34D399',
    warning: '#FBBF24',
    error: '#F87171',
    border: '#2D2D44',
    borderLight: '#1F1F35',
    userBubble: '#6366F1',
    userBubbleText: '#FFFFFF',
    assistantBubble: '#1A1A2E',
    assistantBubbleText: '#F9FAFB',
    inputBackground: '#1A1A2E',
    overlay: 'rgba(0, 0, 0, 0.7)',
    card: '#1A1A2E',
    tabBar: '#0F0F1A',
    tabBarBorder: '#2D2D44',
    activeTab: '#818CF8',
    inactiveTab: '#6B7280',
  },
} as const;

export const Typography = {
  title: {
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodyBold: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
  },
  captionBold: {
    fontSize: 13,
    fontWeight: '600' as const,
    lineHeight: 18,
  },
  small: {
    fontSize: 11,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  input: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  code: {
    fontSize: 14,
    fontWeight: '400' as const,
    fontFamily: 'monospace' as const,
  },
} as const;

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 48,
} as const;

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export type ThemeMode = 'light' | 'dark';
export type ThemeColors = typeof Colors.light | typeof Colors.dark;

export function getColors(mode: ThemeMode) {
  return Colors[mode];
}
