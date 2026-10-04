/** @type {import('tailwindcss').Config} */
const token = name => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  // The theme is a class on <html> (or any subtree), never the phone's
  // setting: the admin chooses light or dark in Plus → Apparence.
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        border: token('border'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        'ink-3': token('ink-3'),
        primary: { DEFAULT: token('primary'), hover: token('primary-hover'), soft: token('primary-soft') },
        accent: { DEFAULT: token('accent'), soft: token('accent-soft') },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
      },
      borderRadius: {
        card: '1rem',
        tile: '0.75rem',
        pill: '9999px',
      },
      maxWidth: {
        page: '72rem',
      },
    },
  },
  plugins: [],
}
