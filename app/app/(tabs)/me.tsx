import {
  View, Text, ScrollView, Pressable, TextInput, Image, Alert, ActivityIndicator,
} from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api';
import { PALETTES } from '../../src/lib/theme';
import { useTheme } from '../../src/store/theme';
import { useAuth } from '../../src/store/auth';
import { haptic, formatDuration } from '../../src/lib/ui';
import { fetchLatest, myVersionCode, myVersionName } from '../../src/lib/updater';
import { Linking } from 'react-native';

interface Memory { id: string; key: string; value: string }

export default function Me() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const palette = useTheme((s) => s.palette);
  const chooseTheme = useTheme((s) => s.choose);

  // 手动检查更新：直接问服务端最新版本，和自己比
  const onCheckUpdate = useCallback(async () => {
    haptic.light();
    const latest = await fetchLatest();
    if (!latest) return Alert.alert('检查失败', '网络不太好，等会儿再试');
    if (latest.versionCode <= myVersionCode()) {
      return Alert.alert('已是最新版', `当前 v${myVersionName()}`);
    }
    Alert.alert(
      `发现新版本 ${latest.versionName}`,
      latest.note || '去下载新的安装包',
      [
        { text: '以后再说', style: 'cancel' },
        { text: '去更新', onPress: () => { if (latest.apkUrl) Linking.openURL(latest.apkUrl).catch(() => {}); } },
      ],
    );
  }, []);

  const [today, setToday] = useState({ gamesPlayed: 0, tokensUsed: 0 });
  const [globalTokens, setGlobalTokens] = useState(0);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [playtime, setPlaytime] = useState(0);

  const load = useCallback(async () => {
    try {
      const [me, mem] = await Promise.all([api.me(), api.memories().catch(() => ({ memories: [] }))]);
      setToday(me.today);
      setGlobalTokens(me.globalTokensToday);
      setMemories(mem.memories);
    } catch { /* 静默 */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // 防沉迷：本地计时
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setPlaytime(Math.floor((Date.now() - started) / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const addMemory = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    await api.addMemory(newKey.trim(), newValue.trim());
    setNewKey(''); setNewValue('');
    haptic.light();
    void load();
  };

  const removeMemory = (id: string) => {
    Alert.alert('删掉这条记忆？', '删掉之后 AI 就不会记得这件事了', [
      { text: '再想想', style: 'cancel' },
      {
        text: '删掉', style: 'destructive',
        onPress: async () => { await api.deleteMemory(id); void load(); },
      },
    ]);
  };

  const doLogout = () => {
    Alert.alert('退出登录？', '', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
    ]);
  };

  return (
    <View className="flex-1 bg-page" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* 头部 */}
        <View className="px-5 pt-3 pb-5 flex-row items-center">
          <Image
            source={{ uri: user?.avatar ?? `https://api.dicebear.com/7.x/thumbs/png?seed=${encodeURIComponent(user?.nickname ?? 'me')}` }}
            className="w-16 h-16 rounded-full bg-soft"
          />
          <View className="ml-4 flex-1">
            <Text className="text-body text-[19px] font-bold">{user?.nickname ?? '未登录'}</Text>
            <Text className="text-sub text-[12px] mt-1">
              今天玩了 {today.gamesPlayed} 局 · 用了 {today.tokensUsed} tok
            </Text>
          </View>
        </View>

        {/* 免费声明 */}
        <View className="mx-4 bg-accentsoft border border-accentline rounded-2xl px-4 py-3 mb-4">
          <Text className="text-accenttext text-[13px] font-semibold">完全免费</Text>
          <Text className="text-sub text-[11px] mt-1 leading-4">
            没有广告，没有内购，没有每日局数上限，所有功能对所有人开放
          </Text>
        </View>

        {/* 用不着花钱，但让你看得见 */}
        <View className="mx-4 bg-panel rounded-2xl p-4 mb-4">
          <Text className="text-body text-[13px] font-semibold mb-3">用量</Text>
          <Row label="今日局数" value={String(today.gamesPlayed)} />
          <Row label="今日 token" value={String(today.tokensUsed)} />
          <Row label="全站今日 token" value={globalTokens.toLocaleString()} />
          <Row label="本次在线时长" value={formatDuration(playtime)} />
          <Text className="text-faint text-[10px] mt-3 leading-4">
            AI 发言由模型生成，我们只做轻度成本控制（限制轮次和输出长度），不影响你的体验
          </Text>
        </View>

        {/* AI 记忆偏好 */}
        <View className="mx-4 bg-panel rounded-2xl p-4 mb-4">
          <Text className="text-body text-[13px] font-semibold">AI 记忆偏好</Text>
          <Text className="text-faint text-[11px] mt-1 mb-3">
            写下来，AI 以后就会记得。比如「我不喜欢太吵的角色」
          </Text>

          {memories.map((m) => (
            <Pressable
              key={m.id}
              onLongPress={() => removeMemory(m.id)}
              className="flex-row items-center bg-card rounded-xl px-3 py-2.5 mb-2"
            >
              <Text className="text-accenttext text-[12px] font-semibold mr-2">{m.key}</Text>
              <Text className="text-sub text-[12px] flex-1" numberOfLines={1}>{m.value}</Text>
              <Text className="text-faint text-[10px]">长按删</Text>
            </Pressable>
          ))}

          <View className="flex-row mt-1">
            <TextInput
              value={newKey}
              onChangeText={setNewKey}
              placeholder="标签"
              placeholderTextColor={palette.faint}
              maxLength={20}
              className="bg-card rounded-xl px-3 py-2 text-body text-[12px] w-[76px] mr-2"
            />
            <TextInput
              value={newValue}
              onChangeText={setNewValue}
              placeholder="一句话说明"
              placeholderTextColor={palette.faint}
              maxLength={200}
              className="bg-card rounded-xl px-3 py-2 text-body text-[12px] flex-1"
            />
            <Pressable onPress={addMemory} className="bg-accent rounded-xl px-3 justify-center ml-2">
              <Text className="text-onaccent text-[12px] font-semibold">加上</Text>
            </Pressable>
          </View>
        </View>

        {/* 配色 */}
        <View className="mx-4 bg-panel rounded-2xl p-4 mb-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-body text-[13px] font-semibold">配色</Text>
            <Text className="text-faint text-[10px]">当前 · {palette.name}</Text>
          </View>
          <Text className="text-faint text-[11px] mt-1 mb-3">
            挑一个看着舒服的，整个界面都会跟着换
          </Text>

          <View className="flex-row flex-wrap">
            {PALETTES.map((p) => {
              const on = p.key === palette.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => { haptic.light(); void chooseTheme(p.key); }}
                  className="rounded-2xl p-2.5 mr-2.5 mb-2.5"
                  style={{
                    backgroundColor: p.bg,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? p.accent : p.line,
                    width: 104,
                  }}
                >
                  {/* 用方案自己的颜色画预览，看到的就是换上去的样子 */}
                  <View className="flex-row mb-2">
                    {[p.accent, p.bubbleAi, p.text, p.sub].map((c, i) => (
                      <View key={i} className="w-4 h-4 rounded-full mr-1" style={{ backgroundColor: c }} />
                    ))}
                  </View>
                  <Text className="text-[11px] font-semibold" style={{ color: p.text }}>
                    {p.name}{on ? ' ✓' : ''}
                  </Text>
                  <Text className="text-[9px] mt-0.5" numberOfLines={1} style={{ color: p.faint }}>
                    {p.desc}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 设置项 */}
        <View className="mx-4 bg-panel rounded-2xl overflow-hidden mb-4">
          <Item label="用户协议" onPress={() => router.push('/legal/terms')} />
          <Item label="隐私政策" onPress={() => router.push('/legal/privacy')} />
          <Item label="内容分级 12+" right="已开启" />
          <Item label="防沉迷提醒" right="每 60 分钟" />
          <Item label="推送通知" onPress={() => { haptic.light(); }} right="去系统设置" />
          <Item
            label="检查更新"
            right={`当前 v${myVersionName()}`}
            onPress={onCheckUpdate}
          />
        </View>

        <Pressable onPress={doLogout} className="mx-4 bg-panel rounded-2xl py-3.5 items-center">
          <Text className="text-danger text-[14px]">退出登录</Text>
        </Pressable>

        {loading && <ActivityIndicator color={palette.accent} className="mt-6" />}

        <Text className="text-faint text-[10px] text-center mt-8">
          AI 游戏厅 v{myVersionName()} · 所有 AI 发言由模型生成，请勿作为现实决策依据
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1.5">
      <Text className="text-sub text-[12px]">{label}</Text>
      <Text className="text-body text-[12px] font-semibold">{value}</Text>
    </View>
  );
}

function Item({ label, right, onPress }: { label: string; right?: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between px-4 py-3.5 border-b border-line active:bg-soft"
    >
      <Text className="text-body text-[13px]">{label}</Text>
      <Text className="text-faint text-[12px]">{right ?? '›'}</Text>
    </Pressable>
  );
}
