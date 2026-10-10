import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';
import { api, BASE_URL } from '../../../src/lib/api';
import { haptic, seatColor } from '../../../src/lib/ui';
import type { SummaryCard } from '../../../src/types';

/* ------------------------------------------------------------------ */
/* 结算页：总结卡 + 分享图                                               */
/* ------------------------------------------------------------------ */

export default function ResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShot>(null);

  const [card, setCard] = useState<SummaryCard | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.summary(id);
      setCard(res.summary);
      setShareUrl(res.shareImageUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : '还没有结算');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /** 截图 → 直接调系统分享 → 顺手传一份存起来 */
  const share = async () => {
    if (!card || sharing) return;
    setSharing(true);
    haptic.light();
    try {
      const uri = await shotRef.current?.capture?.();
      if (uri) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: '分享这局的结果',
            UTI: 'public.png',
          });
        }
        // 存一份到服务器，方便以后从战绩里直接看到
        try {
          const up = await api.uploadImage(uri);
          setShareUrl(up.url);
          await api.saveShareImage(String(id), up.url);
        } catch { /* 存不上不影响分享 */ }
      } else {
        // 截图失败就退化成文字分享
        await Share.share({ message: `${card.shareText}\n\n${card.highlights.join('\n')}\n\n—— AI 游戏厅` });
      }
    } catch {
      /* 用户取消 */
    } finally {
      setSharing(false);
    }
  };

  const copyText = async () => {
    if (!card) return;
    await Share.share({
      message: [
        card.shareText,
        '',
        ...card.highlights,
        card.mvp ? `\nMVP：${card.mvp.name} — ${card.mvp.reason}` : '',
        '',
        '—— AI 游戏厅',
      ].filter(Boolean).join('\n'),
    });
  };

  if (loading) {
    return (
      <View className="flex-1 bg-page items-center justify-center">
        <ActivityIndicator color="#9b8cff" />
      </View>
    );
  }

  if (!card) {
    return (
      <View className="flex-1 bg-page items-center justify-center px-8">
        <Text className="text-sub text-[14px] text-center">{error ?? '这局还没结束'}</Text>
        <Pressable onPress={() => router.back()} className="mt-5">
          <Text className="text-accenttext text-[13px]">返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-page" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text className="text-sub text-[14px]">‹ 返回</Text>
        </Pressable>
        <Text className="text-body text-[16px] font-semibold flex-1 text-center">结算</Text>
        <View className="w-[40px]" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        {/* 会被截图的那一块 */}
        <ViewShot ref={shotRef} options={{ format: 'png', quality: 0.95 }}>
          <View className="bg-panel rounded-3xl p-5 border border-accentline">
            <View className="flex-row items-center mb-1">
              <Text className="text-accenttext text-[11px] font-semibold">AI 游戏厅</Text>
              <View className="flex-1" />
              <Text className="text-faint text-[10px]">{card.title}</Text>
            </View>

            <Text className="text-body text-[24px] font-bold mt-2 leading-8">{card.winner}</Text>

            <View className="h-[1px] bg-line my-4" />

            {card.highlights.map((h, i) => (
              <View key={i} className="flex-row mb-2">
                <Text className="text-accenttext text-[12px] mr-2">·</Text>
                <Text className="text-body text-[13px] flex-1 leading-5">{h}</Text>
              </View>
            ))}

            {!!card.stats?.length && (
              <View className="flex-row flex-wrap mt-3">
                {card.stats.map((s, i) => (
                  <View key={i} className="bg-card rounded-xl px-3 py-2 mr-2 mb-2">
                    <Text className="text-sub text-[10px]">{s.label}</Text>
                    <Text className="text-body text-[13px] font-semibold mt-0.5">{s.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {!!card.mvp && (
              <View className="bg-accentsoft border border-accentline rounded-2xl p-3 mt-3">
                <Text className="text-accenttext text-[12px] font-semibold">
                  MVP · {card.mvp.name}
                </Text>
                <Text className="text-sub text-[12px] mt-1 leading-4">{card.mvp.reason}</Text>
              </View>
            )}

            <Text className="text-faint text-[10px] mt-4 text-center">
              完全免费 · 无广告 · 内容分级 12+
            </Text>
          </View>
        </ViewShot>

        {/* 复盘 */}
        <View className="mt-5 bg-panel rounded-3xl p-5">
          <Text className="text-body text-[14px] font-semibold mb-3">复盘三句话</Text>
          {card.review.map((r, i) => (
            <View key={i} className="flex-row mb-2.5">
              <View
                className="w-5 h-5 rounded-full items-center justify-center mr-2.5 mt-[1px]"
                style={{ backgroundColor: `${seatColor(i)}22` }}
              >
                <Text style={{ color: seatColor(i), fontSize: 10, fontWeight: '700' }}>{i + 1}</Text>
              </View>
              <Text className="text-sub text-[13px] flex-1 leading-5">{r}</Text>
            </View>
          ))}
        </View>

        {/* 已经生成过的分享图 */}
        {!!shareUrl && (
          <View className="mt-4 bg-panel rounded-2xl px-4 py-3">
            <Text className="text-sub text-[11px]">分享图已保存</Text>
            <Text className="text-accenttext text-[11px] mt-1" numberOfLines={1}>
              {shareUrl.replace(BASE_URL, '')}
            </Text>
          </View>
        )}

        <View className="flex-row mt-4">
          <Pressable
            onPress={share}
            disabled={sharing}
            className={`flex-1 rounded-2xl py-3.5 items-center mr-2 ${sharing ? 'bg-soft' : 'bg-accent'}`}
          >
            {sharing
              ? <ActivityIndicator color="#0b0912" />
              : <Text className="text-onaccent font-bold text-[14px]">生成分享图</Text>}
          </Pressable>
          <Pressable
            onPress={copyText}
            className="flex-1 bg-card rounded-2xl py-3.5 items-center"
          >
            <Text className="text-body font-semibold text-[14px]">分享文字</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push(`/room/${id}/replay`)}
          className="mt-3 bg-panel rounded-2xl py-3.5 items-center"
        >
          <Text className="text-body text-[14px]">看回放</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)')}
          className="mt-3 bg-panel rounded-2xl py-3.5 items-center"
        >
          <Text className="text-sub text-[14px]">再来一局</Text>
        </Pressable>

        <Text className="text-faint text-[10px] text-center mt-8 leading-4">
          本局发言由 AI 生成 · 内容分级 12+
        </Text>
      </ScrollView>
    </View>
  );
}
