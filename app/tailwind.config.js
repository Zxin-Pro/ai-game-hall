/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // 深色优先：夜里一盏不刺眼的灯
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
        warm: '#ffc46b',
        mint: '#5ee0a8',
        sky: '#5fd0f5',
        rose: '#ff8fb1',
        danger: '#ff6b6b',
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
