/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          charcoal: '#4F5051',
          blue: '#7DBCE2',
          white: '#FFFFFF',
          'light-grey': '#F8F9FA',
        },
      },
      fontFamily: {
        sans: ['System'],
        mono: ['monospace'],
      },
    },
  },
  plugins: [],
};