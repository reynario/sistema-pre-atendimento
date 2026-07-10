/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pine: {
          DEFAULT: "#1F6E5C",
          strong: "#144F42",
          tint: "#E1EEE8",
        },
        marigold: {
          DEFAULT: "#D98A22",
          fill: "#F0A63E",
          tint: "#FBEAD1",
        },
        brick: {
          DEFAULT: "#B14732",
          tint: "#F6E1DC",
        },
        ground: "#EEF1EC",
        surface: "#FBFBF8",
        "surface-2": "#F3F5F0",
        ink: "#14211D",
        "ink-muted": "#57655F",
        "ink-faint": "#8B978F",
      },
      fontFamily: {
        sans: ["Work Sans", "system-ui", "sans-serif"],
        display: ["Unbounded", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
