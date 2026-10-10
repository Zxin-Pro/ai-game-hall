import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { timeAgo, haptic } from '../../src/lib/ui';
import { usePalette } from '../../src/store/theme';
import type { Palette } from '../../src/lib/theme';

interface RoomRow {
  id: string;
  game_id: string;
  game_name: string;
  status: string;
  topic: string;
  round: number;
  phase: string;
  created_at: string;
  finished_at: string | null;
  message_count: string;
}

/** 状态色跟着当前配色走 */
const statusMap = (t: Palette): Record<string, { label: string; color: string }> => ({
  waiting:  { label: '等人开局', color: t.warm },
  running:  { label: '进行中',   color: t.online },
  voting:   { label: '投票中',   color: t.accentText },
  finished: { label: '已结束',   color: t.sub },
  archived: { label: '已归档',   color: t.faint },
});

export default function MyRooms() {
  const insets = useSafeAreaInsets();
  const t = usePalette();
  const STATUS = statusMap(t);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.myRooms();
      setRooms(res.rooms as unknown as RoomRow[]);
    } catch { /* 静默 */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const active = rooms.filter((r) => r.status === 'running' || r.status === 'voting' || r.status === 'waiting');
  const past = rooms.filter((r) => !active.includes(r));

  return (
    <View className="flex-1 bg-page" style={{ paddingTop: insets.top }}>
      <View className="px-5 pt-3 pb-4">
        <Text className="text-body text-[26px] font-bold">进行中</Text>
        <Text className="text-sub text-[12px] mt-1">
          {active.length ? `${active.length} 个房间开着` : '现在没有开着的房间'}
        </Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#9b8cff" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor="#9b8cff" />}
        >
          {active.map((r) => {
            const st = STATUS[r.status] ?? STATUS.running!;
            return (
              <Pressable
                key={r.id}
                onPress={() => { haptic.light(); router.push(`/room/${r.id}`); }}
                className="bg-panel rounded-2xl p-4 mb-3 border border-line active:opacity-80"
              >
                <View className="flex-row items-center">
                  <Text className="text-body text-[15px] font-semibold flex-1" numberOfLines={1}>
                    {r.game_name}
                  </Text>
                  <View className="px-2 py-[2px] rounded-full" style={{ backgroundColor: `${st.color}22` }}>
                    <Text style={{ color: st.color, fontSize: 10, fontWeight: '700' }}>{st.label}</Text>
                  </View>
                </View>
                <Text className="text-sub text-[12px] mt-1.5" numberOfLines={1}>
                  {r.topic || '（没写话题）'}
                </Text>
                <View className="flex-row mt-2.5">
                  <Text className="text-faint text-[11px]">第 {r.round} 轮</Text>
                  <Text className="text-faint text-[11px] ml-3">{r.message_count} 条发言</Text>
                  <View className="flex-1" />
                  <Text className="text-faint text-[11px]">{timeAgo(r.created_at)}</Text>
                </View>
              </Pressable>
            );
          })}

          {!!active.length && !!past.length && (
            <Text className="text-faint text-[11px] mt-4 mb-2 ml-1">最近结束</Text>
          )}

          {past.slice(0, 8).map((r) => (
            <Pressable
              key={r.id}
              onPress={() => { haptic.light(); router.push(`/room/${r.id}/result`); }}
              className="bg-panel rounded-2xl p-3.5 mb-2 active:opacity-80"
            >
              <View className="flex-row items-center">
                <Text className="text-body text-[14px] flex-1" numberOfLines={1}>{r.game_name}</Text>
                <Text className="text-faint text-[11px]">
                  {r.finished_at ? timeAgo(r.finished_at) : timeAgo(r.created_at)}
                </Text>
              </View>
            </Pressable>
          ))}

          {!rooms.length && (
            <View className="items-center mt-20">
              <Text className="text-faint text-[13px]">还没开过一局</Text>
              <Pressable
                onPress={() => router.replace('/(tabs)')}
                className="mt-4 bg-accent rounded-full px-5 py-2.5"
              >
                <Text className="text-onaccent text-[13px] font-semibold">去游戏厅挑一个</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
