import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { haptic, seatColor } from '../../src/lib/ui';
import type { GameDetail } from '../../src/types';

const PHASE_MODE_LABEL: Record<string, string> = {
  narration: '旁白',
  sequential: '轮流行动',
  parallel: '同时行动',
  vote: '集体投票',
  user_turn: '你来说',
};

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [game, setGame] = useState<(GameDetail & { maxRounds?: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setGame(await api.game(id) as GameDetail & { maxRounds?: number });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View className="flex-1 bg-ink-950 items-center justify-center">
        <ActivityIndicator color="#9b8cff" />
      </View>
    );
  }

  if (!game || error) {
    return (
      <View className="flex-1 bg-ink-950 items-center justify-center px-8">
        <Text className="text-danger text-[14px]">{error ?? '游戏不存在'}</Text>
        <Pressable onPress={() => router.back()} className="mt-5">
          <Text className="text-lamp text-[13px]">返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ink-950" style={{ paddingTop: insets.top }}>
      <Pressable onPress={() => router.back()} hitSlop={10} className="px-4 pt-2 pb-1 self-start">
        <Text className="text-white/50 text-[14px]">‹ 返回</Text>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}>
        <Text className="text-white text-[26px] font-bold mt-1">{game.name}</Text>
        <Text className="text-white/45 text-[13px] mt-2 leading-5">{game.description}</Text>

        <View className="flex-row mt-4 flex-wrap">
          <Chip text={`${game.minPlayers}-${game.maxPlayers} 人`} />
          <Chip text={`最多 ${game.maxRounds ?? 5} 轮`} />
          <Chip text={game.engineType} />
        </View>

        <Section title="一局怎么走">
          <View className="flex-row flex-wrap items-center">
            {game.phases.map((p, i) => (
              <View key={p.key} className="flex-row items-center mb-2">
                <View className="bg-ink-800 rounded-xl px-3 py-2 items-center">
                  <Text className="text-white/80 text-[12px] font-semibold">{p.name}</Text>
                  <Text className="text-white/30 text-[9px] mt-0.5">{PHASE_MODE_LABEL[p.mode] ?? p.mode}</Text>
                </View>
                {i < game.phases.length - 1 && <Text className="text-white/20 mx-1.5">›</Text>}
              </View>
            ))}
          </View>
        </Section>

        <Section title="场上会有这些角色">
          {game.roles.map((r, i) => (
            <View key={r.key} className="flex-row bg-ink-900 rounded-2xl p-3 mb-2">
              <View className="w-1 rounded-full mr-3" style={{ backgroundColor: seatColor(i) }} />
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text className="text-white text-[14px] font-semibold">{r.name}</Text>
                  <Text className="text-white/30 text-[11px] ml-2">×{r.count}</Text>
                </View>
                <Text className="text-white/45 text-[11px] mt-1 leading-4">{r.identity}</Text>
                <Text className="text-white/30 text-[11px] mt-1 leading-4">性格：{r.personality}</Text>
                {!!r.model && <Text className="text-lamp/50 text-[10px] mt-1">模型：{r.model}</Text>}
              </View>
            </View>
          ))}
        </Section>

        <Section title="规则">
          {game.rules.map((r, i) => (
            <View key={i} className="flex-row mb-1.5">
              <Text className="text-lamp/60 text-[12px] mr-2">·</Text>
              <Text className="text-white/55 text-[12px] flex-1 leading-4">{r}</Text>
            </View>
          ))}
        </Section>

        {!!game.topicPool?.length && (
          <Section title="不知道怎么开场？">
            {game.topicPool.map((t, i) => (
              <Text key={i} className="text-white/35 text-[12px] mb-1">· {t}</Text>
            ))}
          </Section>
        )}
      </ScrollView>

      <View className="absolute left-0 right-0 bottom-0 px-4 pb-6 pt-3 bg-ink-950/95 border-t border-white/5">
        <Pressable
          onPress={() => { haptic.medium(); router.push({ pathname: '/room/create', params: { gameId: game.id } }); }}
          className="bg-lamp rounded-2xl py-3.5 items-center"
        >
          <Text className="text-ink-950 font-bold text-[15px]">创建房间</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-7">
      <Text className="text-white/70 text-[14px] font-semibold mb-3">{title}</Text>
      {children}
    </View>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <View className="bg-ink-800 rounded-full px-3 py-1.5 mr-2 mb-2">
      <Text className="text-white/55 text-[11px]">{text}</Text>
    </View>
  );
}
