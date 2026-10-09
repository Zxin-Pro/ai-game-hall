import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { Link, router } from 'expo-router';
import { useAuth } from '../../src/store/auth';
import { haptic } from '../../src/lib/ui';

export default function Login() {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuth((s) => s.login);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);

  const submit = async () => {
    if (!nickname.trim() || !password) return;
    const ok = await login(nickname.trim(), password);
    if (ok) { haptic.success(); router.replace('/(tabs)'); }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-ink-950"
    >
      <View className="flex-1 justify-center px-7">
        <Text className="text-white text-[30px] font-bold">AI 游戏厅</Text>
        <Text className="text-white/40 text-[13px] mt-2 mb-9">
          一群 AI 围一桌，你负责看戏
        </Text>

        <TextInput
          value={nickname}
          onChangeText={(t) => { setNickname(t); clearError(); }}
          placeholder="昵称"
          placeholderTextColor="rgba(255,255,255,0.28)"
          autoCapitalize="none"
          className="bg-ink-800 rounded-2xl px-4 py-3.5 text-white/90 text-[15px] mb-3"
        />
        <TextInput
          value={password}
          onChangeText={(t) => { setPassword(t); clearError(); }}
          placeholder="密码"
          placeholderTextColor="rgba(255,255,255,0.28)"
          secureTextEntry
          className="bg-ink-800 rounded-2xl px-4 py-3.5 text-white/90 text-[15px] mb-2"
        />

        {!!error && <Text className="text-danger text-[12px] mb-2">{error}</Text>}

        <Pressable
          onPress={submit}
          disabled={loading || !nickname.trim() || !password}
          className={`rounded-2xl py-3.5 items-center mt-3 ${
            nickname.trim() && password ? 'bg-lamp' : 'bg-ink-700'
          }`}
        >
          {loading
            ? <ActivityIndicator color="#0b0912" />
            : <Text className={`font-bold text-[15px] ${nickname.trim() && password ? 'text-ink-950' : 'text-white/30'}`}>登录</Text>}
        </Pressable>

        <View className="flex-row justify-center mt-6">
          <Text className="text-white/35 text-[13px]">还没有账号？</Text>
          <Link href="/(auth)/register" asChild>
            <Pressable hitSlop={8}>
              <Text className="text-lamp text-[13px] ml-1">去注册</Text>
            </Pressable>
          </Link>
        </View>

        <Text className="text-white/15 text-[11px] text-center mt-10 leading-4">
          完全免费 · 无广告 · 无内购 · 不限局数
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
