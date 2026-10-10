import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { vars } from 'nativewind';
import * as SplashScreen from 'expo-splash-screen';
import '../global.css';
import { useAuth } from '../src/store/auth';
import { useTheme } from '../src/store/theme';
import { cssVars } from '../src/lib/theme';
import { useNotifications, usePlaytimeGuard } from '../src/lib/notifications';
import { UpdateBanner } from '../src/components/UpdateBanner';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const boot = useAuth((s) => s.boot);
  const ready = useAuth((s) => s.ready);
  const palette = useTheme((s) => s.palette);
  const bootTheme = useTheme((s) => s.boot);
  useNotifications();
  usePlaytimeGuard();

  useEffect(() => {
    void bootTheme();
    boot().finally(() => { SplashScreen.hideAsync().catch(() => {}); });
  }, [boot, bootTheme]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* ★ 配色的 CSS 变量铺在这一层，下面所有页面用的 bg-page / text-body
          这些语义色都会跟着这里的变量走，换方案整页自动变色 */}
      <View style={[{ flex: 1, backgroundColor: palette.bg }, vars(cssVars(palette))]}>
        <SafeAreaProvider>
          <StatusBar style={palette.statusBar} />
          <UpdateBanner />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.bg },
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
      </View>
    </GestureHandlerRootView>
  );
}
