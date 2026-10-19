import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { halloweenTheme } from "./halloween-theme";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      // Builds the Halloween theme's colours from Frost's rules (see halloween-theme.ts)
      plugins: [halloweenTheme()],
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
