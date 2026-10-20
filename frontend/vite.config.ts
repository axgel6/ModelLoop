import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { festiveThemes } from "./festive-themes";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      // Builds each festive theme's colours from its base theme's rules (see festive-themes.ts)
      plugins: [festiveThemes()],
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
});
