import { View, Text, Pressable, Image } from 'react-native';
import { memo } from 'react';
import { seatColor, clock, metaLine } from '../lib/ui';
import { usePalette } from '../store/theme';
import { warmLine } from '../lib/theme';
import type { ChatMessage } from '../types';

/* ------------------------------------------------------------------ */
/* 消息气泡：AI 靠左，用户靠右，系统居中，AI 带「AI」标签                  */
/*                                                                     */
/* ★ 颜色全部走行内 style + 当前配色，不用 className 上色。              */
/*   原因：正文以前写的是 text-white/92，92 不在 Tailwind 透明度刻度上， */
/*   这个类压根不生效 → 文字掉回默认黑色 → 黑底黑字完全看不清。          */
/*   行内 style 没有这层风险。                                          */
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

/** 流式过程中模型吐的是 {"kind":"say",...} 这种原文，别甩到屏幕上 */
function isRawEnvelope(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('```')) return true;
  return (t[0] === '{' || t[0] === '[') && t.length < 400;
}

export const MessageBubble = memo(function MessageBubble({
  msg, seat = 0, onLongPress, onPress, showMeta, highlighted,
}: Props) {
  const t = usePalette();

  if (msg.senderType === 'system' || msg.senderType === 'judge') {
    return (
      <View className="items-center px-6 my-2">
        <View
          className="rounded-full px-3 py-1 max-w-[88%]"
          style={{ backgroundColor: t.card }}
        >
          <Text className="text-[11px] text-center leading-4" style={{ color: t.sub }}>
            {msg.content}
          </Text>
        </View>
      </View>
    );
  }

  const mine = msg.senderType === 'user';
  const color = mine ? t.warm : seatColor(seat);

  // 引用：正文里以 `> 名字：内容\n` 开头
  const { quote, body } = splitQuote(msg.content);
  const rawEnvelope = !!msg.streaming && isRawEnvelope(body);
  const shown = rawEnvelope ? '正在想…' : body;

  return (
    <View className={`flex-row px-3 my-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && (
        <Image
          source={{ uri: msg.avatar ?? `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(msg.senderName)}` }}
          className="w-8 h-8 rounded-full mr-2 mt-1"
          style={{ backgroundColor: t.soft }}
        />
      )}

      <View className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'}`}>
        <View className="flex-row items-center mb-1">
          <Text className="text-[11px] font-semibold" style={{ color }}>{msg.senderName}</Text>
          {msg.isAi && (
            <View className="ml-1.5 px-1 py-[1px] rounded" style={{ backgroundColor: t.accentSoft }}>
              <Text className="text-[9px] font-bold" style={{ color: t.accentText }}>AI</Text>
            </View>
          )}
          {!!msg.round && <Text className="text-[9px] ml-2" style={{ color: t.faint }}>R{msg.round}</Text>}
        </View>

        <Pressable
          onLongPress={() => onLongPress?.(msg)}
          onPress={() => onPress?.(msg)}
          delayLongPress={350}
          className="rounded-bubble px-3 py-2"
          style={{
            backgroundColor: highlighted
              ? t.accentSoft
              : mine ? t.bubbleMine : t.bubbleAi,
            borderWidth: highlighted ? 1.5 : 1,
            borderColor: highlighted ? t.accent : mine ? warmLine(t) : t.line,
          }}
        >
          {!!quote && (
            <View className="border-l-2 pl-2 mb-1.5" style={{ borderColor: t.line }}>
              <Text className="text-[11px]" style={{ color: t.sub }} numberOfLines={2}>
                {quote.name}：{quote.text}
              </Text>
            </View>
          )}
          <Text
            className="text-msg leading-[21px]"
            style={{ color: rawEnvelope ? t.faint : mine ? t.bubbleMineText : t.bubbleAiText }}
          >
            {shown}
            {msg.streaming && <Text style={{ color: t.accent }}> ▍</Text>}
          </Text>
        </Pressable>

        <View className="flex-row items-center mt-1">
          <Text className="text-[9px]" style={{ color: t.faint }}>{clock(msg.createdAt)}</Text>
          {showMeta && !!msg.meta && !!metaLine(msg.meta) && (
            <Text className="text-[9px] ml-2" style={{ color: t.faint }}>{metaLine(msg.meta)}</Text>
          )}
        </View>
      </View>

      {mine && (
        <Image
          source={{ uri: msg.avatar ?? `https://api.dicebear.com/7.x/thumbs/png?seed=me` }}
          className="w-8 h-8 rounded-full ml-2 mt-1"
          style={{ backgroundColor: t.soft }}
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
