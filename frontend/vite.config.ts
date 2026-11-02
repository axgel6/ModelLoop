/// <reference types="vitest/config" />
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
  test: {
    // Components and hooks need a DOM; the speech engine is faked per test (src/test/speech.ts)
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    // React's production build has no act(), so tests run as "test" even from a shell that has
    // NODE_ENV=production set
    env: { NODE_ENV: "test" },
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
