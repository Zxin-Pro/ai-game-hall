import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { useCallback, useEffect, useState } from 'react';
import { request } from './api';

/* ------------------------------------------------------------------ */
/* 自更新：启动时问一下服务端「现在最新是哪个版本」                     */
/*                                                                     */
/* 版本号由 CI 每次构建自动 +1（versionCode = 1000 + 构建序号），       */
/* 发布时又顺手登记到服务端，所以这里查到的永远是最新的。               */
/* ------------------------------------------------------------------ */

export interface AppLatest {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  note: string;
  minVersionCode: number;
}

export interface UpdateInfo extends AppLatest {
  /** 是不是必须更新（低于服务端定的最低版本） */
  force: boolean;
  /** 自己当前的版本号 */
  currentCode: number;
}

/** 读自己当前的 versionCode：优先构建时写进 extra 的那份 */
export function myVersionCode(): number {
  const extra = (Constants.expoConfig?.extra ?? {}) as { versionCode?: number };
  if (typeof extra.versionCode === 'number' && extra.versionCode > 0) return extra.versionCode;
  const n = Number(Application.nativeBuildVersion ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function myVersionName(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { versionName?: string };
  if (extra.versionName) return extra.versionName;
  return Application.nativeApplicationVersion ?? String(myVersionCode());
}

/** 查一次服务端的最新版本。失败就静默返回 null（不能因为查版本卡住 App） */
export async function fetchLatest(): Promise<AppLatest | null> {
  try {
    return await request<AppLatest>('/api/app/latest', { noAuth: true });
  } catch {
    return null;
  }
}

/**
 * 启动时检查一次更新。
 * 返回 null = 不用更新（或查不到），有值就是要弹提示。
 */
export function useUpdateCheck() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    const latest = await fetchLatest();
    if (!latest || !latest.versionCode) return;
    const mine = myVersionCode();
    if (latest.versionCode <= mine) {
      setInfo(null);
      return;
    }
    setInfo({
      ...latest,
      force: latest.minVersionCode > 0 && mine < latest.minVersionCode,
      currentCode: mine,
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void check(); }, 1200);
    return () => clearTimeout(t);
  }, [check]);

  return {
    info: dismissed ? null : info,
    /** 有更新但被忽略了（「我的」页可以再点一次提醒） */
    hasUpdate: !!info,
    force: !!info?.force,
    dismiss: () => setDismissed(true),
    check,
  };
}
