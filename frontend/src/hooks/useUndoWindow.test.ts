/**
 * Tests for the `useUndoWindow` hook — the persistent "Restore last delete"
 * window for word deletes (spec: docs/specs/2026-05-13-word-delete-undo-design.md).
 *
 * Strategy (a) — server-side restore banner. The word delete is persisted
 * immediately via the soft-delete endpoint; this hook only tracks the most
 * recent delete batch so the UI can offer a persistent "Restore last delete"
 * banner. There is NO countdown and NO expiry timer — the banner stays open
 * until the proofer restores, dismisses, or supersedes it with another delete.
 *
 * State transitions covered:
 *   null → open        (openWindow)
 *   open → undo        (Ctrl+Z / Restore button)
 *   open → confirm     (dismiss/✕ button clicked)
 *   open → commitNow   (caller closes on unmount / route change)
 *   double-delete      (second delete supersedes the first batch)
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useUndoWindow } from "./useUndoWindow";

describe("useUndoWindow", () => {
  const makeWord = (id: string, left: number) => ({
    id,
    text: id,
    confidence: 0.9,
    bounding_box: { left, top: 0, width: 50, height: 20 },
  });

  it("initially has no open window", () => {
    const { result } = renderHook(() => useUndoWindow());
    expect(result.current.window).toBeNull();
  });

  describe("open → undo transition", () => {
    it("restores words and closes the window on undo", () => {
      const { result } = renderHook(() => useUndoWindow());
      const words = [makeWord("w1", 0), makeWord("w2", 60)];

      act(() => {
        result.current.openWindow(["w1", "w2"], words);
      });

      expect(result.current.window).not.toBeNull();
      expect(result.current.window?.wordIds).toEqual(["w1", "w2"]);

      let restoredWords: typeof words | null = null;
      act(() => {
        restoredWords = result.current.undo();
      });

      expect(restoredWords).toEqual(words);
      expect(result.current.window).toBeNull();
    });

    it("returns null from undo when no window is open", () => {
      const { result } = renderHook(() => useUndoWindow());
      let restoredWords: unknown;
      act(() => {
        restoredWords = result.current.undo();
      });
      expect(restoredWords).toBeNull();
    });
  });

  describe("no expiry — the banner is persistent", () => {
    it("window stays open indefinitely (no countdown timer)", () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useUndoWindow());
        act(() => {
          result.current.openWindow(["w3"], [makeWord("w3", 0)]);
        });

        expect(result.current.window).not.toBeNull();

        // Advance well past the old 5-second window — it must NOT close.
        act(() => {
          vi.advanceTimersByTime(60_000);
        });
        expect(result.current.window).not.toBeNull();
        expect(result.current.window?.wordIds).toEqual(["w3"]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("open → confirm (dismiss)", () => {
    it("closes the window when confirm is called", () => {
      const { result } = renderHook(() => useUndoWindow());
      act(() => {
        result.current.openWindow(["w4"], [makeWord("w4", 0)]);
      });
      act(() => {
        result.current.confirm();
      });
      expect(result.current.window).toBeNull();
    });

    it("confirm is a no-op when no window is open", () => {
      const { result } = renderHook(() => useUndoWindow());
      act(() => {
        result.current.confirm();
      });
      expect(result.current.window).toBeNull();
    });
  });

  describe("open → commitNow (navigate-away close)", () => {
    it("commitNow closes the window", () => {
      const { result } = renderHook(() => useUndoWindow());
      act(() => {
        result.current.openWindow(["w5"], [makeWord("w5", 0)]);
      });
      act(() => {
        result.current.commitNow();
      });
      expect(result.current.window).toBeNull();
    });
  });

  describe("double-delete: second delete supersedes first", () => {
    it("replaces the first batch with the second", () => {
      const { result } = renderHook(() => useUndoWindow());
      const words1 = [makeWord("w_a", 0)];
      const words2 = [makeWord("w_b", 60)];

      act(() => {
        result.current.openWindow(["w_a"], words1);
      });
      expect(result.current.window?.wordIds).toEqual(["w_a"]);

      act(() => {
        result.current.openWindow(["w_b"], words2);
      });
      expect(result.current.window?.wordIds).toEqual(["w_b"]);
    });

    it("undo restores the second batch words after double-delete", () => {
      const { result } = renderHook(() => useUndoWindow());
      const words1 = [makeWord("w_a", 0)];
      const words2 = [makeWord("w_b", 60)];

      act(() => {
        result.current.openWindow(["w_a"], words1);
      });
      act(() => {
        result.current.openWindow(["w_b"], words2);
      });

      let restored: typeof words2 | null = null;
      act(() => {
        restored = result.current.undo();
      });
      expect(restored).toEqual(words2);
    });
  });
});
