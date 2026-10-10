import { View, Text, Pressable, TextInput, ScrollView, Image } from 'react-native';
import { useState } from 'react';
import { haptic } from '../lib/ui';
import { usePalette } from '../store/theme';
import type { RoomPlayer, UiAction, UiSchema } from '../types';

/* ------------------------------------------------------------------ */
/* Composer：底部动态操作栏                                              */
/*  完全由 ui_schema 驱动：狼人杀显示技能，谈判显示出价，恋爱只要输入框      */
/* ------------------------------------------------------------------ */

const EMOJI = ['😀', '😅', '🤔', '😏', '🙃', '😭', '👀', '🔥', '✨', '💀', '🤝', '💗'];

interface Props {
  uiSchema: UiSchema | null;
  phase: string;
  players: RoomPlayer[];
  waitingForMe: boolean;
  onSend: (text: string) => void;
  onAct: (kind: string, payload?: { targetId?: string; text?: string; amount?: number; option?: string }) => void;
  myRoleKey?: string;
  /** 正在引用的消息 */
  quoting?: { name: string; text: string } | null;
  onCancelQuote?: () => void;
}

export function Composer({
  uiSchema, phase, players, waitingForMe, onSend, onAct, myRoleKey,
  quoting, onCancelQuote,
}: Props) {
  const t = usePalette();
  const [text, setText] = useState('');
  const [picking, setPicking] = useState<UiAction | null>(null);
  const [amount, setAmount] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);

  const actions = (uiSchema?.actions ?? []).filter((a) => {
    if (a.when?.phase && !a.when.phase.includes(phase)) return false;
    if (a.when?.onlyRole && myRoleKey && !a.when.onlyRole.includes(myRoleKey)) return false;
    return true;
  });

  const textAction = actions.find((a) => a.kind === 'text');
  const buttonActions = actions.filter((a) => a.kind !== 'text');

  const submitText = () => {
    const t = text.trim();
    if (!t) return;
    // 引用前缀由 Composer 自己拼，服务端不需要知道
    const payload = quoting ? `> ${quoting.name}：${quoting.text}\n${t}` : t;
    onSend(payload);
    setText('');
    onCancelQuote?.();
  };

  return (
    <View className="border-t" style={{ backgroundColor: t.panel, borderTopColor: t.line }}>
      {/* 引用条 */}
      {!!quoting && (
        <View className="flex-row items-center px-3 pt-2">
          <View className="flex-1 border-l-2 border-accentline pl-2">
            <Text className="text-accenttext text-[10px]">{quoting.name}</Text>
            <Text className="text-sub text-[11px]" numberOfLines={1}>{quoting.text}</Text>
          </View>
          <Pressable onPress={onCancelQuote} hitSlop={8} className="pl-3">
            <Text className="text-sub text-[12px]">✕</Text>
          </Pressable>
        </View>
      )}

      {/* 选择面板 */}
      {picking && (
        <View className="px-3 pt-3 pb-1">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sub text-xs">
              {picking.kind === 'pick_option' ? picking.label : `选择目标 · ${picking.label}`}
            </Text>
            <Pressable onPress={() => setPicking(null)} hitSlop={8}>
              <Text className="text-sub text-xs">取消</Text>
            </Pressable>
          </View>

          {picking.kind === 'pick_option' ? (
            <View className="flex-row flex-wrap">
              {(picking.options ?? []).map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => { onAct(picking.key, { option: o.value }); setPicking(null); }}
                  className="bg-soft rounded-full px-4 py-2 mr-2 mb-2"
                >
                  <Text className="text-body text-[13px]">{o.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="pb-1">
              {players.map((p) => (
                <Pressable
                  key={p.id}
                  disabled={!p.alive}
                  onPress={() => { onAct(picking.key, { targetId: p.id }); setPicking(null); }}
                  className={`items-center mr-3 ${p.alive ? '' : 'opacity-30'}`}
                >
                  <Image
                    source={{ uri: p.avatar ?? `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(p.name)}` }}
                    className="w-11 h-11 rounded-full"
                    style={{ backgroundColor: t.soft }}
                  />
                  <Text className="text-body text-[10px] mt-1">{p.seat + 1} 号</Text>
                  <Text className="text-sub text-[10px]" numberOfLines={1}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* 表情行 */}
      {showEmoji && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-3 pt-2">
          {EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => { setText((t) => t + e); haptic.light(); }}
              className="mr-3 py-1"
            >
              <Text style={{ fontSize: 22 }}>{e}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 轮到你时的高亮提示 */}
      {waitingForMe && (
        <View className="bg-accentsoft px-3 py-1.5">
          <Text className="text-accenttext text-[11px] text-center font-semibold">轮到你了</Text>
        </View>
      )}

      {/* 主输入区 */}
      <View className="flex-row items-end px-3 py-2">
        <Pressable
          onPress={() => { haptic.light(); setShowEmoji((v) => !v); }}
          hitSlop={6}
          className="pb-1.5 pr-1"
        >
          <Text style={{ fontSize: 19 }}>{showEmoji ? '⌨️' : '🙂'}</Text>
        </Pressable>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={textAction?.placeholder ?? '插一句话…'}
          placeholderTextColor={t.faint}
          multiline
          maxLength={300}
          className="flex-1 bg-card rounded-2xl px-3 py-2 text-body text-[15px] max-h-24"
          style={{ minHeight: 40 }}
        />
        <Pressable
          onPress={submitText}
          disabled={!text.trim()}
          className={`ml-2 px-4 rounded-2xl justify-center ${text.trim() ? 'bg-accent' : 'bg-soft'}`}
          style={{ height: 40 }}
        >
          <Text className={`font-semibold ${text.trim() ? 'text-onaccent' : 'text-faint'}`}>发送</Text>
        </Pressable>
      </View>

      {/* 动态动作按钮 */}
      {!!buttonActions.length && (
        <View className="flex-row flex-wrap px-3 pb-2">
          {buttonActions.map((a) => {
            if (a.kind === 'instant') {
              return (
                <Pressable
                  key={a.key}
                  onPress={() => { haptic.medium(); onAct(a.key); }}
                  className="bg-soft border border-accentline rounded-full px-4 py-1.5 mr-2 mb-1.5"
                >
                  <Text className="text-accenttext text-[13px]">{a.label}</Text>
                </Pressable>
              );
            }
            if (a.kind === 'number') {
              return (
                <View key={a.key} className="flex-row items-center mr-2 mb-1.5">
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="number-pad"
                    placeholder={a.placeholder ?? '数字'}
                    placeholderTextColor={t.faint}
                    className="bg-card rounded-full px-3 py-1.5 text-body text-[13px] w-24"
                  />
                  <Pressable
                    onPress={() => {
                      const n = Number(amount);
                      if (!Number.isFinite(n)) return;
                      onAct(a.key, { amount: n });
                      setAmount('');
                    }}
                    className="bg-accent rounded-full px-3 py-1.5 ml-2"
                  >
                    <Text className="text-onaccent text-[13px] font-semibold">{a.label}</Text>
                  </Pressable>
                </View>
              );
            }
            return (
              <Pressable
                key={a.key}
                onPress={() => { haptic.light(); setPicking(a); }}
                className="bg-soft border border-line rounded-full px-4 py-1.5 mr-2 mb-1.5"
              >
                <Text className="text-body text-[13px]">{a.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
