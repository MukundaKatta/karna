import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useAppStore } from '@/lib/store';
import { getColors, Spacing, BorderRadius } from '@/lib/theme';

export function TypingIndicator() {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  useEffect(() => {
    const animateDot = (sv: Animated.SharedValue<number>, delay: number) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 400, easing: Easing.inOut(Easing.ease) }),
            withTiming(0, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          ),
          -1,
        ),
      );
    };

    animateDot(dot1, 0);
    animateDot(dot2, 200);
    animateDot(dot3, 400);
  }, [dot1, dot2, dot3]);

  const createDotStyle = (sv: Animated.SharedValue<number>) =>
    useAnimatedStyle(() => ({
      opacity: 0.3 + sv.value * 0.7,
      transform: [{ translateY: -sv.value * 4 }],
    }));

  const dot1Style = createDotStyle(dot1);
  const dot2Style = createDotStyle(dot2);
  const dot3Style = createDotStyle(dot3);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.assistantBubble,
        },
      ]}
    >
      <Animated.View
        style={[styles.dot, { backgroundColor: colors.textSecondary }, dot1Style]}
      />
      <Animated.View
        style={[styles.dot, { backgroundColor: colors.textSecondary }, dot2Style]}
      />
      <Animated.View
        style={[styles.dot, { backgroundColor: colors.textSecondary }, dot3Style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.xs,
    borderRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
