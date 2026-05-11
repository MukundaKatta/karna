import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Animated, Image, StyleSheet } from 'react-native';
import { useAppStore, loadPersistedState, type Reminder } from '@/lib/store';
import { getMobileTabRoute, parseMobileDeepLink } from '@/lib/deep-links';
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

const MIN_LAUNCH_SCREEN_MS = 1200;
const LAUNCH_FADE_MS = 300;

void SplashScreen.preventAutoHideAsync();

function RootLayoutInner() {
  const darkMode = useAppStore((s) => s.darkMode);
  const url = useAppStore((s) => s.url);
  const token = useAppStore((s) => s.token);
  const setUrl = useAppStore((s) => s.setUrl);
  const setToken = useAppStore((s) => s.setToken);
  const setLiveVoiceEnabled = useAppStore((s) => s.setLiveVoiceEnabled);
  const setChatDraft = useAppStore((s) => s.setChatDraft);
  const addReminder = useAppStore((s) => s.addReminder);
  const setMemorySearchQuery = useAppStore((s) => s.setMemorySearchQuery);
  const setAuthCallbackCode = useAppStore((s) => s.setAuthCallbackCode);
  const colors = getColors(darkMode ? 'dark' : 'light');
  const router = useRouter();
  const notificationListenerRef = useRef<ReturnType<typeof addNotificationReceivedListener>>();
  const responseListenerRef = useRef<ReturnType<typeof addNotificationResponseListener>>();
  const startedAtRef = useRef(Date.now());
  const launchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchOpacityRef = useRef(new Animated.Value(1));
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [connectionAttempted, setConnectionAttempted] = useState(false);
  const [showLaunchScreen, setShowLaunchScreen] = useState(true);

  const applyDeepLink = useCallback(
    (incomingUrl: string | null | undefined) => {
      const action = parseMobileDeepLink(incomingUrl);
      if (!action) return;

      if (action.gatewayUrl) {
        setUrl(action.gatewayUrl);
      }
      if (action.token !== undefined) {
        setToken(action.token);
      }
      if (action.liveVoiceEnabled !== undefined) {
        setLiveVoiceEnabled(action.liveVoiceEnabled);
      }
      if (action.chatDraft !== undefined) {
        setChatDraft(action.chatDraft);
      }
      if (action.newTaskTitle !== undefined && action.newTaskTitle.trim()) {
        const reminder: Reminder = {
          id: `deeplink-${Date.now()}`,
          title: action.newTaskTitle.trim(),
          description: action.newTaskDescription?.trim() || undefined,
          status: 'pending',
          createdAt: Date.now(),
        };
        addReminder(reminder);
      }
      if (action.memorySearchQuery !== undefined) {
        setMemorySearchQuery(action.memorySearchQuery);
      }
      if (action.authCode !== undefined) {
        setAuthCallbackCode(action.authCode);
      }
      if (action.route) {
        router.push(action.route as never);
      }
    },
    [
      addReminder,
      router,
      setAuthCallbackCode,
      setChatDraft,
      setLiveVoiceEnabled,
      setMemorySearchQuery,
      setToken,
      setUrl,
    ],
  );

  // Load persisted state and honor the first deep link before connecting.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await loadPersistedState();
        const initialUrl = await Linking.getInitialURL();
        if (!cancelled) {
          applyDeepLink(initialUrl);
        }
      } finally {
        if (cancelled) return;

        setIsBootstrapped(true);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
      if (launchTimerRef.current) {
        clearTimeout(launchTimerRef.current);
      }
    };
  }, [applyDeepLink]);

  // Connect to gateway
  useEffect(() => {
    if (!isBootstrapped) return;

    if (url) {
      gatewayClient.connect(url, token);
    }
    setConnectionAttempted(true);
    return () => {
      gatewayClient.disconnect();
    };
  }, [isBootstrapped, url, token]);

  useEffect(() => {
    if (!isBootstrapped || !connectionAttempted || !showLaunchScreen) return;

    const remainingMs = Math.max(
      0,
      MIN_LAUNCH_SCREEN_MS - (Date.now() - startedAtRef.current),
    );

    launchTimerRef.current = setTimeout(() => {
      void SplashScreen.hideAsync();
      Animated.timing(launchOpacityRef.current, {
        toValue: 0,
        duration: LAUNCH_FADE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShowLaunchScreen(false);
      });
    }, remainingMs);

    return () => {
      if (launchTimerRef.current) {
        clearTimeout(launchTimerRef.current);
      }
    };
  }, [connectionAttempted, isBootstrapped, showLaunchScreen]);

  // Set up deep links while the app is already open
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url: incomingUrl }) => {
      applyDeepLink(incomingUrl);
    });

    return () => {
      subscription.remove();
    };
  }, [applyDeepLink]);

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
        const route = getMobileTabRoute(data?.tab);
        if (route) {
          router.push(route as never);
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
        {showLaunchScreen && (
          <Animated.View
            pointerEvents="auto"
            style={[
              styles.launchOverlay,
              { backgroundColor: colors.background },
              { opacity: launchOpacityRef.current },
            ]}
          >
            <Image
              source={require('../assets/splash.png')}
              style={styles.launchImage}
              resizeMode="contain"
            />
          </Animated.View>
        )}
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
  launchOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  launchImage: {
    width: 220,
    height: 220,
  },
});
