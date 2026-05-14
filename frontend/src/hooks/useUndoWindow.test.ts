/**
 * Tests for the `useUndoWindow` hook — the debounced 5-second undo window
 * for word deletes (spec: docs/specs/2026-05-13-word-delete-undo-design.md).
 *
 * State transitions covered:
 *   open → undo        (Ctrl+Z / undo button)
 *   open → expire      (5 s timer fires without undo)
 *   open → navigate    (caller fires commit on unmount / route change)
 *   open → confirm     (confirm/✕ button clicked early)
 *   double-delete      (second delete while window open commits first)
 *
 * AbortController:
 *   - signal is cancelled when undo is called
 *   - signal is NOT cancelled on expiry/confirm (DELETE should fire)
 *
 * Hotkey scope:
 *   - tested in TextReviewPage.test.tsx (requires component mount)
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUndoWindow } from "./useUndoWindow";

describe("useUndoWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initially has no open window", () => {
    const { result } = renderHook(() => useUndoWindow());
    expect(result.current.window).toBeNull();
  });

  describe("open → undo transition", () => {
    it("restores words and cancels the abort signal on undo", () => {
      const onCommit = vi.fn();
      const { result } = renderHook(() => useUndoWindow());

      const wordIds = ["w1", "w2"];
      const words = [
        {
          id: "w1",
          text: "alpha",
          confidence: 0.9,
          bounding_box: { left: 0, top: 0, width: 50, height: 20 },
        },
        {
          id: "w2",
          text: "beta",
          confidence: 0.9,
          bounding_box: { left: 60, top: 0, width: 50, height: 20 },
        },
      ];

      let capturedSignal: AbortSignal | undefined;
      act(() => {
        const { signal } = result.current.openWindow(wordIds, words, onCommit);
        capturedSignal = signal;
      });

      expect(result.current.window).not.toBeNull();
      expect(result.current.window?.wordIds).toEqual(["w1", "w2"]);
      expect(capturedSignal?.aborted).toBe(false);

      // Undo: signal cancelled, words returned, window closed.
      let restoredWords: typeof words | null = null;
      act(() => {
        restoredWords = result.current.undo();
      });

      expect(capturedSignal?.aborted).toBe(true);
      expect(restoredWords).toEqual(words);
      expect(result.current.window).toBeNull();
      expect(onCommit).not.toHaveBeenCalled();
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

  describe("open → expire transition", () => {
    it("calls onCommit and closes the window after 5 seconds", () => {
      const onCommit = vi.fn();
      const { result } = renderHook(() => useUndoWindow());

      const wordIds = ["w3"];
      const words = [
        {
          id: "w3",
          text: "gamma",
          confidence: 0.9,
          bounding_box: { left: 0, top: 0, width: 50, height: 20 },
        },
      ];

      let capturedSignal: AbortSignal | undefined;
      act(() => {
        const { signal } = result.current.openWindow(wordIds, words, onCommit);
        capturedSignal = signal;
      });

      expect(result.current.window).not.toBeNull();
      expect(capturedSignal?.aborted).toBe(false);

      // Advance to just before expiry — window still open.
      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expect(result.current.window).not.toBeNull();
      expect(onCommit).not.toHaveBeenCalled();

      // Advance past 5 seconds — expiry fires.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onCommit).toHaveBeenCalledOnce();
      expect(capturedSignal?.aborted).toBe(false); // DELETE should fire, not abort
      expect(result.current.window).toBeNull();
    });
  });

  describe("open → confirm (early dismiss)", () => {
    it("calls onCommit immediately and closes the window", () => {
      const onCommit = vi.fn();
      const { result } = renderHook(() => useUndoWindow());

      const wordIds = ["w4"];
      const words = [
        {
          id: "w4",
          text: "delta",
          confidence: 0.9,
          bounding_box: { left: 0, top: 0, width: 50, height: 20 },
        },
      ];

      let capturedSignal: AbortSignal | undefined;
      act(() => {
        const { signal } = result.current.openWindow(wordIds, words, onCommit);
        capturedSignal = signal;
      });

      act(() => {
        result.current.confirm();
      });

      expect(onCommit).toHaveBeenCalledOnce();
      expect(capturedSignal?.aborted).toBe(false); // DELETE should fire
      expect(result.current.window).toBeNull();
    });

    it("confirm is a no-op when no window is open", () => {
      const { result } = renderHook(() => useUndoWindow());
      // Should not throw.
      act(() => {
        result.current.confirm();
      });
    });
  });

  describe("open → navigate (commit-and-close)", () => {
    it("commitNow fires onCommit immediately without aborting the signal", () => {
      const onCommit = vi.fn();
      const { result } = renderHook(() => useUndoWindow());

      const wordIds = ["w5"];
      const words = [
        {
          id: "w5",
          text: "epsilon",
          confidence: 0.9,
          bounding_box: { left: 0, top: 0, width: 50, height: 20 },
        },
      ];

      let capturedSignal: AbortSignal | undefined;
      act(() => {
        const { signal } = result.current.openWindow(wordIds, words, onCommit);
        capturedSignal = signal;
      });

      act(() => {
        result.current.commitNow();
      });

      expect(onCommit).toHaveBeenCalledOnce();
      expect(capturedSignal?.aborted).toBe(false);
      expect(result.current.window).toBeNull();
    });
  });

  describe("double-delete: second delete commits first", () => {
    it("commits first batch and opens new window for second batch", () => {
      const onCommit1 = vi.fn();
      const onCommit2 = vi.fn();
      const { result } = renderHook(() => useUndoWindow());

      const words1 = [
        {
          id: "w_a",
          text: "a",
          confidence: 0.9,
          bounding_box: { left: 0, top: 0, width: 50, height: 20 },
        },
      ];
      const words2 = [
        {
          id: "w_b",
          text: "b",
          confidence: 0.9,
          bounding_box: { left: 60, top: 0, width: 50, height: 20 },
        },
      ];

      let signal1: AbortSignal | undefined;
      act(() => {
        const r = result.current.openWindow(["w_a"], words1, onCommit1);
        signal1 = r.signal;
      });

      expect(result.current.window?.wordIds).toEqual(["w_a"]);

      // Second delete: first batch commits, second window opens.
      let signal2: AbortSignal | undefined;
      act(() => {
        const r = result.current.openWindow(["w_b"], words2, onCommit2);
        signal2 = r.signal;
      });

      // First batch committed immediately.
      expect(onCommit1).toHaveBeenCalledOnce();
      expect(signal1?.aborted).toBe(false); // not aborted — committed

      // Second window is now open.
      expect(result.current.window?.wordIds).toEqual(["w_b"]);
      expect(signal2?.aborted).toBe(false);
      expect(onCommit2).not.toHaveBeenCalled();
    });

    it("undo restores the second batch words after double-delete", () => {
      const onCommit1 = vi.fn();
      const onCommit2 = vi.fn();
      const { result } = renderHook(() => useUndoWindow());

      const words1 = [
        {
          id: "w_a",
          text: "a",
          confidence: 0.9,
          bounding_box: { left: 0, top: 0, width: 50, height: 20 },
        },
      ];
      const words2 = [
        {
          id: "w_b",
          text: "b",
          confidence: 0.9,
          bounding_box: { left: 60, top: 0, width: 50, height: 20 },
        },
      ];

      act(() => {
        result.current.openWindow(["w_a"], words1, onCommit1);
      });
      act(() => {
        result.current.openWindow(["w_b"], words2, onCommit2);
      });

      let restored: typeof words2 | null = null;
      act(() => {
        restored = result.current.undo();
      });

      expect(restored).toEqual(words2);
      expect(onCommit2).not.toHaveBeenCalled();
    });
  });

  describe("countdown", () => {
    it("window.remainingMs decrements as time passes", () => {
      const onCommit = vi.fn();
      const { result } = renderHook(() => useUndoWindow());

      act(() => {
        result.current.openWindow(["wx"], [], onCommit);
      });

      expect(result.current.window?.remainingMs).toBe(5000);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.window?.remainingMs).toBe(4000);

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.window?.remainingMs).toBe(2000);
    });
  });
});
