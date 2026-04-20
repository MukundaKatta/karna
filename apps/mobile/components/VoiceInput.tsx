import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { startRecording, stopRecording, getRecordingStatus } from '@/lib/voice';
import { gatewayClient } from '@/lib/gateway-client';
import { useAppStore } from '@/lib/store';
import { getColors, Spacing, BorderRadius } from '@/lib/theme';

export function VoiceInput() {
  const darkMode = useAppStore((s) => s.darkMode);
  const colors = getColors(darkMode ? 'dark' : 'light');
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const levelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pulseScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);
  const ringScale = useSharedValue(1);

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const ringAnimatedStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));

  const startPulse = useCallback(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.0, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    ringOpacity.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 800 }),
        withTiming(0, { duration: 800 }),
      ),
      -1,
    );
    ringScale.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(2, { duration: 1600 }),
      ),
      -1,
    );
  }, [pulseScale, ringOpacity, ringScale]);

  const stopPulse = useCallback(() => {
    cancelAnimation(pulseScale);
    cancelAnimation(ringOpacity);
    cancelAnimation(ringScale);
    pulseScale.value = withSpring(1);
    ringOpacity.value = withTiming(0, { duration: 200 });
  }, [pulseScale, ringOpacity, ringScale]);

  useEffect(() => {
    return () => {
      if (levelPollRef.current) {
        clearInterval(levelPollRef.current);
      }
    };
  }, []);

  const handlePressIn = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const started = await startRecording();
    if (started) {
      setRecording(true);
      startPulse();

      levelPollRef.current = setInterval(async () => {
        const status = await getRecordingStatus();
        if (status && 'metering' in status && typeof status.metering === 'number') {
          const normalized = Math.max(0, Math.min(1, (status.metering + 60) / 60));
          setAudioLevel(normalized);
        }
      }, 100);
    }
  }, [startPulse]);

  const handlePressOut = useCallback(async () => {
    if (!recording) return;

    if (levelPollRef.current) {
      clearInterval(levelPollRef.current);
      levelPollRef.current = null;
    }

    stopPulse();
    setRecording(false);
    setAudioLevel(0);

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const uri = await stopRecording();
    if (uri) {
      gatewayClient.sendVoiceMessage(uri).catch((err) => {
        console.warn('[VoiceInput] Failed to send voice message:', err);
      });
    }
  }, [recording, stopPulse]);

  const levelBarWidth = `${Math.round(audioLevel * 100)}%` as const;

  return (
    <View style={styles.container}>
      <View style={styles.buttonWrapper}>
        <Animated.View
          style={[
            styles.ring,
            { borderColor: colors.primary },
            ringAnimatedStyle,
          ]}
        />
        <Animated.View style={pulseAnimatedStyle}>
          <Pressable
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[
              styles.button,
              {
                backgroundColor: recording
                  ? colors.error
                  : colors.primary,
              },
            ]}
          >
            <Feather
              name={recording ? 'mic' : 'mic'}
              size={22}
              color="#FFFFFF"
            />
          </Pressable>
        </Animated.View>
      </View>

      {recording && (
        <View style={styles.levelContainer}>
          <View
            style={[
              styles.levelTrack,
              { backgroundColor: colors.surfaceAlt },
            ]}
          >
            <View
              style={[
                styles.levelFill,
                {
                  backgroundColor: colors.error,
                  width: levelBarWidth,
                },
              ]}
            />
          </View>
          <Text style={[styles.recordingLabel, { color: colors.error }]}>
            Recording...
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  buttonWrapper: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelContainer: {
    alignItems: 'center',
    marginTop: Spacing.sm,
    width: '100%',
  },
  levelTrack: {
    height: 3,
    width: 80,
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
  },
  levelFill: {
    height: '100%',
    borderRadius: BorderRadius.full,
  },
  recordingLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
});
