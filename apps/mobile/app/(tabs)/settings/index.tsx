import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppStore } from '@/lib/store';
import { gatewayClient } from '@/lib/gateway-client';
import { getColors, Typography, Spacing, BorderRadius } from '@/lib/theme';

export default function SettingsScreen() {
  const darkMode = useAppStore((s) => s.darkMode);
  const setDarkMode = useAppStore((s) => s.setDarkMode);
  const notifications = useAppStore((s) => s.notifications);
  const setNotifications = useAppStore((s) => s.setNotifications);
  const agentName = useAppStore((s) => s.agentName);
  const setAgentName = useAppStore((s) => s.setAgentName);
  const url = useAppStore((s) => s.url);
  const setUrl = useAppStore((s) => s.setUrl);
  const token = useAppStore((s) => s.token);
  const setToken = useAppStore((s) => s.setToken);
  const liveVoiceEnabled = useAppStore((s) => s.liveVoiceEnabled);
  const setLiveVoiceEnabled = useAppStore((s) => s.setLiveVoiceEnabled);
  const liveVoicePeerChannelId = useAppStore((s) => s.liveVoicePeerChannelId);
  const setLiveVoicePeerChannelId = useAppStore(
    (s) => s.setLiveVoicePeerChannelId,
  );
  const connectionStatus = useAppStore((s) => s.status);
  const clearChat = useAppStore((s) => s.clearChat);
  const colors = getColors(darkMode ? 'dark' : 'light');

  const [editingUrl, setEditingUrl] = useState(url);
  const [editingToken, setEditingToken] = useState(token);
  const [editingLiveVoicePeerChannelId, setEditingLiveVoicePeerChannelId] =
    useState(liveVoicePeerChannelId);

  const handleSaveConnection = useCallback(() => {
    setUrl(editingUrl);
    setToken(editingToken);
    gatewayClient.disconnect();
    gatewayClient.connect(editingUrl, editingToken);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [editingUrl, editingToken, setUrl, setToken]);

  const handleClearChat = useCallback(() => {
    Alert.alert(
      'Clear Conversation',
      'This will remove all messages from the current session. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearChat();
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
          },
        },
      ],
    );
  }, [clearChat]);

  const handleReconnect = useCallback(() => {
    gatewayClient.disconnect();
    gatewayClient.connect(url, token);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [url, token]);

  const statusColor =
    connectionStatus === 'connected'
      ? colors.success
      : connectionStatus === 'connecting'
        ? colors.warning
        : colors.error;

  const statusLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting'
        ? 'Connecting...'
        : connectionStatus === 'error'
          ? 'Error'
          : 'Disconnected';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Gateway Connection */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Gateway Connection
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {/* Connection Status */}
          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Feather name="wifi" size={18} color={colors.textSecondary} />
              <Text style={[styles.label, { color: colors.text }]}>
                Status
              </Text>
            </View>
            <View style={styles.statusRow}>
              <View
                style={[styles.statusDot, { backgroundColor: statusColor }]}
              />
              <Text style={[styles.statusLabel, { color: statusColor }]}>
                {statusLabel}
              </Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Gateway URL */}
          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              URL
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                },
              ]}
              value={editingUrl}
              onChangeText={setEditingUrl}
              placeholder="ws://localhost:3100"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          {/* Token */}
          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Token
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                },
              ]}
              value={editingToken}
              onChangeText={setEditingToken}
              placeholder="Optional auth token"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </View>

          {/* Actions */}
          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleSaveConnection}
              style={[styles.button, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.buttonText}>Save & Connect</Text>
            </Pressable>
            <Pressable
              onPress={handleReconnect}
              style={[
                styles.button,
                styles.outlineButton,
                { borderColor: colors.border },
              ]}
            >
              <Feather name="refresh-cw" size={16} color={colors.text} />
              <Text style={[styles.outlineButtonText, { color: colors.text }]}>
                Reconnect
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Agent */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Agent
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Agent Name
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                },
              ]}
              value={agentName}
              onChangeText={setAgentName}
              placeholder="Karna"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>
      </View>

      {/* Live Voice Beta */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Live Voice Beta
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Feather name="radio" size={18} color={colors.textSecondary} />
              <View>
                <Text style={[styles.label, { color: colors.text }]}>
                  Enable Live Voice
                </Text>
                <Text
                  style={[
                    styles.helpText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Use WebRTC signaling for low-latency voice sessions.
                </Text>
              </View>
            </View>
            <Switch
              value={liveVoiceEnabled}
              onValueChange={(val) => {
                setLiveVoiceEnabled(val);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              trackColor={{
                false: colors.surfaceAlt,
                true: colors.primary + '60',
              }}
              thumbColor={liveVoiceEnabled ? colors.primary : colors.textTertiary}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.inputRow}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
              Peer Channel ID
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                },
              ]}
              value={editingLiveVoicePeerChannelId}
              onChangeText={(value) => {
                setEditingLiveVoicePeerChannelId(value);
                setLiveVoicePeerChannelId(value);
              }}
              placeholder="web-voice-peer"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.helpText, { color: colors.textSecondary }]}>
              Set the target peer channel the mobile app should call during live
              voice sessions.
            </Text>
          </View>
        </View>
      </View>

      {/* Preferences */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Preferences
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Feather name="moon" size={18} color={colors.textSecondary} />
              <Text style={[styles.label, { color: colors.text }]}>
                Dark Mode
              </Text>
            </View>
            <Switch
              value={darkMode}
              onValueChange={(val) => {
                setDarkMode(val);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              trackColor={{
                false: colors.surfaceAlt,
                true: colors.primary + '60',
              }}
              thumbColor={darkMode ? colors.primary : colors.textTertiary}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Feather name="bell" size={18} color={colors.textSecondary} />
              <Text style={[styles.label, { color: colors.text }]}>
                Notifications
              </Text>
            </View>
            <Switch
              value={notifications}
              onValueChange={(val) => {
                setNotifications(val);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              trackColor={{
                false: colors.surfaceAlt,
                true: colors.primary + '60',
              }}
              thumbColor={
                notifications ? colors.primary : colors.textTertiary
              }
            />
          </View>
        </View>
      </View>

      {/* Danger Zone */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          Data
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Pressable onPress={handleClearChat} style={styles.row}>
            <View style={styles.rowLabel}>
              <Feather name="trash-2" size={18} color={colors.error} />
              <Text style={[styles.label, { color: colors.error }]}>
                Clear Conversation
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={colors.textTertiary}
            />
          </Pressable>
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          About
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.text }]}>
              Version
            </Text>
            <Text style={[styles.value, { color: colors.textSecondary }]}>
              0.1.0
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.text }]}>
              Build
            </Text>
            <Text style={[styles.value, { color: colors.textSecondary }]}>
              Expo SDK 52
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textTertiary }]}>
          Karna AI Assistant
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing.xxxxl,
  },
  section: {
    marginTop: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.captionBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  card: {
    marginHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 50,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  label: {
    ...Typography.body,
  },
  value: {
    ...Typography.body,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    ...Typography.caption,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.lg,
  },
  inputRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  inputLabel: {
    ...Typography.caption,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  helpText: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  input: {
    ...Typography.input,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  buttonText: {
    color: '#FFFFFF',
    ...Typography.bodyBold,
    fontSize: 14,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  outlineButtonText: {
    ...Typography.bodyBold,
    fontSize: 14,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  footerText: {
    ...Typography.caption,
  },
});
