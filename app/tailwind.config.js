/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        /* ------------------------------------------------------------------ */
        /* ★ 语义色：全部指向 CSS 变量，由 store/theme 在根节点用 vars() 铺开   */
        /*   换配色 = 换一组变量，所有页面自动跟着变。                          */
        /*   注意：这些不要配 `/50` 之类的透明度修饰符 —— var() 加透明度会     */
        /*   生成 color-mix()，原生端不认，整条样式会失效（就是之前           */
        /*   text-white/92 变黑字的同类坑）。                                  */
        /* ------------------------------------------------------------------ */
        page: 'var(--c-bg)',
        panel: 'var(--c-panel)',
        card: 'var(--c-card)',
        soft: 'var(--c-soft)',
        line: 'var(--c-line)',
        body: 'var(--c-text)',
        sub: 'var(--c-sub)',
        faint: 'var(--c-faint)',
        accent: 'var(--c-accent)',
        accentsoft: 'var(--c-accent-soft)',
        accenttext: 'var(--c-accent-text)',
        accentline: 'var(--c-accent-line)',
        onaccent: 'var(--c-on-accent)',
        warm: 'var(--c-warm)',
        warmsoft: 'var(--c-warm-soft)',
        warmline: 'var(--c-warm-line)',
        danger: 'var(--c-danger)',
        dangersoft: 'var(--c-danger-soft)',
        online: 'var(--c-online)',

        /* 兼容用（没迁移干净时的兜底） */
        ink: {
          950: '#0b0912',
          900: '#141021',
          800: '#1c1730',
          700: '#262040',
          600: '#332b52',
        },
        lamp: {
          DEFAULT: '#9b8cff',
          soft: '#b8adff',
          dim: '#4a3f7a',
        },
        mint: '#5ee0a8',
        sky: '#5fd0f5',
        rose: '#ff8fb1',
      },
      borderRadius: {
        bubble: '18px',
      },
      fontSize: {
        msg: '15px',
        meta: '11px',
      },
    },
  },
  plugins: [],
};
