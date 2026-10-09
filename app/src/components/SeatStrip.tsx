import { View, Text, Image, Pressable } from 'react-native';
import { seatColor } from '../lib/ui';
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
  return (
    <View className="px-3 py-2 bg-ink-900/80 border-b border-white/5">
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
                  borderColor: active ? c : me ? '#ffc46b' : 'transparent',
                }}
              >
                <Image
                  source={{ uri: p.avatar ?? `https://api.dicebear.com/7.x/bottts/png?seed=${encodeURIComponent(p.name)}` }}
                  className="w-9 h-9 rounded-full bg-ink-700"
                />
              </View>
              <Text className="text-[9px] mt-0.5" style={{ color: p.alive ? c : 'rgba(255,255,255,0.35)' }}>
                {p.seat + 1}·{p.name.length > 4 ? p.name.slice(0, 4) : p.name}
              </Text>
              {!p.alive && (
                <Text className="text-[8px] text-danger/70 mt-[-2px]">出局</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
