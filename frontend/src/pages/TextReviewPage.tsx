import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

type PageRecord = components["schemas"]["PageRecord"];
import { FormErrorBanner } from "../components/FormErrorBanner";
import { PageHeader } from "../components/shell/PageHeader";
import { WordBboxOverlay } from "../components/WordBboxOverlay";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { KeyCap } from "../components/ui/KeyCap";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/ToggleGroup";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/Select";
import { diffLines } from "../lib/lineDiff";
import { LineDiffView } from "../lib/LineDiffView";
import { useUndoWindow } from "../hooks/useUndoWindow";
import { HOTKEY_MAP } from "../lib/hotkeyMap";
import {
  buildWordOffsetIndex,
  offsetToWord,
  wordToRange,
  type OcrWord,
} from "../lib/wordOffsets";

// §9a delete-words wire shapes — sourced from the generated OpenAPI
// types. The endpoint is the canonical contract, so any future change
// in `api/data/pages.py::DeleteWordsRequest`/`Response` flows here via
// `make openapi-export` without manual sync.
type DeleteWordsRequest = components["schemas"]["DeleteWordsRequest"];
type DeleteWordsResponse = components["schemas"]["DeleteWordsResponse"];
type RestoreWordsRequest = components["schemas"]["RestoreWordsRequest"];
type RestoreWordsResponse = components["schemas"]["RestoreWordsResponse"];

export function TextReviewPage() {
  const { projectId = "", idx0: idx0Str = "0" } = useParams();
  const idx0 = Number(idx0Str);
  const queryClient = useQueryClient();

  // Special value "__whole__" represents "whole page" (was previously "").
  // Radix Select doesn't allow empty string values, so we use this constant.
  const WHOLE_PAGE_VALUE = "__whole__";
  const [splitSuffix, setSplitSuffix] = useState<string>(WHOLE_PAGE_VALUE);
  const [text, setText] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const [words, setWords] = useState<OcrWord[]>([]);
  // §9a: words tagged for deletion, keyed by `OcrWord.id` so the wire
  // payload is trivial. Set semantics → toggling a clicked word is a
  // single membership flip; clearing on success / page change is one
  // assignment.
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Re-OCR diff (P1 #7): snapshot of `text` taken via the reocr
  // mutation's `onMutate`, kept in state until the user dismisses /
  // accepts the diff, saves the page, navigates away, or the
  // mutation fails. `null` means "no pending diff to show".
  const [priorText, setPriorText] = useState<string | null>(null);
  // "text" = normal editing view; "diff" = re-OCR diff view.
  const [viewMode, setViewMode] = useState<"text" | "diff">("text");
  // Tick 24: aria-live announcer for selection / delete state. Plain
  // string surfaced in a `role="status"` `aria-live="polite"` div so
  // screen readers narrate marquee selection size, manual clears, and
  // delete completions. Empty string = nothing to announce.
  const [liveMessage, setLiveMessage] = useState<string>("");

  // §9a-followup: persistent "Restore last delete" banner for word deletes.
  const undoWindow = useUndoWindow();

  // §9a: snapshot of words being deleted, held between deleteWords.mutate()
  // and the mutation's onSuccess so we can open the undo window there.
  const pendingDeleteRef = useRef<{ ids: string[]; words: OcrWord[] } | null>(
    null,
  );

  // Phase 2.2: imgEl ref removed — pd-ui PageImageCanvas (inside
  // WordBboxOverlay) manages the <img> element. naturalSize is still
  // tracked here so we can pass page.width/height to pd-ui's canvas;
  // we preload the image via useEffect + new Image() instead of <img onLoad>.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  const page = useQuery({
    queryKey: ["page", projectId, idx0],
    queryFn: () =>
      api.get<PageRecord>(`/api/data/projects/${projectId}/pages/${idx0}`),
  });

  const text$ = useQuery({
    enabled: !!page.data,
    queryKey: ["page-text", projectId, idx0, splitSuffix],
    queryFn: () => {
      const suffix = splitSuffix === WHOLE_PAGE_VALUE ? "_" : splitSuffix;
      return api.get<{ text: string; text_key: string; words: OcrWord[] }>(
        `/api/data/projects/${projectId}/pages/${idx0}/text/${suffix}`,
      );
    },
  });

  useEffect(() => {
    if (text$.data) {
      setText(text$.data.text);
      setWords(text$.data.words ?? []);
      setDirty(false);
      setActiveWordIndex(null);
      setSelectedWordIds(new Set());
    } else if (text$.error) {
      // 404 = no text yet (probably needs OCR first)
      setText("");
      setWords([]);
      setDirty(false);
      setActiveWordIndex(null);
      setSelectedWordIds(new Set());
    }
  }, [text$.data, text$.error]);

  useEffect(() => {
    return () => {
      if (selectDebounceRef.current) {
        clearTimeout(selectDebounceRef.current);
      }
    };
  }, []);

  // Router stays mounted on Prev/Next (only :idx0 changes), so the
  // re-OCR diff snapshot would otherwise leak across pages. Clear
  // it whenever the page identity (project / idx0 / split) changes.
  useEffect(() => {
    setPriorText(null);
  }, [projectId, idx0, splitSuffix]);

  // §9a-followup: close the restore banner on navigate-away so it does not
  // leak across pages. The delete is already persisted server-side (soft
  // delete), so this only dismisses the banner — nothing is lost. Covers the
  // Prev/Next case where :idx0 changes while this component stays mounted.
  useEffect(() => {
    return () => {
      undoWindow.commitNow();
    };
    // undoWindow is stable (returned from a hook), so this runs only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wordIndex = useMemo(
    () => buildWordOffsetIndex(text, words),
    [text, words],
  );

  // Phase 2.2: Preload the page image to discover its natural dimensions
  // so we can pass page.width/height to pd-ui's PageImageCanvas (via
  // WordBboxOverlay). We can't use <img onLoad> any more because the
  // <img> element is now managed internally by pd-ui's canvas.
  // naturalSize.w===0 means "not yet loaded" — WordBboxOverlay early-
  // returns null in that case, which is the same guard it had before.
  useEffect(() => {
    if (!page.data) return;
    const key = page.data.processed_image_key ?? page.data.thumbnail_key;
    if (!key) return;
    const url = `/cdn/${key}`;
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [page.data]);

  const save = useMutation({
    mutationFn: () => {
      const suffix = splitSuffix === WHOLE_PAGE_VALUE ? null : splitSuffix;
      return api.patch<{ text_key: string }>(
        `/api/data/projects/${projectId}/pages/${idx0}/text`,
        { split_suffix: suffix, text },
      );
    },
    onSuccess: () => {
      setDirty(false);
      // Persisting the user's edits ends the "compare against
      // prior re-OCR" workflow — the new content is now canonical.
      setPriorText(null);
      void queryClient.invalidateQueries({
        queryKey: ["page-text", projectId, idx0, splitSuffix],
      });
    },
  });

  // §9a: soft-delete the selected words server-side. The endpoint marks
  // words deleted=True (doesn't remove from storage); `remaining_words`
  // in the response is the updated list. We mirror the canonical state
  // into local `text` / `words` so the textarea and overlay refresh.
  //
  // §9a-followup: DELETE is persisted immediately. The "Restore last
  // delete" banner is opened after the server confirms and stays open
  // until the proofer restores, dismisses, or supersedes it.
  const deleteWords = useMutation({
    mutationFn: (ids: string[]) => {
      const suffix = splitSuffix === WHOLE_PAGE_VALUE ? null : splitSuffix;
      return api.delete<DeleteWordsResponse>(
        `/api/data/projects/${projectId}/pages/${idx0}/words`,
        {
          body: {
            word_ids: ids,
            split_suffix: suffix,
          } satisfies DeleteWordsRequest,
        },
      );
    },
    onSuccess: (resp) => {
      setText(resp.text);
      setWords(resp.remaining_words ?? []);
      // Server is now the source of truth — clear local edit / select
      // state so the proofer can immediately stage another batch.
      setDirty(false);
      setActiveWordIndex(null);
      setSelectedWordIds(new Set());
      const n = resp.deleted_count ?? 0;
      setLiveMessage(
        `Deleted ${n} word${n === 1 ? "" : "s"} — Restore last delete available`,
      );
      // The diff snapshot (re-OCR comparison) is a separate flow; do
      // not clear `priorText` — the user may still want to see the
      // pre-re-OCR diff after a delete.
      void queryClient.invalidateQueries({
        queryKey: ["page-text", projectId, idx0, splitSuffix],
      });
      // Open the "Restore last delete" banner after the server-confirmed
      // delete. The deletion is already persisted (soft-delete); the banner
      // only offers a restore until dismissed or superseded.
      if (pendingDeleteRef.current) {
        const { ids: pendingIds, words: snapshot } = pendingDeleteRef.current;
        pendingDeleteRef.current = null;
        undoWindow.openWindow(pendingIds, snapshot);
      }
    },
    onError: () => {
      pendingDeleteRef.current = null;
      // Soft-delete didn't happen on the server — re-fetch canonical state
      // so the optimistically-removed words reappear on the canvas.
      void queryClient.invalidateQueries({
        queryKey: ["page-text", projectId, idx0, splitSuffix],
      });
    },
  });

  // §9a: restore soft-deleted words. Calls POST .../words/restore; on
  // success mirrors the canonical server state back into local state.
  const restoreWords = useMutation({
    mutationFn: (ids: string[]) => {
      const suffix = splitSuffix === WHOLE_PAGE_VALUE ? null : splitSuffix;
      return api.post<RestoreWordsResponse>(
        `/api/data/projects/${projectId}/pages/${idx0}/words/restore`,
        {
          word_ids: ids,
          split_suffix: suffix,
        } satisfies RestoreWordsRequest,
      );
    },
    onSuccess: (resp) => {
      setText(resp.text);
      setWords(resp.remaining_words ?? []);
      setDirty(false);
      setActiveWordIndex(null);
    },
    onError: (_err, ids) => {
      // Remove the words we optimistically added back — restore failed on server.
      setWords((prev) => prev.filter((w) => !ids.includes(w.id)));
      setLiveMessage("Restore failed — please try again");
      // Re-sync with server to ensure UI matches actual state.
      void queryClient.invalidateQueries({
        queryKey: ["page-text", projectId, idx0, splitSuffix],
      });
    },
  });

  // §9a-followup: shared restore handler — called from the Ctrl+Z hotkey and
  // the banner's "Restore last delete" button. Closes the banner, re-inserts
  // the words optimistically, and POSTs to the restore endpoint to clear the
  // server-side `deleted` flag.
  const handleUndo = useCallback(() => {
    const restored = undoWindow.undo();
    if (!restored) return;
    const ids = (restored as OcrWord[]).map((w) => w.id);
    setWords((prev) => [...prev, ...(restored as OcrWord[])]);
    setLiveMessage("Restored last delete");
    restoreWords.mutate(ids);
  }, [undoWindow, restoreWords]);

  // §9a-followup: trigger a word delete.
  // 1. Optimistically remove the selected words from the canvas.
  // 2. Fire DELETE immediately (soft-delete on server).
  // 3. On server success, open the persistent "Restore last delete" banner.
  // 4. If the user restores, call restoreWords to flip the `deleted` flag.
  const triggerDeleteWithUndo = (ids: string[]) => {
    if (ids.length === 0) return;

    // Snapshot the words being deleted for potential restoration.
    const deletedWords = words.filter((w) => ids.includes(w.id));
    pendingDeleteRef.current = { ids, words: deletedWords };

    // Optimistically remove from canvas immediately.
    setWords((prev) => prev.filter((w) => !ids.includes(w.id)));
    setSelectedWordIds(new Set());
    const n = ids.length;
    setLiveMessage(`Deleting ${n} word${n === 1 ? "" : "s"}…`);

    // Fire DELETE immediately (soft-delete on server). The undo window
    // opens in the mutation's onSuccess once the server confirms.
    deleteWords.mutate(ids);
  };

  // §9a / §13a-step-2: bulk-delete + clear-selection hotkeys via
  // `react-hotkeys-hook`. The hook handles scope automatically — it
  // ignores INPUT / TEXTAREA / SELECT focus by default (see
  // `enableOnFormTags`), which gives us the same scope guard the
  // hand-rolled tagName / contentEditable check provided previously.
  // `preventDefault: true` keeps the browser from acting on Backspace
  // (back-navigation in some browsers) when the page handles it.
  // Declared after `deleteWords` because the callback closure captures
  // the mutation; flipping the order would TDZ-throw on first render.
  useHotkeys(
    "delete, backspace",
    (ev) => {
      if (selectedWordIds.size === 0) return;
      ev.preventDefault();
      triggerDeleteWithUndo(Array.from(selectedWordIds));
    },
    { preventDefault: true },
    [selectedWordIds],
  );

  // §9a-followup: Ctrl+Z / Cmd+Z restores deleted words while the "Restore
  // last delete" banner is open. Calls restoreWords to flip them back.
  // Scope: body only (react-hotkeys-hook ignores INPUT/TEXTAREA by default).
  useHotkeys(
    "mod+z",
    (ev) => {
      if (!undoWindow.window) return;
      ev.preventDefault();
      handleUndo();
    },
    [undoWindow, handleUndo],
  );
  useHotkeys(
    "escape",
    (ev) => {
      if (selectedWordIds.size === 0) return;
      ev.preventDefault();
      setSelectedWordIds(new Set());
      setLiveMessage("Cleared selection");
    },
    [selectedWordIds],
  );

  // Re-OCR using the per-stage endpoint (M6 replaces legacy /api/gpu/run-ocr-page).
  // The ocr_page stage writes the text artifact to disk; after it completes we
  // invalidate the page-text query so the useEffect below picks up the new text.
  const reocr = useMutation({
    mutationFn: () =>
      api.post(
        `/api/data/projects/${projectId}/pages/${idx0}/stages/ocr_page/run`,
        {},
      ),
    onMutate: () => {
      // Snapshot the textarea content right before the new OCR
      // result lands. Closure captures the current `text`, so
      // back-to-back re-OCR clicks always compare against the
      // text that was on screen immediately before THIS click —
      // not the very first prior-text we ever captured.
      setPriorText(text);
      setViewMode("diff");
    },
    onSuccess: () => {
      // Invalidate the text query; the useEffect on text$.data updates
      // text / words / dirty / activeWordIndex when the refetch completes.
      void queryClient.invalidateQueries({
        queryKey: ["page-text", projectId, idx0, splitSuffix],
      });
    },
    onError: () => {
      // No new text was written; nothing meaningful to diff.
      setPriorText(null);
    },
  });

  // Memoised so typing in the textarea doesn't re-run the LCS on
  // every keystroke. Only computed when a snapshot exists; the
  // empty-array fallback is cheap and keeps the render path
  // unconditional.
  const diff = useMemo(
    () => (priorText !== null ? diffLines(priorText, text) : []),
    [priorText, text],
  );
  const diffHasChanges = useMemo(
    () => diff.some((d) => d.kind !== "equal"),
    [diff],
  );

  if (page.isLoading) return <p className="text-ink-3">Loading…</p>;
  if (!page.data) return <p className="text-red-600">Page not found.</p>;

  const splits = page.data.splits as {
    suffix: string;
    reading_order: number;
  }[];
  const imageKey = page.data.processed_image_key || page.data.thumbnail_key;

  const handleTextareaSelect = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Debounce: drag-selecting fires onSelect repeatedly and would
    // thrash Konva re-renders. Coalesce to ~75ms; the bbox→textarea
    // path stays synchronous (a single click).
    const off = ta.selectionStart;
    if (selectDebounceRef.current) {
      clearTimeout(selectDebounceRef.current);
    }
    selectDebounceRef.current = setTimeout(() => {
      selectDebounceRef.current = null;
      const hit = offsetToWord(wordIndex, off);
      setActiveWordIndex(hit ? hit.wordIndex : null);
    }, 75);
  };

  const handleWordClick = (i: number) => {
    setActiveWordIndex(i);
    const r = wordToRange(wordIndex, i);
    if (r && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.setSelectionRange(r.start, r.end);
      // Best-effort scroll into view: textarea doesn't expose a
      // built-in scrollToSelection. Use the textarea's actual
      // computed line-height; some browsers report "normal" so fall
      // back to font-size × 1.2.
      try {
        const before = text.slice(0, r.start);
        const line = before.split("\n").length - 1;
        const cs = window.getComputedStyle(ta);
        const lhRaw = cs.lineHeight;
        let lineHeight = parseFloat(lhRaw);
        if (!Number.isFinite(lineHeight)) {
          lineHeight = parseFloat(cs.fontSize) * 1.2;
        }
        const target = Math.max(0, line * lineHeight - ta.clientHeight / 3);
        ta.scrollTop = target;
      } catch {
        /* non-fatal */
      }
    }
  };

  return (
    <section className="space-y-3">
      {/* §4.4 PageHeader */}
      <PageHeader
        title={`Page ${(page.data.idx0 ?? 0) + 1}`}
        description={page.data.source_stem}
        actions={
          <div className="flex items-center gap-2">
            {splits.length > 0 && (
              <Select value={splitSuffix} onValueChange={setSplitSuffix}>
                <SelectTrigger
                  aria-label="Split selection"
                  className="rounded border border-border-2 bg-bg-surface px-2 py-1 text-sm text-ink-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_PAGE_VALUE}>(whole page)</SelectItem>
                  {[...splits]
                    .sort((a, b) => a.reading_order - b.reading_order)
                    .map((s) => (
                      <SelectItem key={s.suffix} value={s.suffix}>
                        {page.data.prefix}
                        {s.suffix}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <Link
              to={`/projects/${projectId}/pages/${Math.max(0, idx0 - 1)}/review`}
              className="rounded border border-border-2 px-2 py-1 text-sm text-ink-1 hover:bg-bg-raised"
            >
              ← Prev
            </Link>
            <Link
              to={`/projects/${projectId}/pages/${idx0 + 1}/review`}
              className="rounded border border-border-2 px-2 py-1 text-sm text-ink-1 hover:bg-bg-raised"
            >
              Next →
            </Link>
          </div>
        }
      />

      {/* §9a-followup: persistent "Restore last delete" banner. Stays open
          after a delete until the proofer restores, dismisses, or supersedes
          it with another delete. The delete itself is already persisted
          server-side (soft-delete) — this only offers the restore. */}
      {undoWindow.window && (
        <div
          data-testid="undo-banner"
          role="alert"
          className="flex items-center gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          <span>
            Deleted {undoWindow.window.wordIds.length} word
            {undoWindow.window.wordIds.length === 1 ? "" : "s"}.
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={handleUndo}
            className="border-amber-400 bg-white hover:bg-amber-100"
          >
            Restore last delete (Ctrl+Z)
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => undoWindow.confirm()}
            className="ml-auto hover:bg-amber-100"
            aria-label="Dismiss restore banner"
          >
            ✕
          </Button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Left pane: pd-ui PageImageCanvas + word bbox overlay.
            Phase 2.2: the separate <img> + absolutely-positioned Konva
            Stage are replaced by WordBboxOverlay which wraps pd-ui's
            PageImageCanvas (image layer + slot fills). */}
        <Card className="overflow-hidden" style={{ minHeight: 400 }}>
          {imageKey ? (
            <WordBboxOverlay
              imageUrl={`/cdn/${imageKey}`}
              naturalWidth={naturalSize.w}
              naturalHeight={naturalSize.h}
              words={words}
              activeWordIndex={activeWordIndex}
              onWordClick={handleWordClick}
              selectedWordIds={selectedWordIds}
              onWordToggleSelect={(id) => {
                setSelectedWordIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  setLiveMessage(
                    next.size === 0
                      ? "Cleared selection"
                      : `${next.size} word${next.size === 1 ? "" : "s"} selected`,
                  );
                  return next;
                });
              }}
              onMarqueeSelect={(ids, additive) => {
                // §9a marquee: shift-drag adds to the existing
                // selection (typical multi-rect editor UX); a plain
                // drag replaces it entirely. Empty marquees are
                // suppressed inside the overlay so this fires only
                // for real drags — a click on empty canvas in
                // "replace" mode therefore cannot accidentally
                // wipe a careful per-word selection (see overlay's
                // zero-area suppression).
                setSelectedWordIds((prev) => {
                  let next: Set<string>;
                  if (additive) {
                    next = new Set(prev);
                    for (const id of ids) next.add(id);
                  } else {
                    next = new Set(ids);
                  }
                  setLiveMessage(
                    next.size === 0
                      ? "Cleared selection"
                      : `${next.size} word${next.size === 1 ? "" : "s"} selected`,
                  );
                  return next;
                });
              }}
            />
          ) : (
            <div className="flex h-96 items-center justify-center text-ink-3">
              no image
            </div>
          )}
        </Card>

        {/* Right pane: GT textarea, diff view, controls */}
        <Card className="p-4 flex flex-col gap-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            onSelect={handleTextareaSelect}
            onClick={handleTextareaSelect}
            onKeyUp={handleTextareaSelect}
            spellCheck
            className="min-h-[60vh] w-full resize-y rounded border border-border-1 p-2 font-mono text-sm focus:outline-none bg-bg-surface text-ink-1"
            placeholder={
              text$.error
                ? "No OCR text yet. Click 're-OCR' to run OCR for this page."
                : "Loading…"
            }
          />

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-1 pt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reocr.mutate()}
              disabled={reocr.isPending}
            >
              {reocr.isPending ? "Re-OCR…" : "Re-OCR this page"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => triggerDeleteWithUndo(Array.from(selectedWordIds))}
              disabled={selectedWordIds.size === 0 || deleteWords.isPending}
              title="Delete the words highlighted in red on the source image"
            >
              {deleteWords.isPending
                ? "Deleting…"
                : selectedWordIds.size === 0
                  ? "Delete words"
                  : `Delete ${selectedWordIds.size} word${selectedWordIds.size === 1 ? "" : "s"}`}
            </Button>
            {selectedWordIds.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedWordIds(new Set());
                  setLiveMessage("Cleared selection");
                }}
                title="Clear the current word selection (Esc)"
              >
                Clear selection
              </Button>
            )}
            <FormErrorBanner
              prefix="save failed"
              error={save.isError ? save.error : null}
            />
            <FormErrorBanner
              prefix="ocr failed"
              error={reocr.isError ? reocr.error : null}
            />
            <FormErrorBanner
              prefix="delete failed"
              error={deleteWords.isError ? deleteWords.error : null}
            />
            {priorText !== null && (
              <div className="ml-auto flex items-center gap-2">
                {/* §4.4 diff toggle → ToggleGroup */}
                <ToggleGroup
                  type="single"
                  value={viewMode}
                  onValueChange={(v) => v && setViewMode(v as "text" | "diff")}
                >
                  <ToggleGroupItem value="text">Text</ToggleGroupItem>
                  <ToggleGroupItem value="diff">Diff</ToggleGroupItem>
                </ToggleGroup>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setPriorText(null)}
                  title="Dismiss the diff and accept the new OCR text"
                >
                  Accept
                </Button>
              </div>
            )}
          </div>

          {/* Tick 24 a11y: screen-reader narration for selection /
              delete state. Visually hidden (sr-only). `role="status"`
              + `aria-live="polite"` lets AT announce without
              interrupting; empty content = silent. */}
          <div
            data-testid="text-review-live"
            role="status"
            aria-live="polite"
            className="sr-only"
          >
            {liveMessage}
          </div>

          {priorText !== null && viewMode === "diff" && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-ink-3">
                <span>Re-OCR diff (prior → new)</span>
                {!diffHasChanges && (
                  <span className="italic">
                    no changes — re-OCR returned identical text
                  </span>
                )}
              </div>
              {diffHasChanges && <LineDiffView diff={diff} />}
            </div>
          )}

          {/* §4.4 KeyCap hotkey hints row */}
          <div data-testid="hotkey-hints" className="flex flex-wrap gap-3 px-1">
            {HOTKEY_MAP.filter((h) => h.section === "Editing").map((h) => (
              <span
                key={h.keys.join("+")}
                className="flex items-center gap-1 text-xs text-ink-3"
              >
                {h.keys.map((k) => (
                  <KeyCap key={k}>{k}</KeyCap>
                ))}
                <span>{h.description}</span>
              </span>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
