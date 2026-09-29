/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Docker networking note: inside docker-compose, the frontend and backend
// are separate containers, and the Vite dev server proxies /api/* to the
// backend by its Compose service name ("backend") -- docker-compose.yml
// sets VITE_DEV_API_PROXY_TARGET=http://backend:4000 for exactly that case.
// Running `npm run dev` natively (no Docker) has no such hostname to
// resolve, so this defaults to localhost:4000 instead.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // No rewrite: the backend serves every route under /api itself now,
      // so /api/* in maps straight to /api/* on the backend. S-20 serves the
      // built frontend with no Vite dev server, so nothing here can rely on
      // path rewriting to make routes line up.
      "/api": {
        target: process.env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
