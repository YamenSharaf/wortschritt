import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev: forward API calls to the Fastify server.
      "/api": "http://localhost:3000",
    },
  },
  build: {
    // The app's build (VITE_TARGET=native) goes into the APK, never into the
    // dist the server serves.
    outDir: process.env.VITE_TARGET === "native" ? "dist-native" : "dist",
  },
});
