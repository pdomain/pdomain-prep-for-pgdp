// uiPrefs.ts — UI preferences store (theme, searchOpen).
//
// Phase 2.5 (ocr-container-meta#266): migrated from hand-rolled Zustand
// `create` + `persist` middleware to Zustand's vanilla `createStore`.
// External API (`useUiPrefs` store object, hook-compatible surface) is
// preserved so consuming components (SearchModal, App.tsx) need no changes.
//
// GAP-5: Cannot use pd-ui's `createUIPrefsStore()` factory yet.
//   pd-ui's factory:
//     - Requires async load/persistCommon/persistApp callbacks (designed
//       for the future pd-suite prefs API, §3.2 of cross-cut-design spec).
//     - Models `theme` as 'dark' | 'light' only — no 'system' variant.
//   This store needs:
//     - Synchronous in-memory state with manual localStorage persistence
//       for theme (key: "pgdp.uiPrefs").
//     - 'system' theme variant that resolves via prefers-color-scheme media
//       query and listens for OS-level changes.
//     - App-specific `searchOpen` state (not part of UIPrefs schema).
//   Replace with pd-ui factory when: the factory gains 'system' theme
//   support AND the pd-suite prefs API is wired via pd-ocr-ops routes.
//
// Phase 2.4 GAP-2/GAP-3 reconciliation:
//   App.tsx's UI_PREFS_CONFIG.load() read from the same localStorage key
//   (pgdp.uiPrefs) to seed the pd-ui AppShell store. With Phase 2.5 the
//   local store now writes theme directly to that key as a plain string
//   (not wrapped in zustand persist's {state:{theme}} envelope). The
//   UI_PREFS_CONFIG shim in App.tsx is updated accordingly.
//   GAP-2/GAP-3 comments in App.tsx remain until server-side persistence
//   is wired via pd-ocr-ops.

import { createStore } from "zustand/vanilla";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

/** localStorage key for theme persistence. Matches the persist key used pre-Phase 2.5. */
export const THEME_STORAGE_KEY = "pgdp.uiPrefs";

const VALID_THEME_VALUES = new Set<string>(["dark", "light", "system"]);

// ── Theme helpers ────────────────────────────────────────────────────────────

/** Read theme preference from localStorage; fall back to "light". */
function readPersistedTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && VALID_THEME_VALUES.has(raw)) return raw as Theme;
  } catch {
    // localStorage unavailable (SSR, private mode)
  }
  return "light";
}

/** Write theme preference to localStorage. */
function writePersistedTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

/**
 * Resolve the effective (dark|light) theme by applying prefers-color-scheme
 * when theme is 'system'.
 */
function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  }
  return theme;
}

/** Apply the effective theme to `document.documentElement[data-theme]`. */
function applyTheme(theme: Theme): void {
  try {
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
  } catch {
    // no document in test env without jsdom — handled by tests separately
  }
}

// ── Media-query listener for system mode ─────────────────────────────────────
let _mediaQueryCleanup: (() => void) | null = null;

function setupSystemListener(theme: Theme, notifyFn: () => void): void {
  if (_mediaQueryCleanup) {
    _mediaQueryCleanup();
    _mediaQueryCleanup = null;
  }
  if (theme === "system") {
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        applyTheme("system");
        notifyFn();
      };
      mq.addEventListener("change", handler);
      _mediaQueryCleanup = () => mq.removeEventListener("change", handler);
    } catch {
      // not available
    }
  }
}

// ── Store state ──────────────────────────────────────────────────────────────

interface UiPrefsState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
}

const _store = createStore<UiPrefsState>()((set) => ({
  theme: readPersistedTheme(),
  setTheme: (theme: Theme) => {
    writePersistedTheme(theme);
    set({ theme });
    setupSystemListener(theme, () => {
      // Nudge subscribers when OS theme changes while 'system' is selected.
      set((s) => ({ ...s }));
    });
    applyTheme(theme);
  },

  // GAP-5: searchOpen is app-local state — not part of pd-ui's UIPrefs schema.
  // Keep here until pd-ui's factory gains an app-prefs slot and pd-prep-for-pgdp
  // migrates searchOpen into UIPrefs.app.
  searchOpen: false,
  setSearchOpen: (searchOpen: boolean) => set({ searchOpen }),
}));

/**
 * useUiPrefs — UI preferences store.
 *
 * Exposes the same Zustand-hook-compatible surface as the pre-Phase-2.5 store
 * (getState, setState, subscribe, getState().setTheme, getState().setSearchOpen)
 * so all call sites (SearchModal, App.tsx) remain unchanged.
 *
 * Also callable as a hook — `useUiPrefs()` returns the full state, matching
 * the Zustand bound-store API that callers like `App.tsx` expect:
 *   const { setSearchOpen } = useUiPrefs();
 */
export function useUiPrefs(): UiPrefsState;
export function useUiPrefs(
  selector: undefined,
  equals: undefined,
): UiPrefsState;
export function useUiPrefs(): UiPrefsState {
  return useSyncExternalStore(
    _store.subscribe,
    _store.getState,
    _store.getState,
  );
}

// Expose store internals so components that call useUiPrefs.getState() /
// useUiPrefs.setState() / useUiPrefs.subscribe() continue to work.
// (Pre-Phase-2.5 the store was a zustand bound store which had these on the
// hook function object itself.)
useUiPrefs.getState = _store.getState;
useUiPrefs.setState = (
  arg:
    | Partial<UiPrefsState>
    | ((s: UiPrefsState) => Partial<UiPrefsState>)
    | UiPrefsState,
): void => {
  const patch = typeof arg === "function" ? arg(_store.getState()) : arg;
  _store.setState((s) => ({ ...s, ...patch }));
};
useUiPrefs.subscribe = _store.subscribe;

// Apply initial theme on module load (so first render matches localStorage).
applyTheme(useUiPrefs.getState().theme);
