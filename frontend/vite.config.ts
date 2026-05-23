import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// FastAPI proxies /api/* during `npm run dev`. The dev server runs on :5173;
// the user starts FastAPI separately with `pgdp-prep --frontend-dev http://localhost:5173`.
//
// Vitest configuration lives in `vitest.config.ts` (sibling) rather than
// inline here — vitest 2.x bundles its own Vite which conflicts with the
// project's Vite 6 type-wise. The runtime is fine, but tsc -b chokes; a
// separate file sidesteps the type collision cleanly.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8765",
      "/cdn": "http://localhost:8765",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Source maps expose original TypeScript/React source in production builds.
    // Only emit them in non-production environments (e.g. local dev builds).
    sourcemap: process.env["NODE_ENV"] !== "production",
  },
});
