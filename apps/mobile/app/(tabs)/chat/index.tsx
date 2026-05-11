import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  type ListRenderItemInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Network from "expo-network";
import { useAppStore, type ChatMessage } from "@/lib/store";
import { gatewayClient } from "@/lib/gateway-client";
import type { MobileWebRTCState } from "@/lib/webrtc";
import {
  formatNetworkType,
  type MobileNetworkType,
} from "@/lib/connection-quality";
import { getColors, Typography, Spacing, BorderRadius } from "@/lib/theme";
import { ChatBubble } from "@/components/ChatBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import { VoiceInput } from "@/components/VoiceInput";
import { ToolApprovalModal } from "@/components/ToolApprovalModal";
import { playHaptic } from "@/lib/haptics";

function mapExpoNetworkType(
  type: unknown,
  isConnected: boolean,
): MobileNetworkType {
  if (!isConnected) return "offline";

  const normalized = String(type).toLowerCase();
  if (normalized.includes("wifi")) return "wifi";
  if (normalized.includes("cellular")) return "cellular";
  if (normalized.includes("none")) return "offline";
  return "unknown";
}

export default function ChatScreen() {
  const darkMode = useAppStore((s) => s.darkMode);
  const messages = useAppStore((s) => s.messages);
  const inputText = useAppStore((s) => s.chatDraft);
  const setInputText = useAppStore((s) => s.setChatDraft);
  const isTyping = useAppStore((s) => s.isTyping);
  const connectionStatus = useAppStore((s) => s.status);
  const connectionQuality = useAppStore((s) => s.connectionQuality);
  const setNetworkType = useAppStore((s) => s.setNetworkType);
  const colors = getColors(darkMode ? "dark" : "light");

  const [liveVoiceState, setLiveVoiceState] =
    useState<MobileWebRTCState>("idle");
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshNetworkType(): Promise<void> {
      try {
        const state = await Network.getNetworkStateAsync();
        if (cancelled) return;

        setNetworkType(
          mapExpoNetworkType(state.type, Boolean(state.isConnected)),
        );
      } catch {
        if (!cancelled) {
          setNetworkType("unknown");
        }
      }
    }

    void refreshNetworkType();
    const interval = setInterval(() => {
      void refreshNetworkType();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setNetworkType]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;

    await playHaptic("messageSent");
    setInputText("");
    gatewayClient.sendChatMessage(text);
  }, [inputText]);

  const handleRefresh = useCallback(() => {
    void gatewayClient.loadChatHistory(20);
  }, []);

  const renderMessage = useCallback(
    ({ item }: ListRenderItemInfo<ChatMessage>) => (
      <ChatBubble message={item} />
    ),
    [],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const statusColor =
    connectionStatus === "connected"
      ? colors.success
      : connectionStatus === "connecting"
        ? colors.warning
        : colors.error;

  const statusLabel =
    connectionStatus === "connected"
      ? "Connected"
      : connectionStatus === "connecting"
        ? "Connecting..."
        : connectionStatus === "error"
          ? "Connection Error"
          : "Disconnected";
  const qualityColor =
    connectionQuality.networkType === "offline"
      ? colors.error
      : connectionQuality.level === "good"
        ? colors.success
        : connectionQuality.level === "slow"
          ? colors.warning
          : connectionQuality.level === "poor"
            ? colors.error
            : colors.textTertiary;
  const latencyLabel =
    connectionQuality.latencyMs === null
      ? "Latency unknown"
      : `${Math.round(connectionQuality.latencyMs)} ms`;
  const reconnectLabel =
    connectionQuality.reconnectAttempts > 0
      ? ` · reconnect ${connectionQuality.reconnectAttempts}`
      : "";
  const qualityLabel = `${formatNetworkType(
    connectionQuality.networkType,
  )} · ${latencyLabel}${reconnectLabel}`;
  const showSlowWarning =
    connectionQuality.networkType === "offline" ||
    connectionQuality.level === "slow" ||
    connectionQuality.level === "poor" ||
    connectionQuality.reconnectAttempts > 0;
  const showLiveVoiceBanner =
    liveVoiceState === "requesting-media" ||
    liveVoiceState === "negotiating" ||
    liveVoiceState === "connected" ||
    liveVoiceState === "error";
  const liveVoiceBannerColor =
    liveVoiceState === "connected"
      ? colors.success
      : liveVoiceState === "error"
        ? colors.error
        : colors.warning;
  const liveVoiceBannerLabel =
    liveVoiceState === "connected"
      ? "Live voice active"
      : liveVoiceState === "error"
        ? "Live voice unavailable on this build"
        : "Connecting live voice...";

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <View
        style={[
          styles.qualityBar,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.qualityItem}>
          <View
            style={[styles.statusDot, { backgroundColor: qualityColor }]}
          />
          <Text style={[styles.qualityText, { color: colors.text }]}>
            {qualityLabel}
          </Text>
        </View>
      </View>

      {/* Connection Status Bar */}
      {connectionStatus !== "connected" && (
        <View
          style={[styles.statusBar, { backgroundColor: statusColor + "20" }]}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {statusLabel}
          </Text>
        </View>
      )}

      {showSlowWarning && (
        <View
          style={[
            styles.statusBar,
            {
              backgroundColor:
                connectionQuality.networkType === "offline"
                  ? colors.error + "20"
                  : colors.warning + "20",
            },
          ]}
        >
          <Feather
            name="zap-off"
            size={14}
            color={
              connectionQuality.networkType === "offline"
                ? colors.error
                : colors.warning
            }
          />
          <Text
            style={[
              styles.statusText,
              {
                color:
                  connectionQuality.networkType === "offline"
                    ? colors.error
                    : colors.warning,
              },
            ]}
          >
            {connectionQuality.networkType === "offline"
              ? "Offline"
              : connectionQuality.compactMode
                ? "Slow connection - compact mode enabled"
                : "Slow connection"}
          </Text>
        </View>
      )}

      {showLiveVoiceBanner && (
        <View
          style={[
            styles.statusBar,
            { backgroundColor: liveVoiceBannerColor + "20" },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: liveVoiceBannerColor },
            ]}
          />
          <Text style={[styles.statusText, { color: liveVoiceBannerColor }]}>
            {liveVoiceBannerLabel}
          </Text>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={keyExtractor}
        inverted
        contentContainerStyle={styles.messageList}
        onEndReached={handleRefresh}
        onEndReachedThreshold={0.1}
        ListHeaderComponent={isTyping ? <TypingIndicator /> : null}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather
              name="message-circle"
              size={48}
              color={colors.textTertiary}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              Welcome to Karna
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: colors.textSecondary }]}
            >
              Start a conversation with your AI assistant
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Input Area */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View
          style={[
            styles.inputRow,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
            },
          ]}
        >
          <TextInput
            style={[styles.textInput, { color: colors.text }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Message Karna..."
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={4000}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />

          {inputText.trim() ? (
            <Pressable
              onPress={handleSend}
              style={[styles.sendButton, { backgroundColor: colors.primary }]}
            >
              <Feather name="send" size={18} color="#FFFFFF" />
            </Pressable>
          ) : (
            <VoiceInput onLiveStateChange={setLiveVoiceState} />
          )}
        </View>
      </View>
      <ToolApprovalModal />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  qualityBar: {
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  qualityItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  qualityText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  messageList: {
    paddingVertical: Spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 120,
    transform: [{ scaleY: -1 }],
  },
  emptyTitle: {
    ...Typography.subtitle,
    marginTop: Spacing.lg,
  },
  emptySubtitle: {
    ...Typography.body,
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  inputContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    minHeight: 48,
  },
  textInput: {
    ...Typography.input,
    flex: 1,
    maxHeight: 120,
    paddingTop: Platform.OS === "ios" ? 8 : 4,
    paddingBottom: Platform.OS === "ios" ? 8 : 4,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
