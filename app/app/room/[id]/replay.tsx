import { View, Text, ScrollView, Pressable, ActivityIndicator, Image } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../src/lib/api';
import { seatColor } from '../../../src/lib/ui';

interface Row {
  seq: number;
  sender_type: string;
  sender_id: string | null;
  content: string;
  round: number;
  phase: string;
  meta_json: Record<string, unknown>;
}

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [players, setPlayers] = useState<{ id: string; name: string; avatar: string | null; seat: number }[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.replay(id);
      setRows(res.timeline);
      setPlayers(res.players);
      setTitle(res.room?.game_name ?? '回放');
    } catch { /* 静默 */ } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const byId = new Map(players.map((p) => [p.id, p]));
  let lastRound = -1;

  return (
    <View className="flex-1 bg-page" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text className="text-sub text-[14px]">‹ 返回</Text>
        </Pressable>
        <Text className="text-body text-[16px] font-semibold flex-1 text-center">{title} 回放</Text>
        <View className="w-[40px]" />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#9b8cff" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {rows.map((r) => {
            const p = r.sender_id ? byId.get(r.sender_id) : null;
            const isSys = r.sender_type === 'system' || r.sender_type === 'judge';
            const roundHeader = r.round !== lastRound;
            lastRound = r.round;

            return (
              <View key={r.seq}>
                {roundHeader && (
                  <View className="items-center my-4">
                    <View className="bg-card rounded-full px-3 py-1">
                      <Text className="text-sub text-[10px]">第 {r.round} 轮</Text>
                    </View>
                  </View>
                )}

                {isSys ? (
                  <View className="items-center px-6 my-1.5">
                    <View className="bg-card rounded-full px-3 py-1 max-w-[90%]">
                      <Text className="text-sub text-[11px] text-center leading-4">{r.content}</Text>
                    </View>
                  </View>
                ) : (
                  <View className="flex-row my-1.5">
                    <Image
                      source={{ uri: p?.avatar ?? `https://api.dicebear.com/7.x/bottts/png?seed=${r.sender_id ?? 'x'}` }}
                      className="w-7 h-7 rounded-full mr-2 mt-1 bg-soft"
                    />
                    <View className="flex-1">
                      <View className="flex-row items-center mb-0.5">
                        <Text className="text-[11px] font-semibold" style={{ color: seatColor(p?.seat ?? 0) }}>
                          {p ? `${p.seat + 1}号 ${p.name}` : '有人'}
                        </Text>
                        <Text className="text-[9px] text-faint ml-2">{r.phase}</Text>
                      </View>
                      <View className="bg-panel rounded-2xl px-3 py-2">
                        <Text className="text-body text-[13px] leading-5">{r.content}</Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {!rows.length && (
            <View className="items-center mt-20">
              <Text className="text-faint text-[13px]">这局没有留下记录</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
