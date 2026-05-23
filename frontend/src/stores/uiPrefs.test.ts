// uiPrefs.test.ts — Phase 2.7c store tests.
//
// Phase 2.7c (#330): searchOpen state moved to local React state in App.tsx;
// the store is now theme-only. searchOpen tests removed; store is now a
// pure UI-prefs store with theme, localStorage persistence, and OS-aware
// system mode.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUiPrefs, THEME_STORAGE_KEY } from "./uiPrefs";

describe("useUiPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store state directly (only theme now — searchOpen removed).
    useUiPrefs.setState({ theme: "light" });
    // Remove DOM attribute set by previous test's applyTheme.
    document.documentElement.removeAttribute("data-theme");
  });

  it("default theme is light", () => {
    expect(useUiPrefs.getState().theme).toBe("light");
  });

  it("setTheme updates the theme", () => {
    useUiPrefs.getState().setTheme("dark");
    expect(useUiPrefs.getState().theme).toBe("dark");
  });

  it("setTheme accepts system", () => {
    useUiPrefs.getState().setTheme("system");
    expect(useUiPrefs.getState().theme).toBe("system");
  });

  describe("persistence (localStorage)", () => {
    it("persists theme to localStorage after setTheme (bare string, not envelope)", () => {
      useUiPrefs.getState().setTheme("dark");
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      expect(stored).toBe("dark");
    });

    it("persists 'light' theme", () => {
      useUiPrefs.getState().setTheme("light");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    });

    it("persists 'system' theme", () => {
      useUiPrefs.getState().setTheme("system");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    });
  });

  describe("document.documentElement [data-theme] attribute", () => {
    it("sets data-theme to dark after setTheme('dark')", () => {
      useUiPrefs.getState().setTheme("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });

    it("sets data-theme to light after setTheme('light')", () => {
      useUiPrefs.getState().setTheme("dark");
      useUiPrefs.getState().setTheme("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("resolves system theme via matchMedia (dark OS)", () => {
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query === "(prefers-color-scheme: dark)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      useUiPrefs.getState().setTheme("system");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      vi.restoreAllMocks();
    });

    it("resolves system theme via matchMedia (light OS)", () => {
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      useUiPrefs.getState().setTheme("system");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      vi.restoreAllMocks();
    });
  });
});
