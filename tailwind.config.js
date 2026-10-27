/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        glass: {
          bg: "rgba(18, 18, 24, 0.75)",
          border: "rgba(255, 255, 255, 0.12)",
          panel: "rgba(28, 28, 38, 0.85)",
          accent: "#6366f1"
        }
      }
    },
  },
  plugins: [],
}
