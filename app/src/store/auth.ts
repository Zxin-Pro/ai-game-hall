import { create } from 'zustand';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { api, loadTokens, saveTokens, getAccessToken } from '../lib/api';
import type { User } from '../types';

/* ------------------------------------------------------------------ */
/* 认证状态                                                             */
/* ------------------------------------------------------------------ */

const deviceFingerprint = () =>
  `${Platform.OS}-${Application.applicationId ?? 'dev'}-${Application.getAndroidId?.() ?? 'x'}`;

interface AuthState {
  user: User | null;
  ready: boolean;
  loading: boolean;
  error: string | null;

  boot: () => Promise<void>;
  login: (nickname: string, password: string) => Promise<boolean>;
  register: (nickname: string, password: string, inviteCode?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  loading: false,
  error: null,

  /** App 启动：恢复 token，静默拉一次 /me 验证有效性 */
  boot: async () => {
    const { accessToken, refreshToken } = await loadTokens();
    if (!accessToken && !refreshToken) {
      set({ ready: true });
      return;
    }
    try {
      const me = await api.me();
      set({ user: me.user, ready: true });
    } catch {
      await saveTokens(null, null);
      set({ user: null, ready: true });
    }
  },

  login: async (nickname, password) => {
    set({ loading: true, error: null });
    try {
      const res = await api.login({ nickname, password, deviceFingerprint: deviceFingerprint() });
      await saveTokens(res.access, res.refresh);
      set({ user: res.user, loading: false });
      return true;
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '登录失败' });
      return false;
    }
  },

  register: async (nickname, password, inviteCode) => {
    set({ loading: true, error: null });
    try {
      const res = await api.register({
        nickname, password, inviteCode, deviceFingerprint: deviceFingerprint(),
      });
      await saveTokens(res.access, res.refresh);
      set({ user: res.user, loading: false });
      return true;
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '注册失败' });
      return false;
    }
  },

  logout: async () => {
    try { await api.logout(null); } catch { /* 忽略 */ }
    await saveTokens(null, null);
    set({ user: null });
  },

  clearError: () => set({ error: null }),
}));

export const hasToken = () => Boolean(getAccessToken());
