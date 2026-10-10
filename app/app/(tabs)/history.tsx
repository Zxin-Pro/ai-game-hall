import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { timeAgo, haptic } from '../../src/lib/ui';
import type { HistoryItem } from '../../src/types';

export default function History() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.history();
      setItems(res.items);
    } catch { /* 静默 */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View className="flex-1 bg-page" style={{ paddingTop: insets.top }}>
      <View className="px-5 pt-3 pb-4">
        <Text className="text-body text-[26px] font-bold">战绩</Text>
        <Text className="text-sub text-[12px] mt-1">
          {items.length ? `${items.length} 局记录，点开看复盘` : '打完的局都会留在这里'}
        </Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#9b8cff" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor="#9b8cff" />}
        >
          {items.map((h) => {
            const card = h.result_json;
            const won = card?.winner ?? '—';
            return (
              <Pressable
                key={h.id}
                onPress={() => { haptic.light(); router.push(`/room/${h.id}/result`); }}
                className="bg-panel rounded-3xl p-4 mb-3 border border-line active:opacity-80"
              >
                <View className="flex-row items-center">
                  <Text className="text-body text-[15px] font-semibold flex-1" numberOfLines={1}>
                    {h.game_name}
                  </Text>
                  <Text className="text-faint text-[11px]">
                    {h.finished_at ? timeAgo(h.finished_at) : ''}
                  </Text>
                </View>

                <Text className="text-accenttext text-[13px] mt-2 font-semibold" numberOfLines={1}>{won}</Text>

                {!!card?.highlights?.[0] && (
                  <Text className="text-sub text-[12px] mt-1.5 leading-4" numberOfLines={2}>
                    {card.highlights[0]}
                  </Text>
                )}

                <View className="flex-row mt-3">
                  <Text className="text-faint text-[11px]">第 {h.round} 轮</Text>
                  {!!card?.stats?.length && (
                    <Text className="text-faint text-[11px] ml-3" numberOfLines={1}>
                      {card.stats.slice(0, 2).map((s) => `${s.label} ${s.value}`).join(' · ')}
                    </Text>
                  )}
                  <View className="flex-1" />
                  <Text className="text-accenttext text-[11px]">看复盘 ›</Text>
                </View>
              </Pressable>
            );
          })}

          {!items.length && (
            <View className="items-center mt-20">
              <Text className="text-faint text-[13px]">还没有战绩</Text>
              <Text className="text-faint text-[11px] mt-2">先去打一局吧</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
