import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8081",
      "/auth": "http://localhost:8081",
      "/admin": "http://localhost:8081",
      "/.well-known": "http://localhost:8081",
      "/healthz": "http://localhost:8081",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
