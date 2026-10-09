import { View, Text } from 'react-native';

/* ------------------------------------------------------------------ */
/* 轮次分隔线：每进入新一轮，在消息流里插一条                       */
/* ------------------------------------------------------------------ */

export function RoundDivider({ round, phaseName }: { round: number; phaseName?: string }) {
  return (
    <View className="items-center my-4 px-6">
      <View className="flex-row items-center w-full">
        <View className="flex-1 h-[1px] bg-white/8" />
        <View className="bg-ink-800 rounded-full px-3 py-1 mx-3">
          <Text className="text-white/45 text-[10px] font-semibold">
            第 {round} 轮{phaseName ? ` · ${phaseName}` : ''}
          </Text>
        </View>
        <View className="flex-1 h-[1px] bg-white/8" />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 阶段切换提示                                                        */
/* ------------------------------------------------------------------ */

export function PhaseDivider({ label }: { label: string }) {
  return (
    <View className="items-center my-2.5 px-6">
      <View className="rounded-full px-3 py-1 bg-lamp/12 border border-lamp/20">
        <Text className="text-lamp-soft/80 text-[10px]">{label}</Text>
      </View>
    </View>
  );
}
