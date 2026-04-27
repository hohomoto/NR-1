import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0b',
        panel: '#111114',
        border: '#1e1e24',
        'border-bright': '#2e2e38',
        'text-primary': '#e5e5e5',
        'text-muted': '#888888',
        'text-dim': '#444444',
        amber: '#f59e0b',
        green: '#22c55e',
        red: '#ef4444',
        blue: '#3b82f6',
        'amber-dim': '#78490a',
        'green-dim': '#14532d',
        'red-dim': '#7f1d1d',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '2px',
        sm: '2px',
        md: '2px',
        lg: '2px',
      },
    },
  },
  plugins: [],
} satisfies Config;
