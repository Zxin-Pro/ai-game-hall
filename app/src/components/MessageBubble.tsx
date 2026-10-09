import { View, Text, Pressable, Image } from 'react-native';
import { memo } from 'react';
import { seatColor, clock, metaLine } from '../lib/ui';
import type { ChatMessage } from '../types';

/* ------------------------------------------------------------------ */
/* 消息气泡：AI 靠左，用户靠右，系统居中，AI 带「AI」标签                  */
/* ------------------------------------------------------------------ */

interface Props {
  msg: ChatMessage;
  seat?: number;
  onLongPress?: (msg: ChatMessage) => void;
  onPress?: (msg: ChatMessage) => void;
  showMeta?: boolean;
  /** 被引用时高亮一下 */
  highlighted?: boolean;
}

export const MessageBubble = memo(function MessageBubble({
  msg, seat = 0, onLongPress, onPress, showMeta, highlighted,
}: Props) {
  if (msg.senderType === 'system' || msg.senderType === 'judge') {
    return (
      <View className="items-center px-6 my-2">
        <View className="bg-ink-800/80 rounded-full px-3 py-1 max-w-[88%]">
          <Text className="text-[11px] text-white/45 text-center leading-4">{msg.content}</Text>
        </View>
      </View>
    );
  }

  const mine = msg.senderType === 'user';
  const color = mine ? '#ffc46b' : seatColor(seat);

  // 引用：正文里以 `> 名字：内容\n` 开头
  const { quote, body } = splitQuote(msg.content);

  return (
    <View className={`flex-row px-3 my-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && (
        <Image
          source={{ uri: msg.avatar ?? `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(msg.senderName)}` }}
          className="w-8 h-8 rounded-full mr-2 mt-1 bg-ink-700"
        />
      )}

      <View className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'}`}>
        <View className="flex-row items-center mb-1">
          <Text className="text-[11px] font-semibold" style={{ color }}>{msg.senderName}</Text>
          {msg.isAi && (
            <View className="ml-1.5 px-1 py-[1px] rounded bg-lamp/25">
              <Text className="text-[9px] text-lamp-soft font-bold">AI</Text>
            </View>
          )}
          {!!msg.round && <Text className="text-[9px] text-white/25 ml-2">R{msg.round}</Text>}
        </View>

        <Pressable
          onLongPress={() => onLongPress?.(msg)}
          onPress={() => onPress?.(msg)}
          delayLongPress={350}
          className="rounded-bubble px-3 py-2"
          style={{
            backgroundColor: highlighted
              ? 'rgba(155,140,255,0.18)'
              : mine ? 'rgba(255,196,107,0.16)' : 'rgba(255,255,255,0.06)',
            borderWidth: highlighted ? 1.5 : 1,
            borderColor: highlighted ? '#9b8cff' : mine ? 'rgba(255,196,107,0.35)' : `${color}33`,
          }}
        >
          {!!quote && (
            <View className="border-l-2 border-white/25 pl-2 mb-1.5">
              <Text className="text-white/40 text-[11px]" numberOfLines={2}>
                {quote.name}：{quote.text}
              </Text>
            </View>
          )}
          <Text className="text-msg text-white/92 leading-[21px]">
            {body}
            {msg.streaming && <Text className="text-lamp"> ▍</Text>}
          </Text>
        </Pressable>

        <View className="flex-row items-center mt-1">
          <Text className="text-[9px] text-white/25">{clock(msg.createdAt)}</Text>
          {showMeta && !!msg.meta && !!metaLine(msg.meta) && (
            <Text className="text-[9px] text-white/20 ml-2">{metaLine(msg.meta)}</Text>
          )}
        </View>
      </View>

      {mine && (
        <Image
          source={{ uri: msg.avatar ?? 'https://api.dicebear.com/7.x/thumbs/png?seed=me' }}
          className="w-8 h-8 rounded-full ml-2 mt-1 bg-ink-700"
        />
      )}
    </View>
  );
});

/** 把 "> 名字：内容\n正文" 拆成引用块和正文 */
export function splitQuote(content: string): { quote: { name: string; text: string } | null; body: string } {
  const m = content.match(/^>\s*([^：:\n]{1,16})[：:]\s*([^\n]*)\n([\s\S]*)$/);
  if (!m) return { quote: null, body: content };
  return { quote: { name: m[1]!, text: m[2]!.slice(0, 60) }, body: m[3]! };
}
