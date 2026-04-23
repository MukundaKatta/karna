import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { useAppStore, loadPersistedState } from '@/lib/store';
import { getColors } from '@/lib/theme';
import { gatewayClient } from '@/lib/gateway-client';
import {
  addNotificationReceivedListener,
  addNotificationResponseListener,
} from '@/lib/notifications';
import ErrorBoundary from '@/components/ErrorBoundary';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

function RootLayoutInner() {
  const darkMode = useAppStore((s) => s.darkMode);
  const url = useAppStore((s) => s.url);
  const token = useAppStore((s) => s.token);
  const colors = getColors(darkMode ? 'dark' : 'light');
  const router = useRouter();
  const notificationListenerRef = useRef<ReturnType<typeof addNotificationReceivedListener>>();
  const responseListenerRef = useRef<ReturnType<typeof addNotificationResponseListener>>();

  // Load persisted state on mount
  useEffect(() => {
    loadPersistedState();
  }, []);

  // Connect to gateway
  useEffect(() => {
    if (url) {
      gatewayClient.connect(url, token);
    }
    return () => {
      gatewayClient.disconnect();
    };
  }, [url, token]);

  // Set up notifications
  useEffect(() => {
    notificationListenerRef.current = addNotificationReceivedListener(
      (notification) => {
        console.log('[Layout] Notification received:', notification.request.identifier);
      },
    );

    responseListenerRef.current = addNotificationResponseListener(
      (response) => {
        const data = response.notification.request.content.data as
          | { tab?: string }
          | undefined;
        if (data?.tab) {
          router.push(`/(tabs)/${data.tab}` as never);
        }
      },
    );

    return () => {
      notificationListenerRef.current?.remove();
      responseListenerRef.current?.remove();
    };
  }, [router]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style={darkMode ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade',
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <RootLayoutInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
