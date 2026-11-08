/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brs: {
          navy: '#0F2942',
          royal: '#163A5F',
          blue: '#1E4E79',
          gold: '#D97706',
          amber: '#F59E0B',
          sand: '#FEF3C7',
          emerald: '#059669',
          surface: '#F8FAFC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 4px 24px -4px rgba(15, 41, 66, 0.08)',
        elevated: '0 12px 36px -8px rgba(15, 41, 66, 0.14)',
      },
    },
  },
  plugins: [],
};
