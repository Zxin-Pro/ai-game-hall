import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Image } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, OfflineError } from '../../src/lib/api';
import { haptic, seatColor } from '../../src/lib/ui';
import type { GameDetail } from '../../src/types';

/* ------------------------------------------------------------------ */
/* 创建房间：挑角色、写话题、选轮次                                       */
/* ------------------------------------------------------------------ */

export default function CreateRoom() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const insets = useSafeAreaInsets();

  const [game, setGame] = useState<(GameDetail & { maxRounds?: number }) | null>(null);
  const [topic, setTopic] = useState('');
  const [roundLimit, setRoundLimit] = useState(5);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [joinAsPlayer, setJoinAsPlayer] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!gameId) return;
    const g = await api.game(gameId) as GameDetail & { maxRounds?: number };
    setGame(g);
    setRoundLimit(g.maxRounds ?? 5);
    const init: Record<string, number> = {};
    for (const r of g.roles) init[r.key] = r.count;
    setSelected(init);
  }, [gameId]);

  useEffect(() => { void load(); }, [load]);

  if (!game) {
    return (
      <View className="flex-1 bg-ink-950 items-center justify-center">
        <ActivityIndicator color="#9b8cff" />
      </View>
    );
  }

  const totalSeats = Object.values(selected).reduce((a, b) => a + b, 0) + (joinAsPlayer ? 1 : 0);
  const tooFew = totalSeats < game.minPlayers;
  const tooMany = totalSeats > game.maxPlayers;

  const roleKeys: string[] = [];
  for (const [k, n] of Object.entries(selected)) for (let i = 0; i < n; i++) roleKeys.push(k);

  const create = async () => {
    if (tooFew || tooMany) return;
    setCreating(true);
    try {
      const res = await api.createRoom({
        gameId: game.id,
        topic: topic.trim() || undefined,
        roleKeys,
        joinAsPlayer,
        roundLimit,
      });
      haptic.success();
      router.replace(`/room/${res.roomId}`);
    } catch (e) {
      setCreating(false);
      // 后端连不上（或者没起）→ 直接进这个游戏的演示房
      if (e instanceof OfflineError) {
        haptic.warn();
        router.replace(`/room/demo-${game.id}?demo=${game.id}`);
        return;
      }
      Alert.alert('创建失败', e instanceof Error ? e.message : '稍后再试');
    }
  };

  return (
    <View className="flex-1 bg-ink-950" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text className="text-white/50 text-[14px]">取消</Text>
        </Pressable>
        <Text className="text-white text-[16px] font-semibold flex-1 text-center">{game.name}</Text>
        <Text className="text-white/30 text-[12px] w-[36px] text-right">{totalSeats} 人</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}>
        {/* 话题 */}
        <Text className="text-white/70 text-[14px] font-semibold mt-2 mb-2">开局话题</Text>
        <TextInput
          value={topic}
          onChangeText={setTopic}
          placeholder="不写就用系统随机抽一个"
          placeholderTextColor="rgba(255,255,255,0.25)"
          maxLength={120}
          multiline
          className="bg-ink-900 rounded-2xl px-4 py-3 text-white/85 text-[13px] min-h-[58px]"
        />
        {!!game.topicPool?.length && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
            {game.topicPool.map((t) => (
              <Pressable
                key={t}
                onPress={() => { haptic.light(); setTopic(t); }}
                className="bg-ink-800 rounded-full px-3 py-1.5 mr-2"
              >
                <Text className="text-white/50 text-[11px]">{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* 轮次 */}
        <Text className="text-white/70 text-[14px] font-semibold mt-7 mb-2">
          最多几轮（越多越贵，体验也越完整）
        </Text>
        <View className="flex-row">
          {[2, 3, 4, 5, 6, 8].filter((n) => n <= (game.maxRounds ?? 5)).map((n) => (
            <Pressable
              key={n}
              onPress={() => { haptic.light(); setRoundLimit(n); }}
              className={`rounded-xl px-4 py-2 mr-2 ${roundLimit === n ? 'bg-lamp' : 'bg-ink-800'}`}
            >
              <Text className={`text-[13px] font-semibold ${roundLimit === n ? 'text-ink-950' : 'text-white/55'}`}>
                {n} 轮
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 角色配比 */}
        <Text className="text-white/70 text-[14px] font-semibold mt-7 mb-2">AI 角色</Text>
        {game.roles.map((r, i) => (
          <View key={r.key} className="flex-row items-center bg-ink-900 rounded-2xl p-3 mb-2">
            <View className="w-1 self-stretch rounded-full mr-3" style={{ backgroundColor: seatColor(i) }} />
            <Image
              source={{ uri: r.avatar || `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(game.id + r.key)}` }}
              className="w-9 h-9 rounded-full bg-ink-700 mr-3"
            />
            <View className="flex-1">
              <Text className="text-white text-[13px] font-semibold">{r.name}</Text>
              <Text className="text-white/35 text-[11px] mt-0.5" numberOfLines={1}>
                {r.model ? `模型 ${r.model}` : '默认模型'}
              </Text>
            </View>
            <Stepper
              value={selected[r.key] ?? 0}
              max={4}
              onChange={(v) => setSelected((s) => ({ ...s, [r.key]: v }))}
            />
          </View>
        ))}

        {/* 我参战 */}
        <Pressable
          onPress={() => { haptic.light(); setJoinAsPlayer((v) => !v); }}
          className="flex-row items-center justify-between bg-ink-900 rounded-2xl px-4 py-3.5 mt-3"
        >
          <View className="flex-1">
            <Text className="text-white/80 text-[13px]">我也下场玩</Text>
            <Text className="text-white/30 text-[11px] mt-0.5">
              {game.userRole === 'player' ? '这个游戏你本来就是主角' : '不勾选就是纯围观 + 插话'}
            </Text>
          </View>
          <View className={`w-11 h-6 rounded-full ${joinAsPlayer ? 'bg-lamp' : 'bg-ink-700'} justify-center px-0.5`}>
            <View className={`w-5 h-5 rounded-full bg-white ${joinAsPlayer ? 'self-end' : 'self-start'}`} />
          </View>
        </Pressable>

        {(tooFew || tooMany) && (
          <Text className="text-danger text-[12px] mt-3">
            人数需要在 {game.minPlayers}-{game.maxPlayers} 之间，现在是 {totalSeats}
          </Text>
        )}
      </ScrollView>

      <View className="absolute left-0 right-0 bottom-0 px-4 pb-6 pt-3 bg-ink-950/95 border-t border-white/5">
        <Pressable
          onPress={create}
          disabled={creating}
          className={`rounded-2xl py-3.5 items-center ${creating ? 'bg-ink-700' : 'bg-lamp'}`}
        >
          {creating
            ? <ActivityIndicator color="#0b0912" />
            : <Text className="text-ink-950 font-bold text-[15px]">开这一局</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={() => { haptic.light(); onChange(Math.max(0, value - 1)); }}
        className="w-7 h-7 rounded-full bg-ink-700 items-center justify-center"
      >
        <Text className="text-white/60 text-[16px] leading-5">−</Text>
      </Pressable>
      <Text className="text-white/85 text-[14px] w-7 text-center">{value}</Text>
      <Pressable
        onPress={() => { haptic.light(); onChange(Math.min(max, value + 1)); }}
        className="w-7 h-7 rounded-full bg-ink-700 items-center justify-center"
      >
        <Text className="text-white/60 text-[16px] leading-5">+</Text>
      </Pressable>
    </View>
  );
}
