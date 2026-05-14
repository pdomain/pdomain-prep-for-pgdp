/**
 * useUndoWindow — manages the 5-second debounced undo window for word deletes.
 *
 * Spec: docs/specs/2026-05-13-word-delete-undo-design.md
 *
 * State machine:
 *   null → open  (openWindow)
 *   open → null  (undo, confirm, commitNow, or 5 s expiry)
 *
 * The hook returns:
 *   - `window`: the current undo window state, or null if no window is open.
 *   - `openWindow(wordIds, words, onCommit)`: open a new undo window. If one
 *     is already open, it commits the first batch immediately (double-delete
 *     policy), then opens a new window for the new batch. Returns the
 *     `AbortController` signal that the caller should pass to the DELETE
 *     mutation so the mutation can be cancelled on undo.
 *   - `undo()`: cancel the pending DELETE, restore the saved words, and close
 *     the window. Returns the words to restore, or null if no window is open.
 *   - `confirm()`: commit the pending DELETE immediately (fire onCommit) and
 *     close the window. Equivalent to the ✕ / Confirm button.
 *   - `commitNow()`: commit without aborting — used for navigate-away cleanup
 *     (route change, useEffect cleanup).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const UNDO_WINDOW_MS = 5_000;
const TICK_MS = 100; // countdown granularity

export interface OcrWordLike {
  id: string;
  text: string;
  confidence: number;
  bounding_box: { left: number; top: number; width: number; height: number };
}

export interface UndoWindowState {
  /** IDs of the words that were deleted and could be restored. */
  wordIds: string[];
  /** Full word objects saved for restoration. */
  words: OcrWordLike[];
  /** Milliseconds remaining in the undo window. */
  remainingMs: number;
}

interface InternalWindow extends UndoWindowState {
  controller: AbortController;
  onCommit: () => void;
  expiryTimer: ReturnType<typeof setTimeout>;
  tickTimer: ReturnType<typeof setInterval>;
}

export interface UndoWindowHook {
  window: UndoWindowState | null;
  openWindow: (
    wordIds: string[],
    words: OcrWordLike[],
    onCommit: () => void,
  ) => { signal: AbortSignal };
  undo: () => OcrWordLike[] | null;
  confirm: () => void;
  commitNow: () => void;
}

export function useUndoWindow(): UndoWindowHook {
  const [windowState, setWindowState] = useState<UndoWindowState | null>(null);
  // Keep the full internal state in a ref so callbacks never capture stale
  // closures; the ref is the single source of truth for the timers /
  // AbortController. The React state (windowState) is derived from it for
  // re-render purposes.
  const internalRef = useRef<InternalWindow | null>(null);

  const _clearInternal = useCallback(() => {
    if (internalRef.current) {
      clearTimeout(internalRef.current.expiryTimer);
      clearInterval(internalRef.current.tickTimer);
      internalRef.current = null;
    }
    setWindowState(null);
  }, []);

  // Commit the current batch (fire onCommit, do NOT abort the signal).
  const _commit = useCallback(() => {
    if (!internalRef.current) return;
    internalRef.current.onCommit();
    _clearInternal();
  }, [_clearInternal]);

  const openWindow = useCallback(
    (
      wordIds: string[],
      words: OcrWordLike[],
      onCommit: () => void,
    ): { signal: AbortSignal } => {
      // Double-delete: commit any existing window immediately.
      if (internalRef.current) {
        internalRef.current.onCommit();
        clearTimeout(internalRef.current.expiryTimer);
        clearInterval(internalRef.current.tickTimer);
        internalRef.current = null;
      }

      const controller = new AbortController();

      const expiryTimer = setTimeout(() => {
        onCommit();
        _clearInternal();
      }, UNDO_WINDOW_MS);

      let remaining = UNDO_WINDOW_MS;
      const tickTimer = setInterval(() => {
        remaining -= TICK_MS;
        const clamped = Math.max(0, remaining);
        if (internalRef.current) {
          internalRef.current.remainingMs = clamped;
        }
        setWindowState((prev) =>
          prev ? { ...prev, remainingMs: clamped } : prev,
        );
      }, TICK_MS);

      const internal: InternalWindow = {
        wordIds,
        words,
        remainingMs: UNDO_WINDOW_MS,
        controller,
        onCommit,
        expiryTimer,
        tickTimer,
      };
      internalRef.current = internal;
      setWindowState({ wordIds, words, remainingMs: UNDO_WINDOW_MS });

      return { signal: controller.signal };
    },
    [_clearInternal],
  );

  const undo = useCallback((): OcrWordLike[] | null => {
    if (!internalRef.current) return null;
    const { words, controller } = internalRef.current;
    controller.abort();
    _clearInternal();
    return words;
  }, [_clearInternal]);

  const confirm = useCallback(() => {
    if (!internalRef.current) return;
    _commit();
  }, [_commit]);

  const commitNow = useCallback(() => {
    if (!internalRef.current) return;
    _commit();
  }, [_commit]);

  // Cleanup on unmount — commits any pending window so words aren't lost.
  useEffect(() => {
    return () => {
      if (internalRef.current) {
        internalRef.current.onCommit();
        clearTimeout(internalRef.current.expiryTimer);
        clearInterval(internalRef.current.tickTimer);
        internalRef.current = null;
      }
    };
  }, []);

  return { window: windowState, openWindow, undo, confirm, commitNow };
}
