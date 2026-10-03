/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        page: v('page'),
        surface: v('surface'),
        sunken: v('sunken'),
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3') },
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        accent: { DEFAULT: v('accent'), ink: v('accent-ink'), soft: v('accent-soft') },
        good: v('good'),
        warn: v('warn'),
        bad: v('bad'),
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};
