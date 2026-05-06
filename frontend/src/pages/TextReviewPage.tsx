import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { PageRecord } from "../api/types";
import { WordBboxOverlay } from "../components/WordBboxOverlay";
import { diffLines } from "../lib/lineDiff";
import { LineDiffView } from "../lib/LineDiffView";
import {
  buildWordOffsetIndex,
  offsetToWord,
  wordToRange,
  type OcrWord,
} from "../lib/wordOffsets";

interface OcrPageResponse {
  text: string;
  text_key: string;
  words: OcrWord[];
}

// ─── §9a delete-words wire shapes ──────────────────────────────────
// Hand-mirrored from `api/data/pages.py::DeleteWordsRequest` /
// `DeleteWordsResponse`. Lives here (not in `api/types.ts`) so it
// won't be clobbered next time `make openapi-export` regenerates the
// generated types — same convention `PageWorkbenchPage` uses for
// `ProcessPageRequest`/`Response` (see tick 11). When the OpenAPI
// export catches up, replace these with the generated names.
interface DeleteWordsRequest {
  word_ids: string[];
  split_suffix?: string | null;
}

interface DeleteWordsResponse {
  text_key: string;
  words_key: string;
  deleted_count: number;
  remaining_words: OcrWord[];
  text: string;
}

export function TextReviewPage() {
  const { projectId = "", idx0: idx0Str = "0" } = useParams();
  const idx0 = Number(idx0Str);
  const queryClient = useQueryClient();

  const [splitSuffix, setSplitSuffix] = useState<string>("");
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
  const [showDiff, setShowDiff] = useState<boolean>(true);
  // Tick 24: aria-live announcer for selection / delete state. Plain
  // string surfaced in a `role="status"` `aria-live="polite"` div so
  // screen readers narrate marquee selection size, manual clears, and
  // delete completions. Empty string = nothing to announce.
  const [liveMessage, setLiveMessage] = useState<string>("");

  // Image-load state drives the overlay sizing — Konva Stage waits
  // until the <img> has rendered so we know natural & rendered sizes.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
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
    queryFn: () =>
      api.get<{ text: string; text_key: string; words: OcrWord[] }>(
        `/api/data/projects/${projectId}/pages/${idx0}/text/${splitSuffix || "_"}`,
      ),
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

  const wordIndex = useMemo(
    () => buildWordOffsetIndex(text, words),
    [text, words],
  );

  const save = useMutation({
    mutationFn: () =>
      api.patch<{ text_key: string }>(
        `/api/data/projects/${projectId}/pages/${idx0}/text`,
        { split_suffix: splitSuffix || null, text },
      ),
    onSuccess: () => {
      setDirty(false);
      // Persisting the user's edits ends the "compare against
      // prior re-OCR" workflow — the new content is now canonical.
      setPriorText(null);
      queryClient.invalidateQueries({
        queryKey: ["page-text", projectId, idx0, splitSuffix],
      });
    },
  });

  // §9a: hard-delete the selected words server-side. The endpoint
  // rewrites `<root>.words.json` and `<root>.txt`; we mirror the new
  // canonical state into local `text` / `words` so the textarea and
  // overlay refresh without a query round-trip. The destructive
  // server semantics intentionally rule out client-side undo for v1
  // (no restore endpoint exists) — see roadmap §9a "Status (tick 22)".
  const deleteWords = useMutation({
    mutationFn: (ids: string[]) =>
      api.delete<DeleteWordsResponse>(
        `/api/data/projects/${projectId}/pages/${idx0}/words`,
        {
          body: {
            word_ids: ids,
            split_suffix: splitSuffix || null,
          } satisfies DeleteWordsRequest,
        },
      ),
    onSuccess: (resp) => {
      setText(resp.text);
      setWords(resp.remaining_words ?? []);
      // Server is now the source of truth — clear local edit / select
      // state so the proofer can immediately stage another batch.
      setDirty(false);
      setActiveWordIndex(null);
      setSelectedWordIds(new Set());
      const n = resp.deleted_count ?? 0;
      setLiveMessage(`Deleted ${n} word${n === 1 ? "" : "s"}`);
      // The diff snapshot (re-OCR comparison) is a separate flow; do
      // not clear `priorText` — the user may still want to see the
      // pre-re-OCR diff after a delete.
      queryClient.invalidateQueries({
        queryKey: ["page-text", projectId, idx0, splitSuffix],
      });
    },
  });

  // §9a: window-level Delete / Backspace fires the bulk-delete
  // mutation. Scope-aware — when focus is inside the textarea (or
  // any editable element) we do nothing, so the keys retain their
  // normal character-deletion semantics. Pressing Delete with an
  // empty selection is a no-op so spurious round-trips don't hit the
  // server. Escape clears the current selection (same scope rules so
  // Esc doesn't fight any modal/dropdown that owns it). Declared
  // after `deleteWords` because the effect closure captures the
  // mutation; flipping the order would TDZ-throw on first render.
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (ev.key !== "Delete" && ev.key !== "Backspace" && ev.key !== "Escape")
        return;
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "TEXTAREA" ||
          tag === "INPUT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (ev.key === "Escape") {
        if (selectedWordIds.size === 0) return;
        ev.preventDefault();
        setSelectedWordIds(new Set());
        setLiveMessage("Cleared selection");
        return;
      }
      if (selectedWordIds.size === 0) return;
      ev.preventDefault();
      deleteWords.mutate(Array.from(selectedWordIds));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedWordIds, deleteWords]);

  const reocr = useMutation({
    mutationFn: () =>
      api.post<OcrPageResponse>("/api/gpu/run-ocr-page", {
        project_id: projectId,
        idx0,
        split_suffix: splitSuffix || null,
      }),
    onMutate: () => {
      // Snapshot the textarea content right before the new OCR
      // result lands. Closure captures the current `text`, so
      // back-to-back re-OCR clicks always compare against the
      // text that was on screen immediately before THIS click —
      // not the very first prior-text we ever captured.
      setPriorText(text);
      setShowDiff(true);
    },
    onSuccess: (resp) => {
      setText(resp.text);
      setWords(resp.words ?? []);
      setDirty(false);
      setActiveWordIndex(null);
      queryClient.invalidateQueries({
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

  if (page.isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!page.data) return <p className="text-red-600">Page not found.</p>;

  const splits = page.data.splits as Array<{ suffix: string; reading_order: number }>;
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
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            Text review — {page.data.prefix || `#${idx0}`}
          </h1>
          <p className="text-xs text-slate-500">{page.data.source_stem}</p>
        </div>
        <div className="flex items-center gap-2">
          {splits.length > 0 && (
            <select
              value={splitSuffix}
              onChange={(e) => setSplitSuffix(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">(whole page)</option>
              {[...splits]
                .sort((a, b) => a.reading_order - b.reading_order)
                .map((s) => (
                  <option key={s.suffix} value={s.suffix}>
                    {page.data!.prefix}
                    {s.suffix}
                  </option>
                ))}
            </select>
          )}
          <Link
            to={`/projects/${projectId}/pages/${Math.max(0, idx0 - 1)}/review`}
            className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
          >
            ← Prev
          </Link>
          <Link
            to={`/projects/${projectId}/pages/${idx0 + 1}/review`}
            className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
          >
            Next →
          </Link>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded border bg-white p-2">
          {imageKey ? (
            <div className="relative inline-block w-full">
              <img
                ref={setImgEl}
                src={`/cdn/${imageKey}`}
                alt={page.data.prefix}
                className="max-h-[80vh] w-full object-contain"
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setNaturalSize({
                    w: el.naturalWidth,
                    h: el.naturalHeight,
                  });
                }}
              />
              <WordBboxOverlay
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
                trackElement={imgEl}
              />
            </div>
          ) : (
            <div className="flex h-96 items-center justify-center text-slate-400">
              no image
            </div>
          )}
        </div>

        <div className="flex flex-col rounded border bg-white p-2">
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
            className="min-h-[60vh] w-full resize-y rounded border-0 p-2 font-mono text-sm focus:outline-none"
            placeholder={
              text$.error
                ? "No OCR text yet. Click 're-OCR' to run OCR for this page."
                : "Loading…"
            }
          />
          <div className="flex items-center gap-2 border-t pt-2">
            <button
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-slate-800"
            >
              {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
            <button
              onClick={() => reocr.mutate()}
              disabled={reocr.isPending}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              {reocr.isPending ? "Re-OCR…" : "Re-OCR this page"}
            </button>
            <button
              onClick={() =>
                deleteWords.mutate(Array.from(selectedWordIds))
              }
              disabled={selectedWordIds.size === 0 || deleteWords.isPending}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-transparent"
              title="Delete the words highlighted in red on the source image"
            >
              {deleteWords.isPending
                ? "Deleting…"
                : selectedWordIds.size === 0
                  ? "Delete words"
                  : `Delete ${selectedWordIds.size} word${selectedWordIds.size === 1 ? "" : "s"}`}
            </button>
            {selectedWordIds.size > 0 && (
              <button
                onClick={() => {
                  setSelectedWordIds(new Set());
                  setLiveMessage("Cleared selection");
                }}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                title="Clear the current word selection (Esc)"
              >
                Clear selection
              </button>
            )}
            {save.isError && (
              <span className="text-xs text-red-600">
                save failed: {(save.error as Error).message}
              </span>
            )}
            {reocr.isError && (
              <span className="text-xs text-red-600">
                ocr failed: {(reocr.error as Error).message}
              </span>
            )}
            {deleteWords.isError && (
              <span className="text-xs text-red-600">
                delete failed: {(deleteWords.error as Error).message}
              </span>
            )}
            {priorText !== null && (
              <>
                <button
                  onClick={() => setShowDiff((v) => !v)}
                  className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                >
                  {showDiff ? "Hide diff" : "Show diff"}
                </button>
                <button
                  onClick={() => setPriorText(null)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                  title="Dismiss the diff and accept the new OCR text"
                >
                  Accept
                </button>
              </>
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
          {priorText !== null && showDiff && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
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
        </div>
      </div>
    </section>
  );
}
