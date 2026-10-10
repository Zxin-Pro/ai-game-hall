import { View, Text } from 'react-native';
import { usePalette } from '../store/theme';

/* ------------------------------------------------------------------ */
/* 轮次分隔线：每进入新一轮，在消息流里插一条                       */
/* ------------------------------------------------------------------ */

export function RoundDivider({ round, phaseName }: { round: number; phaseName?: string }) {
  const t = usePalette();
  return (
    <View className="items-center my-4 px-6">
      <View className="flex-row items-center w-full">
        <View className="flex-1 h-[1px]" style={{ backgroundColor: t.line }} />
        <View className="rounded-full px-3 py-1 mx-3" style={{ backgroundColor: t.card }}>
          <Text className="text-[10px] font-semibold" style={{ color: t.sub }}>
            第 {round} 轮{phaseName ? ` · ${phaseName}` : ''}
          </Text>
        </View>
        <View className="flex-1 h-[1px]" style={{ backgroundColor: t.line }} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 阶段切换提示                                                        */
/* ------------------------------------------------------------------ */

export function PhaseDivider({ label }: { label: string }) {
  const t = usePalette();
  return (
    <View className="items-center my-2.5 px-6">
      <View
        className="rounded-full px-3 py-1"
        style={{ backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.accentLine }}
      >
        <Text className="text-[10px]" style={{ color: t.accentText }}>{label}</Text>
      </View>
    </View>
  );
}
