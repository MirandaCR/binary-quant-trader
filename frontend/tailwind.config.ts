import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base:    "#000000",
          surface: "#0a0a0a",
          raised:  "#141414",
          border:  "#262626",
        },
        brand: {
          DEFAULT: "#b026ff",
          dim:     "#8a1cc4",
          glow:    "rgba(176,38,255,0.15)",
        },
        profit: {
          DEFAULT: "#10b981",
          dim:     "#065f46",
          glow:    "rgba(16,185,129,0.15)",
        },
        loss: {
          DEFAULT: "#ef4444",
          dim:     "#7f1d1d",
          glow:    "rgba(239,68,68,0.15)",
        },
        neutral: {
          DEFAULT: "#f59e0b",
          dim:     "#78350f",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "blink":      "blink 1s step-end infinite",
        "slide-up":   "slideUp 0.3s ease-out",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%":       { opacity: "0" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      boxShadow: {
        glow:        "0 0 20px rgba(176,38,255,0.2)",
        "glow-sm":   "0 0 8px rgba(176,38,255,0.15)",
        "profit":    "0 0 12px rgba(16,185,129,0.3)",
        "loss":      "0 0 12px rgba(239,68,68,0.3)",
      },
    },
  },
  plugins: [],
};

export default config;
