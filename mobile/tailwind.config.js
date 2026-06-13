/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"], // <-- Mudou aqui
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
};
