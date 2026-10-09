import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import '../global.css';
import { useAuth } from '../src/store/auth';
import { useNotifications, usePlaytimeGuard } from '../src/lib/notifications';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const boot = useAuth((s) => s.boot);
  const ready = useAuth((s) => s.ready);
  useNotifications();
  usePlaytimeGuard();

  useEffect(() => {
    boot().finally(() => { SplashScreen.hideAsync().catch(() => {}); });
  }, [boot]);

  if (!ready) {
    return (
      <View className="flex-1 bg-ink-950 items-center justify-center">
        <ActivityIndicator color="#9b8cff" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0b0912' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)/login" options={{ animation: 'fade' }} />
          <Stack.Screen name="(auth)/register" />
          <Stack.Screen name="game/[id]" />
          <Stack.Screen name="room/create" options={{ presentation: 'modal' }} />
          <Stack.Screen name="room/[id]/index" />
          <Stack.Screen name="room/[id]/result" />
          <Stack.Screen name="room/[id]/replay" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
