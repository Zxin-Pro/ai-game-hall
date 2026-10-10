import AsyncStorage from '@react-native-async-storage/async-storage';

/* ------------------------------------------------------------------ */
/* 配色方案                                                            */
/*                                                                     */
/* ★ 设计原则：每个方案都要保证「正文 / 底色」对比度足够，              */
/*   之前 text-white/92 因为 92 不在 Tailwind 透明度刻度上，            */
/*   整句正文掉回默认黑色，在黑底上完全看不清 —— 这里全部改成          */
/*   实色，不再用透明度修饰符来表示文字亮度。                          */
/* ------------------------------------------------------------------ */

export interface Palette {
  key: string;
  name: string;
  desc: string;
  /** 浅色底（决定状态栏用深色字还是浅色字） */
  light: boolean;
  statusBar: 'light' | 'dark';

  bg: string;        // 页面底
  panel: string;     // 顶栏 / 底栏
  card: string;      // 卡片 / 系统气泡
  soft: string;      // 更浅一层（输入框、次级块）
  line: string;      // 分隔线

  text: string;      // 正文（★ 必须亮/暗得清楚）
  sub: string;       // 次要文字
  faint: string;     // 时间、meta

  accent: string;      // 主色（按钮底）
  onAccent: string;    // 主色上的字
  accentSoft: string;  // 主色的淡底（小标签）
  accentText: string;  // 主色当文字用时的颜色（要能看清）
  accentLine: string;  // 主色描边

  bubbleAi: string;
  bubbleAiText: string;
  bubbleMine: string;
  bubbleMineText: string;

  /** 座位名颜色：浅色底要用深一点的，不然一样看不清 */
  seats: string[];

  online: string;
  danger: string;
  warm: string;
}

export const PALETTES: Palette[] = [
  {
    key: 'midnight',
    name: '深夜紫',
    desc: '默认 · 夜里一盏不刺眼的灯',
    light: false,
    statusBar: 'light',
    bg: '#0b0912',
    panel: '#141021',
    card: '#1c1730',
    soft: '#262040',
    line: '#2e2848',
    text: '#eeebf8',
    sub: '#a49fbe',
    faint: '#6b6685',
    accent: '#9b8cff',
    onAccent: '#14101f',
    accentSoft: '#2a2350',
    accentText: '#b8adff',
    accentLine: '#4a3f7a',
    bubbleAi: '#1a1530',
    bubbleAiText: '#eeebf8',
    bubbleMine: '#3a2f1c',
    bubbleMineText: '#ffe9c9',
    seats: ['#9b8cff', '#5fd0f5', '#5ee0a8', '#ffc46b', '#ff8fb1', '#a0e06a', '#c9a0ff', '#7fe3d4', '#ff9f7a'],
    online: '#5ee0a8',
    danger: '#ff6b6b',
    warm: '#ffc46b',
  },
  {
    key: 'salt',
    name: '海盐',
    desc: '冷调蓝 · 像凌晨的海',
    light: false,
    statusBar: 'light',
    bg: '#061219',
    panel: '#0c1d28',
    card: '#122733',
    soft: '#18323f',
    line: '#1f3d4c',
    text: '#e6f4fa',
    sub: '#93b3c2',
    faint: '#5d7b8a',
    accent: '#5fd0f5',
    onAccent: '#04202b',
    accentSoft: '#123244',
    accentText: '#8fdcf8',
    accentLine: '#2c6a85',
    bubbleAi: '#0f2532',
    bubbleAiText: '#e6f4fa',
    bubbleMine: '#123240',
    bubbleMineText: '#d8f2fb',
    seats: ['#5fd0f5', '#7fe3d4', '#8fd4ff', '#5ee0a8', '#ffc46b', '#c9a0ff', '#ff8fb1', '#a0e06a', '#ff9f7a'],
    online: '#5ee0a8',
    danger: '#ff6b6b',
    warm: '#ffc46b',
  },
  {
    key: 'sakura',
    name: '樱花',
    desc: '柔粉调 · 软软的',
    light: false,
    statusBar: 'light',
    bg: '#160c13',
    panel: '#211420',
    card: '#2b1a29',
    soft: '#352131',
    line: '#432a3e',
    text: '#fbeaf1',
    sub: '#c9a3b4',
    faint: '#8a6a7a',
    accent: '#ff8fb1',
    onAccent: '#2b0f1c',
    accentSoft: '#48203a',
    accentText: '#ffb3c9',
    accentLine: '#7a3a58',
    bubbleAi: '#2a1826',
    bubbleAiText: '#fbeaf1',
    bubbleMine: '#3d2036',
    bubbleMineText: '#ffdcea',
    seats: ['#ff8fb1', '#ffb3c9', '#c9a0ff', '#ffc46b', '#5fd0f5', '#5ee0a8', '#ff9f7a', '#a0e06a', '#7fe3d4'],
    online: '#5ee0a8',
    danger: '#ff6b6b',
    warm: '#ffc46b',
  },
  {
    key: 'matcha',
    name: '抹茶',
    desc: '安静绿 · 适合睡前',
    light: false,
    statusBar: 'light',
    bg: '#0a1210',
    panel: '#121d18',
    card: '#18271f',
    soft: '#1f3329',
    line: '#274233',
    text: '#e9f7ee',
    sub: '#9dbfa9',
    faint: '#6a8a76',
    accent: '#5ee0a8',
    onAccent: '#052015',
    accentSoft: '#153a2c',
    accentText: '#8fecc3',
    accentLine: '#2f6b52',
    bubbleAi: '#132a20',
    bubbleAiText: '#e9f7ee',
    bubbleMine: '#1b3a2c',
    bubbleMineText: '#d6f7e6',
    seats: ['#5ee0a8', '#a0e06a', '#7fe3d4', '#5fd0f5', '#ffc46b', '#c9a0ff', '#ff8fb1', '#ff9f7a', '#9b8cff'],
    online: '#a0e06a',
    danger: '#ff6b6b',
    warm: '#ffc46b',
  },
  {
    key: 'amber',
    name: '暖阳',
    desc: '暖黄调 · 像午后',
    light: false,
    statusBar: 'light',
    bg: '#14100a',
    panel: '#1f1913',
    card: '#2a221a',
    soft: '#352c22',
    line: '#463a2c',
    text: '#f9f1e4',
    sub: '#c3ab8c',
    faint: '#8a7a62',
    accent: '#ffc46b',
    onAccent: '#2b1d06',
    accentSoft: '#43331a',
    accentText: '#ffd79a',
    accentLine: '#7a5f33',
    bubbleAi: '#2a2016',
    bubbleAiText: '#f9f1e4',
    bubbleMine: '#3d2f1c',
    bubbleMineText: '#ffeccb',
    seats: ['#ffc46b', '#ff9f7a', '#a0e06a', '#5fd0f5', '#ff8fb1', '#c9a0ff', '#5ee0a8', '#9b8cff', '#7fe3d4'],
    online: '#a0e06a',
    danger: '#ff6b6b',
    warm: '#ff9f7a',
  },
  {
    key: 'mono',
    name: '极简',
    desc: '黑白灰 · 只留内容',
    light: false,
    statusBar: 'light',
    bg: '#0d0d0f',
    panel: '#17171a',
    card: '#202024',
    soft: '#2a2a2f',
    line: '#333338',
    text: '#f2f2f4',
    sub: '#a0a0aa',
    faint: '#6c6c76',
    accent: '#e6e6ec',
    onAccent: '#111114',
    accentSoft: '#2e2e34',
    accentText: '#dcdce4',
    accentLine: '#4a4a52',
    bubbleAi: '#1d1d21',
    bubbleAiText: '#f2f2f4',
    bubbleMine: '#2c2c33',
    bubbleMineText: '#f2f2f4',
    seats: ['#d8d8e0', '#b9c6d6', '#c6d6c0', '#d6cfb9', '#d6bfc6', '#c9c2d6', '#b9d6d1', '#d6c6b9', '#c2c2cc'],
    online: '#9ad0a8',
    danger: '#ff6b6b',
    warm: '#d6cfb9',
  },
  {
    key: 'paper',
    name: '宣纸',
    desc: '浅色 · 白天看不累',
    light: true,
    statusBar: 'dark',
    bg: '#f5f2ea',
    panel: '#ffffff',
    card: '#ffffff',
    soft: '#ece7dc',
    line: '#ded8cb',
    text: '#1e1b26',
    sub: '#57525f',
    faint: '#78737f',
    accent: '#5a49d6',
    onAccent: '#ffffff',
    accentSoft: '#e6e1fb',
    accentText: '#4f3fc7',
    accentLine: '#c3b9f5',
    bubbleAi: '#ffffff',
    bubbleAiText: '#1e1b26',
    bubbleMine: '#e8e0ff',
    bubbleMineText: '#2a2340',
    seats: ['#5b4bd6', '#0f7ea0', '#17845a', '#a86a12', '#c04a72', '#4d8a1f', '#7b4fd6', '#0f7a72', '#b5551f'],
    online: '#17845a',
    danger: '#d3453f',
    warm: '#a86a12',
  },
];

export const DEFAULT_THEME = 'midnight';

export const findPalette = (key: string): Palette =>
  PALETTES.find((p) => p.key === key) ?? PALETTES[0]!;

/* ------------------------------------------------------------------ */
/* 转成 CSS 变量：交给 nativewind 的 vars() 铺在根节点上                */
/*                                                                     */
/* ★ 一律实色，不用半透明 —— Tailwind 的 `/15` 这种透明度修饰符        */
/*   碰到 var() 会生成 color-mix()，原生端不认识，会整块失效。          */
/*   需要「淡底」就直接算一个混合色出来。                              */
/* ------------------------------------------------------------------ */

const hex = (c: string) => c.replace('#', '');

function mix(a: string, b: string, t: number): string {
  const pa = hex(a), pb = hex(b);
  const out = [0, 2, 4].map((i) => {
    const va = parseInt(pa.slice(i, i + 2), 16);
    const vb = parseInt(pb.slice(i, i + 2), 16);
    return Math.round(va + (vb - va) * t).toString(16).padStart(2, '0');
  });
  return `#${out.join('')}`;
}

/** 主色的描边色（在底色上混出来，浅色主题也不会太扎眼） */
export const warmLine = (p: Palette) => mix(p.bg, p.warm, 0.38);

export const cssVars = (p: Palette): Record<string, string> => ({
  '--c-bg': p.bg,
  '--c-panel': p.panel,
  '--c-card': p.card,
  '--c-soft': p.soft,
  '--c-line': p.line,
  '--c-text': p.text,
  '--c-sub': p.sub,
  '--c-faint': p.faint,
  '--c-accent': p.accent,
  '--c-on-accent': p.onAccent,
  '--c-accent-soft': p.accentSoft,
  '--c-accent-text': p.accentText,
  '--c-accent-line': p.accentLine,
  '--c-warm': p.warm,
  '--c-warm-soft': mix(p.bg, p.warm, 0.16),
  '--c-warm-line': warmLine(p),
  '--c-danger': p.danger,
  '--c-danger-soft': mix(p.bg, p.danger, 0.18),
  '--c-online': p.online,
});

const KEY = 'agh.theme.v1';

export async function loadThemeKey(): Promise<string> {
  try {
    const k = await AsyncStorage.getItem(KEY);
    return k && PALETTES.some((p) => p.key === k) ? k : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export async function saveThemeKey(key: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY, key); } catch { /* 忽略 */ }
}
