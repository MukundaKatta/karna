import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { useAppStore } from '@/lib/store';
import { getColors } from '@/lib/theme';
import { gatewayClient } from '@/lib/gateway-client';

export default function RootLayout() {
  const darkMode = useAppStore((s) => s.darkMode);
  const url = useAppStore((s) => s.url);
  const token = useAppStore((s) => s.token);
  const colors = getColors(darkMode ? 'dark' : 'light');

  useEffect(() => {
    if (url) {
      gatewayClient.connect(url, token);
    }
    return () => {
      gatewayClient.disconnect();
    };
  }, [url, token]);

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

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
