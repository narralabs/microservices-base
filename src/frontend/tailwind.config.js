/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.jade",
    "./public/**/*.{html,js}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#38220f',
        secondary: '#ead4c3',
        background: '#f3e7dd',
      },
      borderRadius: {
        'pill': '999px',
      },
    },
  },
  plugins: [],
}

