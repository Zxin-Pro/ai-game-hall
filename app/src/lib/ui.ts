import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/* ------------------------------------------------------------------ */
/* 头像：DiceBear 生成，本地不再存图                                     */
/* ------------------------------------------------------------------ */

export type AvatarStyle = 'bottts' | 'thumbs' | 'adventurer' | 'lorelei' | 'notionists';

/** 头像底色，跟着配色走（由 store/theme 写入） */
let avatarBg = '1c1730,262040,332b52';

export function dicebear(seed: string, style: AvatarStyle = 'bottts'): string {
  return `https://api.dicebear.com/7.x/${style}/png?seed=${encodeURIComponent(seed)}&backgroundColor=${avatarBg}`;
}

/* ------------------------------------------------------------------ */
/* 配色：按座位分色，和 config 的 COLORS 对齐                             */
/*                                                                     */
/* ★ 以前这里是写死的常量数组，浅色主题下这些亮色名字会看不清。         */
/*   改成跟着当前配色走：store/theme 换方案时调 setSeatColors 更新。     */
/* ------------------------------------------------------------------ */

let SEAT_COLORS = ['#9b8cff', '#5fd0f5', '#5ee0a8', '#ffc46b', '#ff8fb1', '#a0e06a', '#c9a0ff', '#7fe3d4', '#ff9f7a'];

/** 换配色时同步座位色 + 头像底色（十六进制不带 #，给 dicebear 用） */
export function setSeatColors(seats: string[], bgHex?: string[]) {
  if (seats.length) SEAT_COLORS = seats;
  if (bgHex?.length) avatarBg = bgHex.join(',');
}

export const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length]!;

export { SEAT_COLORS };

/* ------------------------------------------------------------------ */
/* 震动：只在关键节点，不要每句话都震                                     */
/* ------------------------------------------------------------------ */

export const haptic = {
  light: () => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  medium: () => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); },
  success: () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  warn: () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); },
  /** 轮到你时的双震 */
  call: async () => {
    if (Platform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setTimeout(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); }, 120);
  },
};

/* ------------------------------------------------------------------ */
/* 时间格式化                                                           */
/* ------------------------------------------------------------------ */

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const d = Date.now() - t;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  const days = Math.floor(d / 86400_000);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/* ------------------------------------------------------------------ */
/* 发言气泡的小字 meta                                                  */
/* ------------------------------------------------------------------ */

export function metaLine(meta?: {
  ttftMs?: number; genMs?: number; tokens?: number; rate?: number; estimated?: boolean;
}): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.ttftMs) parts.push(`首字 ${(meta.ttftMs / 1000).toFixed(1)}s`);
  if (meta.genMs) parts.push(`生成 ${(meta.genMs / 1000).toFixed(1)}s`);
  if (meta.tokens) parts.push(`${meta.estimated ? '≈' : ''}${meta.tokens} tok`);
  if (meta.rate) parts.push(`${meta.estimated ? '≈' : ''}${meta.rate.toFixed(1)} tok/s`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* 防沉迷计时                                                           */
/* ------------------------------------------------------------------ */

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}
