import { create } from 'zustand';
import { findPalette, loadThemeKey, saveThemeKey, DEFAULT_THEME, type Palette } from '../lib/theme';
import { setSeatColors } from '../lib/ui';

/** 头像底色取当前配色的卡片色，浅色主题下才不会一堆黑圆 */
const avatars = (p: Palette) => [p.card.slice(1), p.soft.slice(1), p.panel.slice(1)];

/* ------------------------------------------------------------------ */
/* 配色状态：选中的方案会铺到根节点的 CSS 变量上                        */
/* ------------------------------------------------------------------ */

interface ThemeState {
  key: string;
  palette: Palette;
  ready: boolean;
  boot: () => Promise<void>;
  choose: (key: string) => Promise<void>;
}

const initial = findPalette(DEFAULT_THEME);
// 模块加载时先把座位色同步过去，免得首帧用了默认值
setSeatColors(initial.seats, avatars(initial));

export const useTheme = create<ThemeState>((set) => ({
  key: initial.key,
  palette: initial,
  ready: false,

  boot: async () => {
    const key = await loadThemeKey();
    const palette = findPalette(key);
    // ★ 必须先同步座位色再 set，不然这一帧的名字颜色还是旧的
    setSeatColors(palette.seats, avatars(palette));
    set({ key: palette.key, palette, ready: true });
  },

  choose: async (key: string) => {
    const palette = findPalette(key);
    setSeatColors(palette.seats, avatars(palette));
    set({ key: palette.key, palette });
    await saveThemeKey(palette.key);
  },
}));

/** 取当前配色，组件里直接 const t = usePalette() */
export const usePalette = () => useTheme((s) => s.palette);
