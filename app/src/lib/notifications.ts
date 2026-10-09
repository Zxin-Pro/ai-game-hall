import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

/* ------------------------------------------------------------------ */
/* 推送：轮到你 / 对局结束                                              */
/* ------------------------------------------------------------------ */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('game', {
      name: '对局提醒',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#9b8cff',
    });
  }

  const token = (await Notifications.getDevicePushTokenAsync().catch(() => null)) as { data?: string } | null;
  const value = token?.data ?? null;
  if (value) {
    try { await api.updateMe({ pushToken: value }); } catch { /* 静默失败 */ }
  }
  return value;
}

/** 本地提醒：轮到你的时候，App 在后台也能被叫醒 */
export async function notifyLocal(title: string, body: string) {
  if (Platform.OS === 'web') return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind: 'local' } },
    trigger: null,
  });
}

export function useNotifications() {
  useEffect(() => {
    registerForPush().catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      // 点击通知由 expo-router 的 deep link 处理，这里不用额外做事
    });
    return () => sub.remove();
  }, []);
}

/* ------------------------------------------------------------------ */
/* 防沉迷：本地计时，到点了发一条本地通知，不封禁、不限局                */
/* ------------------------------------------------------------------ */

const SESSION_START = Date.now();

export function usePlaytimeGuard() {
  useEffect(() => {
    let cancelled = false;
    let minutes = 60;
    let text = '已经玩了一小时啦，起来活动一下';

    const timer = setInterval(async () => {
      if (cancelled) return;
      const elapsedMin = Math.floor((Date.now() - SESSION_START) / 60000);
      if (elapsedMin > 0 && elapsedMin % minutes === 0) {
        await notifyLocal('该休息一下了', text).catch(() => {});
      }
    }, 60_000);

    void (async () => {
      try {
        const p = await api.playtimePolicy();
        if (!cancelled && p?.remindAfterMinutes) {
          minutes = p.remindAfterMinutes;
          text = p.remindText;
        }
      } catch { /* 用默认值 */ }
    })();

    return () => { cancelled = true; clearInterval(timer); };
  }, []);
}

/** 本次会话已玩了多少秒 */
export const sessionSeconds = () => Math.floor((Date.now() - SESSION_START) / 1000);
