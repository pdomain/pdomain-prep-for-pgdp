import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

// FastAPI proxies /api/* during `npm run dev`. The dev server runs on :5173;
// the user starts FastAPI separately with `pgdp-prep --frontend-dev http://localhost:5173`.
//
// Vitest configuration lives in `vitest.config.ts` (sibling) rather than
// inline here — vitest 2.x bundles its own Vite which conflicts with the
// project's Vite 6 type-wise. The runtime is fine, but tsc -b chokes; a
// separate file sidesteps the type collision cleanly.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // pdomain-ui dist files import from react/jsx-dev-runtime (built in React 18
  // dev mode). In production React 19, react/jsx-dev-runtime exists but
  // exports jsxDEV = void 0 → runtime crash "oe.jsxDEV is not a function".
  //
  // A local shim re-exports jsx as jsxDEV so third-party dist files using
  // jsxDEV render correctly without the source-location metadata (dev-only).
  //
  // Pending fix upstream in pdomain-ui: mark react/jsx-dev-runtime as
  // rollupOptions.external so consumers control which React runtime they use.
  resolve: {
    alias: {
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "src/shims/jsx-dev-runtime.ts",
      ),
    },
  },
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
