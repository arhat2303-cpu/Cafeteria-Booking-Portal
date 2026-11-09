/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brs: {
          obsidian: '#0B0D11',
          card: '#13161E',
          elevated: '#191D27',
          lime: '#CCF32F',
          cyan: '#5CE1E6',
          violet: '#A78BFA',
          amber: '#FFB020',
          navy: '#13161E',
          royal: '#1C2130',
          blue: '#252C3F',
          gold: '#CCF32F',
          sand: '#1E2330',
          emerald: '#34D399',
          surface: '#0B0D11',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 8px 30px -6px rgba(0, 0, 0, 0.55)',
        elevated: '0 20px 48px -12px rgba(0, 0, 0, 0.75)',
        lime: '0 0 28px -4px rgba(204, 243, 47, 0.25)',
      },
    },
  },
  plugins: [],
};
