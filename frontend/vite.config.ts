/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Docker networking note: the frontend and backend are separate containers.
// The Vite dev server proxies /api/* to the backend service by its Compose
// service name ("backend"), so the browser only ever talks to one origin
// and never needs to know the backend's container hostname.
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
        target: "http://backend:4000",
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
