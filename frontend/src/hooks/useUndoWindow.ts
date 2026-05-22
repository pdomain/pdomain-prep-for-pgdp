/**
 * useUndoWindow — tracks the most-recent word-delete batch so the UI can
 * offer a persistent "Restore last delete" banner.
 *
 * Spec: docs/specs/2026-05-13-word-delete-undo-design.md
 *
 * Strategy (a) — server-side restore banner. The word delete is persisted
 * immediately via the soft-delete endpoint (`OcrWord.deleted = True`). This
 * hook does NOT delay or debounce the DELETE; it only remembers which words
 * were deleted so a "Restore last delete" banner can flip them back via the
 * restore endpoint.
 *
 * There is NO countdown and NO expiry timer. The banner stays open until the
 * proofer:
 *   - restores the words (`undo`),
 *   - dismisses the banner (`confirm`),
 *   - navigates away (`commitNow`, fired by the caller's unmount cleanup), or
 *   - supersedes it with another delete (`openWindow` again).
 *
 * State machine:
 *   null → open  (openWindow)
 *   open → null  (undo, confirm, commitNow, or a superseding openWindow)
 *
 * The hook returns:
 *   - `window`: the current restore-banner state, or null if none is open.
 *   - `openWindow(wordIds, words)`: open a new restore banner. If one is
 *     already open, it is silently replaced (the prior delete is already
 *     persisted server-side; only the most recent batch is restorable).
 *   - `undo()`: close the banner and return the saved words so the caller
 *     can call the restore endpoint. Returns null if no banner is open.
 *   - `confirm()`: close the banner without restoring. The ✕ / dismiss button.
 *   - `commitNow()`: same as confirm — close the banner. Used for
 *     navigate-away cleanup so the banner does not leak across pages.
 */

import { useCallback, useRef, useState } from "react";

interface OcrWordLike {
  id: string;
  text: string;
  confidence: number;
  bounding_box: { left: number; top: number; width: number; height: number };
}

interface UndoWindowState {
  /** IDs of the words that were deleted and could be restored. */
  wordIds: string[];
  /** Full word objects saved for restoration. */
  words: OcrWordLike[];
}

export interface UndoWindowHook {
  window: UndoWindowState | null;
  openWindow: (wordIds: string[], words: OcrWordLike[]) => void;
  undo: () => OcrWordLike[] | null;
  confirm: () => void;
  commitNow: () => void;
}

export function useUndoWindow(): UndoWindowHook {
  const [windowState, setWindowState] = useState<UndoWindowState | null>(null);
  // Mirror of `windowState` kept in a ref so `undo()` can read the current
  // batch synchronously and return it in the same tick — `useState` updater
  // functions do not run synchronously inside the setter call.
  const stateRef = useRef<UndoWindowState | null>(null);

  const openWindow = useCallback(
    (wordIds: string[], words: OcrWordLike[]): void => {
      // A second delete simply replaces the banner — the prior delete is
      // already persisted server-side, and only the most recent batch is
      // offered for restore.
      const next = { wordIds, words };
      stateRef.current = next;
      setWindowState(next);
    },
    [],
  );

  const undo = useCallback((): OcrWordLike[] | null => {
    const saved = stateRef.current ? stateRef.current.words : null;
    stateRef.current = null;
    setWindowState(null);
    return saved;
  }, []);

  const confirm = useCallback(() => {
    stateRef.current = null;
    setWindowState(null);
  }, []);

  // commitNow is identical to confirm in the server-side-restore model —
  // the DELETE is already persisted, so navigate-away just closes the banner.
  const commitNow = confirm;

  return { window: windowState, openWindow, undo, confirm, commitNow };
}
