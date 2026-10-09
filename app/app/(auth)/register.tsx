import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { useState } from 'react';
import { Link, router } from 'expo-router';
import { useAuth } from '../../src/store/auth';
import { haptic } from '../../src/lib/ui';

export default function Register() {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const register = useAuth((s) => s.register);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);

  const valid = nickname.trim().length >= 2 && password.length >= 6;

  const submit = async () => {
    if (!valid) return;
    const ok = await register(nickname.trim(), password, inviteCode.trim() || undefined);
    if (ok) { haptic.success(); router.replace('/(tabs)'); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-ink-950">
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} className="px-7">
        <Text className="text-white text-[26px] font-bold">加入游戏厅</Text>
        <Text className="text-white/40 text-[13px] mt-2 mb-8">内测中，需要邀请码</Text>

        <TextInput
          value={nickname}
          onChangeText={(t) => { setNickname(t); clearError(); }}
          placeholder="昵称（2-16 字）"
          placeholderTextColor="rgba(255,255,255,0.28)"
          autoCapitalize="none"
          className="bg-ink-800 rounded-2xl px-4 py-3.5 text-white/90 text-[15px] mb-3"
        />
        <TextInput
          value={password}
          onChangeText={(t) => { setPassword(t); clearError(); }}
          placeholder="密码（至少 6 位）"
          placeholderTextColor="rgba(255,255,255,0.28)"
          secureTextEntry
          className="bg-ink-800 rounded-2xl px-4 py-3.5 text-white/90 text-[15px] mb-3"
        />
        <TextInput
          value={inviteCode}
          onChangeText={(t) => { setInviteCode(t); clearError(); }}
          placeholder="邀请码"
          placeholderTextColor="rgba(255,255,255,0.28)"
          autoCapitalize="characters"
          className="bg-ink-800 rounded-2xl px-4 py-3.5 text-white/90 text-[15px] mb-2"
        />

        {!!error && <Text className="text-danger text-[12px] mb-2">{error}</Text>}

        <Pressable
          onPress={submit}
          disabled={loading || !valid}
          className={`rounded-2xl py-3.5 items-center mt-3 ${valid ? 'bg-lamp' : 'bg-ink-700'}`}
        >
          {loading
            ? <ActivityIndicator color="#0b0912" />
            : <Text className={`font-bold text-[15px] ${valid ? 'text-ink-950' : 'text-white/30'}`}>注册</Text>}
        </Pressable>

        <View className="flex-row justify-center mt-6">
          <Text className="text-white/35 text-[13px]">已经有账号了？</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable hitSlop={8}>
              <Text className="text-lamp text-[13px] ml-1">去登录</Text>
            </Pressable>
          </Link>
        </View>

        <Text className="text-white/15 text-[11px] text-center mt-10 leading-4">
          点击注册即表示同意《用户协议》与《隐私政策》{'\n'}内容分级 12+ · 所有 AI 发言由模型生成
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
