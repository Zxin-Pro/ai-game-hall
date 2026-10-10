import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePalette } from '../../src/store/theme';

/* ------------------------------------------------------------------ */
/* 底部四个 Tab（配色跟着主题走）                                        */
/* ------------------------------------------------------------------ */

export default function TabsLayout() {
  const t = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: t.panel,
          borderTopColor: t.line,
          height: 58,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.faint,
        tabBarLabelStyle: { fontSize: 10 },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '游戏厅',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="rooms"
        options={{
          title: '进行中',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: '战绩',
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy-outline" color={color} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: '我的',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size - 2} />,
        }}
      />
    </Tabs>
  );
}
