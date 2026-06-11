/**
 * Shim: react/jsx-dev-runtime → react/jsx-runtime
 *
 * pdomain-ui dist files (built in React 18 dev mode) import jsxDEV from
 * react/jsx-dev-runtime. In a production React 19 build:
 *   - react/jsx-dev-runtime exists but exports jsxDEV = void 0
 *   - Calling jsxDEV(...) crashes with "oe.jsxDEV is not a function"
 *
 * This shim re-exports jsx as jsxDEV so pdomain-ui components render without
 * the source-location metadata that jsxDEV normally provides (dev-only anyway).
 *
 * Wire via vite.config.ts resolve.alias:
 *   "react/jsx-dev-runtime": path.resolve(__dirname, "src/shims/jsx-dev-runtime")
 *
 * Pending fix upstream in pdomain-ui (should mark react/jsx-dev-runtime as
 * rollupOptions.external in its vite.config).
 */
export { Fragment, jsx as jsxDEV, jsx, jsxs } from "react/jsx-runtime";
