// Vitest config kept separate from vite.config.ts — vitest 2.x bundles its
// own Vite which collides with the project's Vite 6 typings if we put a
// `test` block on the shared config. Runtime behaviour is identical to
// inlining; this just keeps tsc -b happy.
//
// We intentionally do NOT load `@vitejs/plugin-react` here: the plugin is
// typed against the project's Vite 6 and re-introduces the type-collision
// we're avoiding. Vitest's esbuild transform handles `.tsx` JSX out of the
// box, which is sufficient for unit + Testing-Library tests. If a future
// test needs the full React plugin (Fast Refresh, JSX runtime quirks),
// switch this file to use `mergeConfig` from vitest/config and import
// vite.config.ts.
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // tsconfig-paths plugin runs at module-resolution time so test files
  // can use the same `@/*` aliases as production code without importing
  // vite.config.ts (which would re-trigger the Vite 6 / Vitest 2
  // type-collision documented above).
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Match *.test.ts(x) / *.spec.ts(x) under src/.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  esbuild: {
    jsx: "automatic",
  },
});
