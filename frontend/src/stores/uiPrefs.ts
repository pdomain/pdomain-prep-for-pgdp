// uiPrefs.ts — UI preferences store (theme only).
//
// Phase 2.5 (ocr-container-meta#266): migrated from hand-rolled Zustand
// `create` + `persist` middleware to Zustand's vanilla `createStore`.
// External API (`useUiPrefs` store object, hook-compatible surface) is
// preserved so consuming components (UserMenu, App.tsx) need no changes.
//
// Phase 2.7c (ocr-container-meta#330): removed searchOpen/setSearchOpen from
// this store. searchOpen is transient UI state (not a preference); it now
// lives as local React state in App.tsx. The store is now theme-only.
//
// GAP-5: Cannot use pd-ui's `createUIPrefsStore()` factory yet.
//   Sub-gap RESOLVED by Phase 2.7b: async load/persistCommon/persistApp
//     callbacks are now wired to real pd-ocr-ops routes in App.tsx.
//   Remaining blockers:
//     - pd-ui's UIPrefs.theme is 'dark' | 'light' only — no 'system' variant.
//       The local store supports 'system' (via prefers-color-scheme); the
//       AppShell receives the resolved effective value (Phase 2.7a fix).
//   Replace with pd-ui factory when: the factory gains 'system' theme support.
//
// Phase 2.4 GAP-2/GAP-3 reconciliation:
//   App.tsx's UI_PREFS_CONFIG.load() reads from the same localStorage key
//   (pgdp.uiPrefs) to seed the pd-ui AppShell store. With Phase 2.5 the
//   local store writes theme directly to that key as a plain string (not
//   wrapped in zustand persist's {state:{theme}} envelope).
//   GAP-2/GAP-3 comments in App.tsx remain until server-side persistence
//   is wired via pd-ocr-ops (resolved in Phase 2.7b — UI_PREFS_CONFIG now
//   calls real endpoints).

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
}));

/**
 * useUiPrefs — UI preferences store (theme only).
 *
 * Exposes the same Zustand-hook-compatible surface as the pre-Phase-2.5 store
 * (getState, setState, subscribe, getState().setTheme) so consuming components
 * (UserMenu, App.tsx) remain unchanged.
 *
 * Also callable as a hook — `useUiPrefs()` returns the full state:
 *   const { theme, setTheme } = useUiPrefs();
 */
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
