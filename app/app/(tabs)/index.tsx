import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { haptic } from '../../src/lib/ui';
import type { GameCard } from '../../src/types';

const ENGINE_LABEL: Record<string, string> = {
  hidden_role: '身份推理',
  group_chat: '自由群聊',
  debate: '唇枪舌战',
  negotiation: '利益博弈',
  simulation: '模拟经营',
};

const ENGINE_COLOR: Record<string, string> = {
  hidden_role: '#9b8cff',
  group_chat: '#ff8fb1',
  debate: '#5fd0f5',
  negotiation: '#ffc46b',
  simulation: '#5ee0a8',
};

export default function GameHall() {
  const insets = useSafeAreaInsets();
  const [games, setGames] = useState<GameCard[]>([]);
  const [stats, setStats] = useState<{ rooms: string; messages: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([api.games(), api.stats().catch(() => null)]);
      setGames(g.games);
      if (s) setStats({ rooms: s.rooms, messages: s.messages });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View className="flex-1 bg-ink-950" style={{ paddingTop: insets.top }}>
      <View className="px-5 pt-3 pb-4">
        <Text className="text-white text-[26px] font-bold">游戏厅</Text>
        <Text className="text-white/35 text-[12px] mt-1">
          {stats ? `已经开了 ${stats.rooms} 局 · ${stats.messages} 条发言` : '一群 AI 围一桌，你负责看戏'}
        </Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#9b8cff" /></View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor="#9b8cff"
            />
          }
        >
          {!!error && (
            <View className="bg-danger/15 rounded-2xl px-4 py-3 mb-3">
              <Text className="text-danger text-[13px]">{error}</Text>
              <Pressable onPress={() => void load()} className="mt-2">
                <Text className="text-white/70 text-[12px] underline">重试</Text>
              </Pressable>
            </View>
          )}

          {games.map((g) => {
            const color = ENGINE_COLOR[g.engineType] ?? '#9b8cff';
            return (
              <Pressable
                key={g.id}
                onPress={() => { haptic.light(); router.push(`/game/${g.id}`); }}
                className="bg-ink-900 rounded-3xl p-4 mb-3 border border-white/5 active:opacity-80"
              >
                <View className="flex-row items-start">
                  <View
                    className="w-12 h-12 rounded-2xl items-center justify-center"
                    style={{ backgroundColor: `${color}22` }}
                  >
                    <Text style={{ color, fontSize: 20 }}>
                      {g.name.includes('狼') ? '🐺'
                        : g.name.includes('卧底') ? '🕵️'
                          : g.name.includes('恋爱') ? '💗'
                            : g.name.includes('海龟') ? '🐢'
                              : g.name.includes('法庭') ? '⚖️'
                                : g.name.includes('谈判') ? '🤝' : '🚀'}
                    </Text>
                  </View>

                  <View className="flex-1 ml-3">
                    <View className="flex-row items-center">
                      <Text className="text-white text-[16px] font-semibold">{g.name}</Text>
                      <View className="ml-2 px-1.5 py-[1px] rounded" style={{ backgroundColor: `${color}22` }}>
                        <Text style={{ color, fontSize: 9, fontWeight: '700' }}>
                          {ENGINE_LABEL[g.engineType] ?? g.engineType}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-white/45 text-[12px] mt-1 leading-4" numberOfLines={2}>
                      {g.description}
                    </Text>

                    <View className="flex-row items-center mt-3">
                      <Text className="text-white/30 text-[11px]">
                        {g.minPlayers}-{g.maxPlayers} 人 · 最多 {g.roundLimit} 轮
                      </Text>
                      <View className="flex-1" />
                      <View className="flex-row">
                        {g.roles.slice(0, 5).map((r, i) => (
                          <Image
                            key={r.key}
                            source={{ uri: r.avatar || `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(g.id + r.key)}` }}
                            className="w-5 h-5 rounded-full bg-ink-700"
                            style={{ marginLeft: i === 0 ? 0 : -6 }}
                          />
                        ))}
                      </View>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })}

          {!games.length && !error && (
            <View className="items-center mt-16">
              <Text className="text-white/30 text-[13px]">还没有游戏配置</Text>
              <Text className="text-white/20 text-[11px] mt-2">后端跑一次 npm run seed:games 就有了</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
