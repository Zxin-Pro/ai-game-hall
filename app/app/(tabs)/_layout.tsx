import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/* ------------------------------------------------------------------ */
/* 底部四个 Tab                                                         */
/* ------------------------------------------------------------------ */

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#141021',
          borderTopColor: 'rgba(255,255,255,0.07)',
          height: 58,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#9b8cff',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
        tabBarLabelStyle: { fontSize: 10 },
        sceneStyle: { backgroundColor: '#0b0912' },
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
