import { View, Text, Image, Pressable } from 'react-native';
import { seatColor } from '../lib/ui';
import { usePalette } from '../store/theme';
import type { RoomPlayer } from '../types';

/* ------------------------------------------------------------------ */
/* 座位条：一排头像，死了打叉，谁在说话高亮                              */
/* ------------------------------------------------------------------ */

export function SeatStrip({
  players,
  speakingId,
  myPlayerId,
  onPress,
}: {
  players: RoomPlayer[];
  speakingId?: string | null;
  myPlayerId?: string | null;
  onPress?: (p: RoomPlayer) => void;
}) {
  const t = usePalette();
  return (
    <View
      className="px-3 py-2 border-b"
      style={{ backgroundColor: t.panel, borderBottomColor: t.line }}
    >
      <View className="flex-row flex-wrap">
        {players.map((p) => {
          const c = seatColor(p.seat);
          const active = speakingId === p.id;
          const me = myPlayerId === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => onPress?.(p)}
              className="items-center mr-3 mb-1"
              style={{ opacity: p.alive ? 1 : 0.35 }}
            >
              <View
                className="rounded-full p-[2px]"
                style={{
                  borderWidth: active ? 2 : me ? 1.5 : 0,
                  borderColor: active ? c : me ? t.warm : 'transparent',
                }}
              >
                <Image
                  source={{ uri: p.avatar ?? `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(p.name)}` }}
                  className="w-9 h-9 rounded-full"
                  style={{ backgroundColor: t.soft }}
                />
              </View>
              <Text className="text-[9px] mt-0.5" style={{ color: p.alive ? c : t.faint }}>
                {p.seat + 1}·{p.name.length > 4 ? p.name.slice(0, 4) : p.name}
              </Text>
              {!p.alive && (
                <Text className="text-[8px] text-danger mt-[-2px]">出局</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
