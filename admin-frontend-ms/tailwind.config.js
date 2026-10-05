/** @type {import('tailwindcss').Config} */
export default {
  // Dark styles follow the app's own theme (a class on <html>), never the
  // phone's setting: otherwise cards turned white inside the dark admin.
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}