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
          50: "#f4f5f7",
          100: "#e8e9ee",
          200: "#d9dae0",
          300: "#b8b9c3",
          400: "#9293a0",
          500: "#6e6f7a",
          600: "#4d4e58",
          700: "#3a3b44",
          800: "#2a2b32",
          900: "#1d1e23",
          950: "#15161a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
