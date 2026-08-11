import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed port and does not want vite obscuring rust errors.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    watch: {
      // src-tauri is watched by cargo, not vite.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // WebView2 on Windows 10+ is evergreen Chromium.
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        // The transparent desktop overlay (the character).
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        // The compact settings window.
        settings: fileURLToPath(new URL("./settings.html", import.meta.url)),
      },
    },
  },
});
