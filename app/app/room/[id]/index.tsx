import { View, Text, FlatList, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useRoom } from '../../../src/store/room';
import { useAuth } from '../../../src/store/auth';
import { api } from '../../../src/lib/api';
import { haptic, seatColor } from '../../../src/lib/ui';
import { MessageBubble, splitQuote } from '../../../src/components/MessageBubble';
import { SeatStrip } from '../../../src/components/SeatStrip';
import { Composer } from '../../../src/components/Composer';
import { RoundDivider } from '../../../src/components/Dividers';
import type { ChatMessage } from '../../../src/types';

/** 列表项：消息 or 轮次分隔线 */
type Item =
  | { kind: 'msg'; msg: ChatMessage; seat: number }
  | { kind: 'round'; round: number; phaseName: string; key: string };

export default function RoomScreen() {
  const { id, demo: demoParam } = useLocalSearchParams<{ id: string; demo?: string }>();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Item>>(null);

  const {
    room, players, messages, uiSchema, summary, connected, waitingForMe, paused, loading, error,
    enter, leave, send, act, togglePause, myPlayerId, setMyPlayerId, demo,
  } = useRoom();

  const me = useAuth((s) => s.user);
  const [starting, setStarting] = useState(false);
  const [quoting, setQuoting] = useState<{ name: string; text: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    if (id) void enter(id, demoParam);
    return () => { void leave(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, demoParam]);

  useEffect(() => {
    const mine = players.find((p) => p.user_id === me?.id);
    setMyPlayerId(mine?.id ?? null);
  }, [players, me?.id, setMyPlayerId]);

  useEffect(() => {
    if (summary) router.push(`/room/${id}/result`);
  }, [summary, id]);

  const myPlayer = useMemo(
    () => players.find((p) => p.id === myPlayerId) ?? null,
    [players, myPlayerId],
  );

  const speakingId = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.streaming);
    return last?.senderId ?? null;
  }, [messages]);

  /** 消息流里插入轮次分隔线 */
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let lastRound = -1;
    for (const m of messages) {
      if (m.round !== lastRound) {
        lastRound = m.round;
        out.push({
          kind: 'round',
          round: m.round,
          phaseName: phaseLabel(m.phase),
          key: `round-${m.round}-${m.seq}`,
        });
      }
      out.push({
        kind: 'msg',
        msg: m,
        seat: players.find((p) => p.id === m.senderId)?.seat ?? 0,
      });
    }
    return out;
  }, [messages, players]);

  const onStart = useCallback(async () => {
    if (!id) return;
    setStarting(true);
    try {
      await api.startRoom(id);
      haptic.success();
    } catch (e) {
      Alert.alert('开局失败', e instanceof Error ? e.message : '稍后再试');
    } finally {
      setStarting(false);
    }
  }, [id]);

  /** 点一下消息 = 引用它 */
  const onPressMessage = useCallback((msg: ChatMessage) => {
    if (msg.senderType === 'system' || msg.senderType === 'judge' || msg.streaming) return;
    const { body } = splitQuote(msg.content);
    setQuoting({ name: msg.senderName, text: body.slice(0, 60) });
    haptic.light();
  }, []);

  const onLongPressMessage = useCallback((msg: ChatMessage) => {
    if (msg.streaming) return;
    haptic.medium();
    const { body } = splitQuote(msg.content);
    Alert.alert(msg.senderName, body.slice(0, 60) || '（空消息）', [
      {
        text: '复制',
        onPress: async () => { await Clipboard.setStringAsync(body); haptic.success(); },
      },
      {
        text: '引用',
        onPress: () => { setQuoting({ name: msg.senderName, text: body.slice(0, 60) }); },
      },
      {
        text: '举报',
        style: 'destructive',
        onPress: () => {
          Alert.alert('举报这条消息？', '我们会核查这条 AI 发言是否违规', [
            { text: '取消', style: 'cancel' },
            {
              text: '举报',
              style: 'destructive',
              onPress: async () => {
                try {
                  const r = await api.report(msg.id, 'other');
                  Alert.alert('已收到', r.message);
                } catch {
                  Alert.alert('举报失败', '网络不太好，稍后再试');
                }
              },
            },
          ]);
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  }, []);

  /** 长按座位头像：插话点名 */
  const onSeatPress = useCallback((p: { name: string }) => {
    setQuoting({ name: p.name, text: '（点名）' });
    haptic.light();
  }, []);

  if (loading) {
    return (
      <View className="flex-1 bg-ink-950 items-center justify-center">
        <ActivityIndicator color="#9b8cff" />
      </View>
    );
  }

  if (error || !room) {
    return (
      <View className="flex-1 bg-ink-950 items-center justify-center px-8">
        <Text className="text-danger text-[14px] text-center">{error ?? '房间不存在'}</Text>
        <Pressable onPress={() => router.back()} className="mt-5">
          <Text className="text-lamp text-[13px]">返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-ink-950"
      style={{ paddingTop: insets.top }}
    >
      {/* 顶栏 */}
      <View className="flex-row items-center px-3 py-2.5 border-b border-white/5">
        <Pressable onPress={() => router.back()} hitSlop={10} className="pr-2">
          <Text className="text-white/50 text-[16px]">‹</Text>
        </Pressable>

        <View className="flex-1">
          <View className="flex-row items-center">
            <Text className="text-white text-[15px] font-semibold" numberOfLines={1}>
              {room.game_name}
            </Text>
            <View className={`ml-2 w-1.5 h-1.5 rounded-full ${connected ? 'bg-mint' : 'bg-danger'}`} />
            {paused && <Text className="text-warm text-[10px] ml-2">已暂停</Text>}
            {demo && <Text className="text-warm text-[10px] ml-2">演示</Text>}
          </View>
          <Text className="text-white/35 text-[10px] mt-0.5" numberOfLines={1}>
            第 {room.round} 轮 · {phaseLabel(room.phase)} · {room.topic || '无话题'}
          </Text>
        </View>

        <Pressable onPress={() => void togglePause()} hitSlop={8} className="px-2">
          <Text className="text-white/50 text-[12px]">{paused ? '继续' : '暂停'}</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/room/${id}/replay`)} hitSlop={8} className="px-2">
          <Text className="text-white/50 text-[12px]">回放</Text>
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => Alert.alert('退出房间', '这局会归档，之后还能在战绩里找到', [
            { text: '取消', style: 'cancel' },
            {
              text: '退出',
              style: 'destructive',
              onPress: async () => { await leave(); router.replace('/(tabs)/rooms'); },
            },
          ])}
          className="pl-1"
        >
          <Text className="text-white/50 text-[12px]">退出</Text>
        </Pressable>
      </View>

      <SeatStrip
        players={players}
        speakingId={speakingId}
        myPlayerId={myPlayerId}
        onPress={onSeatPress}
      />

      {/* 消息流 */}
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(it) => (it.kind === 'round' ? it.key : `${it.msg.id}-${it.msg.seq}`)}
        renderItem={({ item }) =>
          item.kind === 'round' ? (
            <RoundDivider round={item.round} phaseName={item.phaseName} />
          ) : (
            <MessageBubble
              msg={item.msg}
              seat={item.seat}
              onLongPress={onLongPressMessage}
              onPress={onPressMessage}
              showMeta
              highlighted={highlight === item.msg.id}
            />
          )
        }
        contentContainerStyle={{ paddingVertical: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View className="items-center mt-20 px-10">
            <Text className="text-white/30 text-[13px] text-center leading-5">
              {room.status === 'waiting'
                ? '都坐好了，点下面的按钮开局'
                : 'AI 们正在酝酿第一句话'}
            </Text>
          </View>
        }
      />

      {/* 底部 */}
      {room.status === 'waiting' ? (
        <View className="px-4 pb-6 pt-3 border-t border-white/5">
          <Pressable
            onPress={onStart}
            disabled={starting}
            className={`rounded-2xl py-3.5 items-center ${starting ? 'bg-ink-700' : 'bg-lamp'}`}
          >
            {starting
              ? <ActivityIndicator color="#0b0912" />
              : <Text className="text-ink-950 font-bold text-[15px]">开始</Text>}
          </Pressable>
        </View>
      ) : (
        <Composer
          uiSchema={uiSchema}
          phase={room.phase}
          players={players}
          waitingForMe={waitingForMe}
          onSend={(t) => void send(t)}
          onAct={(k, p) => void act(k, p)}
          myRoleKey={myPlayer?.roleKey}
          quoting={quoting}
          onCancelQuote={() => setQuoting(null)}
        />
      )}

      {!connected && room.status !== 'waiting' && (
        <View className="absolute bottom-[104px] left-0 right-0 items-center">
          <View className="bg-ink-800 rounded-full px-3 py-1">
            <Text className="text-white/50 text-[10px]">正在重连…</Text>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    init: '准备中', night: '夜晚', day: '天亮', speak: '发言',
    vote: '投票', verdict: '判定', describe: '描述', deal: '发词',
    opening: '开庭', plaintiff: '原告陈述', defendant: '被告答辩',
    evidence: '举证', cross_examination: '交叉询问', closing: '结案陈词',
    ultimatum: '最后通牒', haggle: '拉锯', offer: '报价',
    track: '选赛道', product: '做产品', growth: '增长', funding: '融资', review: '复盘',
    meet: '初见', date: '约会', conflict: '冲突', confess: '表白', ending: '结局',
    riddle: '出题', ask: '提问', answer: '主持人回答', guess: '猜真相', reveal: '揭晓',
  };
  return map[phase] ?? phase;
}
