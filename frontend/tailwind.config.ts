import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: '#f8f6f2',
        sand: '#ece3d4',
        charcoal: '#2a2622',
        gold: '#b58a4c',
        ink: '#121212',
      },
      boxShadow: {
        luxe: '0 18px 50px rgba(18, 18, 18, 0.08)',
      },
      letterSpacing: {
        luxe: '0.18em',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
