/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090D16',
        surface: '#111827',
        'surface-elevated': '#1F2937',
        'surface-border': '#374151',
        primary: {
          DEFAULT: '#6366F1',
          hover: '#4F46E5',
          light: '#EEF2FF',
          dark: '#312E81',
        },
        monad: {
          purple: '#836EF9',
          light: '#A08FFD',
          dark: '#200052',
        },
        ausd: {
          green: '#10B981',
          light: '#D1FAE5',
          dark: '#064E3B',
        },
      },
    },
  },
  plugins: [],
};
