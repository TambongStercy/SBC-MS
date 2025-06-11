/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx}', // This typically covers most JS/TS source files
    './src/views/**/*.ejs',      // Scan EJS files in the views directory
    './public/index.html',
    // Add any other paths where you use Tailwind classes (e.g., public/*.html)
    // './public/**/*.html', 
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

