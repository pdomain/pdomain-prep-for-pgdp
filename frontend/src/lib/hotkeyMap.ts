/**
 * hotkeyMap.ts — Canonical registry of keyboard shortcuts for TextReviewPage.
 *
 * Extracted from the `useHotkeys` registrations in TextReviewPage.tsx so they
 * can be displayed in the hints row (and, in the future, a hotkey help modal)
 * without duplicating the key strings.
 *
 * `keys` uses platform-neutral labels: "Mod" = Ctrl on Windows/Linux, ⌘ on Mac.
 */

export interface HotkeyEntry {
  /** Display labels for each key in the chord, e.g. ["Mod", "Z"] or ["Esc"]. */
  keys: string[];
  /** Short human description shown in the hints row. */
  description: string;
  /** Logical grouping for filtering/display. */
  section: "Navigation" | "Editing" | "View";
}

export const HOTKEY_MAP: HotkeyEntry[] = [
  // ── Editing ──────────────────────────────────────────────────────────────
  {
    keys: ["Mod", "S"],
    description: "Save",
    section: "Editing",
  },
  {
    keys: ["Del"],
    description: "Delete selected words",
    section: "Editing",
  },
  {
    keys: ["Mod", "Z"],
    description: "Restore last word delete",
    section: "Editing",
  },
  {
    keys: ["Esc"],
    description: "Clear selection",
    section: "Editing",
  },
  // ── Navigation ───────────────────────────────────────────────────────────
  {
    keys: ["←"],
    description: "Previous page",
    section: "Navigation",
  },
  {
    keys: ["→"],
    description: "Next page",
    section: "Navigation",
  },
];
