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
    outDir: "dist",
  },
});
