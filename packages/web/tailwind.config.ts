import type { Config } from "tailwindcss";

// Custom dark-mode palette: softer than Tailwind defaults.
// Components use `dark:*-neutral-*` (light mode uses `gray-*`/`white`),
// so overriding `neutral` only affects dark mode. Goals: lift bg-950 off
// pure black, give cards a clearer step from the page, dial back
// foreground contrast slightly, add subtle indigo-leaning warmth.
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neutral: {
          50: "#fafbfc",
          100: "#f4f5f8",
          200: "#e3e4ea",
          300: "#c4c6cd",
          400: "#a1a3aa",
          500: "#7e8088",
          600: "#5b5d65",
          700: "#494a52",
          800: "#3a3b42",
          900: "#34353d",
          950: "#28292f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
