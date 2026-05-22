/**
 * Component-mount test for `TextReviewPage` — the page that lets a
 * proofer compare an OCRed text panel against the source image and
 * edit it in-place. Roadmap §7 deferred coverage from §9; the
 * snapshot-lifecycle code (re-OCR diff via `priorText` + `LineDiffView`)
 * already has unit coverage in `lineDiff.test.ts` /
 * `lineDiff.view.test.tsx`. This file adds the missing
 * load + edit + save lifecycle through msw at the wire level.
 *
 * Scope is deliberately one test focused on the save-flow contract:
 *   - GET /api/data/projects/:id/pages/:idx0    (page metadata)
 *   - GET /api/data/projects/:id/pages/:idx0/text/_   (page text)
 *   - PATCH /api/data/projects/:id/pages/:idx0/text   (save edits)
 *
 * Why this is the right scope for one tick: the re-OCR diff path
 * exercises `useMutation.onMutate` snapshot capture + `LineDiffView`
 * rendering. `LineDiffView` rendering already has 3 dedicated tests in
 * tick 18 (`lineDiff.view.test.tsx`); the snapshot-capture wiring is
 * pure-function memoisation over `priorText` state. A second test
 * covering re-OCR + diff is a natural follow-up tick — not
 * a blocker for landing the save-lifecycle coverage now.
 *
 * jsdom note: the page mounts `WordBboxOverlay` (Konva-on-canvas) but
 * we never feed it words and the source `<img>` never fires onLoad in
 * jsdom, so `naturalSize` stays {0,0} and the overlay early-returns
 * `null` before any canvas is touched. No canvas mock needed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { components } from "../api/types.gen";

type PageRecord = components["schemas"]["PageRecord"];
import { server } from "../test/server";
import { TextReviewPage } from "./TextReviewPage";

// Phase 2.2: WordBboxOverlay now wraps @concavetrillion/pd-ui's
// PageImageCanvas rather than rendering its own raw Konva Stage.
// We mock pd-ui/canvas so that:
//  1. No real canvas context is needed in jsdom.
//  2. The slot-fill children (selection + tool) are invoked and rendered
//     as plain DOM elements for inspection by the §9a select-and-delete tests.
//
// We still mock react-konva because react-konva/konva require a real canvas
// context (via `require("canvas")`) and would crash in jsdom otherwise.
// The slot fills render Konva Rects; the react-konva mock turns them into
// <div>s so tests can inspect them.
//
// naturalSize stays {0,0} until the Image preload effect fires.
// WordBboxOverlay early-returns null when naturalWidth/naturalHeight are 0,
// so the §9a save-lifecycle and diff tests are unaffected (no Rects mount).
vi.mock("@concavetrillion/pd-ui/canvas", () => ({
  PageImageCanvas: ({
    children,
  }: {
    children?: {
      selection?: () => ReactNode;
      tool?: () => ReactNode;
    };
  }) => (
    <div data-testid="pd-ui-canvas">
      {children?.selection?.()}
      {children?.tool?.()}
    </div>
  ),
}));

vi.mock("react-konva", () => ({
  Stage: ({ children }: { children?: ReactNode }) => (
    <div data-testid="konva-stage">{children}</div>
  ),
  Layer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="konva-layer">{children}</div>
  ),
  Rect: ({ onClick }: { onClick?: () => void }) => (
    <div data-testid="konva-rect" onClick={onClick} />
  ),
}));

function renderAtRoute(ui: ReactElement, initialPath: string) {
  // Fresh QueryClient per test so query cache can't leak across files.
  // Retry off so error paths surface immediately.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/projects/:projectId/pages/:idx0/review" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    project_id: "prj_abc",
    idx0: 0,
    prefix: "f001",
    source_stem: "0001.jpg",
    ignore: false,
    page_type: "normal",
    alignment: "default",
    config_overrides: {
      // PageConfigOverrides-Output is "all fields required, defaults serialized
      // explicitly". Server emits each field; the test fixture must too.
      initial_crop: null,
      white_space_additional: null,
      threshold_level: null,
      fuzzy_pct: null,
      pixel_count_columns: null,
      pixel_count_rows: null,
      skip_auto_deskew: null,
      deskew_before_crop: null,
      deskew_after_crop: null,
      do_morph: null,
      skip_denoise: null,
      use_ocr_bbox_edge: null,
      rotated_standard: null,
      single_dimension_rescale: null,
      manual_deskew_angle: null,
    },
    splits: [],
    illustration_regions: [],
    source_key: "projects/prj_abc/source/0001.jpg",
    thumbnail_key: "projects/prj_abc/thumb/0001.jpg",
    processed_image_key: "projects/prj_abc/proc/0001.jpg",
    ocr_image_key: null,
    processing_status: "complete",
    processing_job_id: null,
    processing_error: null,
    last_processed_at: null,
    outputs: [],
    // Split-child fields (M2 §E). All null on a root page; reading_order=0.
    parent_page_id: null,
    source_crop_bbox: null,
    split_index: null,
    split_at_stage: null,
    split_suffix: null,
    reading_order: 0,
    ...overrides,
  };
}

describe("TextReviewPage save lifecycle", () => {
  it("loads page text, marks dirty on edit, and PATCHes /text on save", async () => {
    const patchCalls: { url: string; body: unknown }[] = [];

    server.use(
      // Page metadata.
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      // Page text — empty splitSuffix maps to the literal "_" sentinel
      // in the route (see TextReviewPage.tsx:60).
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "first line\nsecond line\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        }),
      ),
      // Save endpoint — assertion target.
      http.patch(
        "/api/data/projects/:projectId/pages/:idx0/text",
        async ({ request }) => {
          patchCalls.push({
            url: request.url,
            body: await request.json(),
          });
          return HttpResponse.json({
            text_key: "projects/prj_abc/text/0001.txt",
          });
        },
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // Wait for text$ to populate the textarea.
    const textarea = (await screen
      .findByPlaceholderText(/Loading/i, {
        // Placeholder briefly visible until text$ resolves.
      })
      .catch(() => null)) as HTMLTextAreaElement | null;
    void textarea; // placeholder may already be replaced; just need the next assertion

    // The textarea is the single <textarea> on the page. Wait until
    // its value matches the loaded text — proves both queries resolved.
    const ta = await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el).not.toBeNull();
      expect(el.value).toBe("first line\nsecond line\n");
      return el;
    });

    // Save button starts in "Saved" (not dirty) — disabled.
    const savedBtn = screen.getByRole("button", { name: /^Saved$/i });
    expect(savedBtn).toBeDisabled();

    // Type at the end of the textarea. userEvent fires onChange which
    // flips `dirty` and renames the button to "Save".
    const user = userEvent.setup();
    await user.click(ta);
    await user.keyboard(" extra");

    const saveBtn = await screen.findByRole("button", { name: /^Save$/i });
    expect(saveBtn).toBeEnabled();

    await user.click(saveBtn);

    // PATCH lands and the button label flips back to "Saved" via
    // onSuccess setting `dirty=false`.
    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
    });
    // noUncheckedIndexedAccess: patchCalls length checked above
    expect(patchCalls[0]!.url).toMatch(
      /\/api\/data\/projects\/prj_abc\/pages\/0\/text$/,
    );
    expect(patchCalls[0]!.body).toEqual({
      split_suffix: null,
      text: "first line\nsecond line\n extra",
    });

    // Post-save UI: dirty cleared.
    await screen.findByRole("button", { name: /^Saved$/i });
  });

  it("re-OCRs and shows diff", async () => {
    // M6: re-OCR now uses the per-stage endpoint instead of the legacy
    // /api/gpu/run-ocr-page. The stage run POST returns a PageStageState,
    // then the component invalidates the page-text query so the GET
    // re-fetches with the new text.
    const stageCalls: { url: string }[] = [];
    let textCallCount = 0;

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      // First GET returns "alpha/beta/gamma"; subsequent calls (after
      // invalidation) return "alpha/BETA/gamma" to simulate re-OCR.
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () => {
        textCallCount += 1;
        const text =
          textCallCount === 1 ? "alpha\nbeta\ngamma\n" : "alpha\nBETA\ngamma\n";
        return HttpResponse.json({
          text,
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        });
      }),
      // Per-stage OCR endpoint (M6 replacement).
      http.post(
        "/api/data/projects/:projectId/pages/:idx0/stages/ocr_page/run",
        ({ request }) => {
          stageCalls.push({ url: request.url });
          // Return a minimal PageStageState-shaped object.
          return HttpResponse.json({
            project_id: "prj_abc",
            page_id: "0000",
            stage_id: "ocr_page",
            status: "clean",
            artifact_key: null,
            error_message: null,
            updated_at: new Date().toISOString(),
          });
        },
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // Wait for the textarea to populate from the first GET /text response.
    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el).not.toBeNull();
      expect(el.value).toBe("alpha\nbeta\ngamma\n");
    });

    const user = userEvent.setup();
    const reocrBtn = screen.getByRole("button", {
      name: /^Re-OCR this page$/i,
    });
    await user.click(reocrBtn);

    // (a) POST fired to the per-stage endpoint.
    await waitFor(() => {
      expect(stageCalls).toHaveLength(1);
    });
    // noUncheckedIndexedAccess: stageCalls length checked above
    expect(stageCalls[0]!.url).toMatch(/\/stages\/ocr_page\/run$/);

    // (b) Textarea content is updated from the refetched GET /text response.
    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha\nBETA\ngamma\n");
    });

    // (c) LineDiffView is rendered with prior-vs-new columns. The
    // headers ("Prior" / "New") are sticky column labels; the
    // changed line shows up as one delete row ("beta") and one
    // insert row ("BETA") paired into a single grid row by
    // `buildRows`.
    expect(screen.getByText("Prior")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("BETA")).toBeInTheDocument();
  });
});

describe("TextReviewPage §9a delete-words flow", () => {
  // Phase 2.2: WordBboxOverlay no longer renders a <img> element — it
  // wraps pd-ui's PageImageCanvas (mocked here). The naturalSize state in
  // TextReviewPage is now driven by a `useEffect` that calls `new Image()`
  // and reads `img.naturalWidth/Height` on load.
  //
  // Two gates must fall together for WordBboxOverlay to render its word Rects:
  //   1. `naturalSize` (set by the new Image() preload) must be non-zero.
  //   2. `words.length > 0` (set by the page-text query response).
  //
  // We stub `window.Image` in beforeAll so that when TextReviewPage's
  // useEffect calls `new Image()`, setting `.src` immediately fires `onload`
  // with the configured natural dimensions. This replaces the old
  // `fireImgLoad` DOM approach.
  //
  // Word selection is via the DOM event-capture overlay
  // (`word-bbox-overlay-capture`) using fireEvent.mouseUp, not by clicking
  // Konva Rect elements (the Rects are now in a listening=false Layer).
  //
  // Coordinate math (for word-click tests):
  //   Words use naturalWidth=1000, naturalHeight=100.
  //   The DOM overlay's getBoundingClientRect is stubbed to 1000×100
  //   (matching natural dims → scaleX=1, scaleY=1 → DOM coord = natural coord).
  //   w_alpha: left=0, width=50  → click at DOM (25, 10)
  //   w_beta:  left=60, width=50 → click at DOM (85, 10)
  //   w_gamma: left=120, width=50→ click at DOM (145, 10)

  let originalImage: typeof Image;
  let originalGetBoundingClientRect:
    | typeof HTMLElement.prototype.getBoundingClientRect
    | undefined;

  const NATURAL = { w: 1000, h: 100 };

  beforeAll(() => {
    // Stub window.Image so new Image() immediately fires onload with known dims.
    originalImage = window.Image;
    class FakeImage extends EventTarget {
      naturalWidth = NATURAL.w;
      naturalHeight = NATURAL.h;
      crossOrigin: string | null = null;
      private _src = "";
      get src() {
        return this._src;
      }
      set src(val: string) {
        this._src = val;
        // Fire onload synchronously when src is set.
        if (
          typeof (this as unknown as { onload: (() => void) | null }).onload ===
          "function"
        ) {
          (this as unknown as { onload: () => void }).onload();
        }
      }
      onload: (() => void) | null = null;
    }
    window.Image = FakeImage as unknown as typeof Image;

    // Stub HTMLElement.prototype.getBoundingClientRect to return a non-zero
    // rect for the event-capture overlay so coordinate conversion works.
    // This stub applies to ALL elements so word-bbox-overlay-capture returns
    // a 1000×100 rect (matching NATURAL dims → scale 1:1).
    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        width: NATURAL.w,
        height: NATURAL.h,
        top: 0,
        left: 0,
        right: NATURAL.w,
        bottom: NATURAL.h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    };
  });

  afterAll(() => {
    window.Image = originalImage;
    if (originalGetBoundingClientRect) {
      HTMLElement.prototype.getBoundingClientRect =
        originalGetBoundingClientRect;
    }
  });

  // Note: fake timers are only used in specific tests that need timer
  // advancement (undo expiry). See individual tests for vi.useFakeTimers()
  // calls. Tests that don't need fake timers use real timers.

  /**
   * Wait for the word-bbox-overlay-capture div to appear.
   * It only renders when naturalSize is non-zero AND words.length > 0.
   * Phase 2.2: triggered by the useEffect new Image() preload.
   */
  async function waitForOverlay() {
    return screen.findByTestId("word-bbox-overlay-capture");
  }

  /**
   * Click a word in the overlay by firing a mouseUp at the word's
   * center in natural-pixel coords.
   *
   * Phase 2.2: Word selection uses the DOM event-capture overlay's
   * mouseUp handler (hit-test in natural-pixel space). A mouseUp without
   * a preceding mouseDown is treated as a simple click by the overlay.
   *
   * Word coords (natural px, matching makeWordRow):
   *   w_alpha: left=0,   width=50  → center at x=25
   *   w_beta:  left=60,  width=50  → center at x=85
   *   w_gamma: left=120, width=50  → center at x=145
   *
   * With NATURAL.w=1000, overlay displayW=1000 → scaleX=1 → DOM=natural.
   */
  async function clickWordInOverlay(
    overlay: HTMLElement,
    naturalX: number,
    naturalY: number,
  ) {
    fireEvent.mouseUp(overlay, { clientX: naturalX, clientY: naturalY });
  }

  function makeWordRow(id: string, x: number) {
    return {
      id,
      text: id,
      confidence: 0.99,
      bounding_box: { left: x, top: 0, width: 50, height: 20 },
    };
  }

  it("selects words via clicks, fires DELETE immediately on Delete keydown, banner then appears; ✕ dismisses banner", async () => {
    // Tests the new immediate-delete flow: select → Delete key → DELETE fires
    // immediately (soft-delete on server) → on server success undo banner appears →
    // ✕ button closes banner (no additional DELETE).
    const deleteCalls: { url: string; body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta gamma\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [
            makeWordRow("w_alpha", 0),
            makeWordRow("w_beta", 60),
            makeWordRow("w_gamma", 120),
          ],
        }),
      ),
      http.delete(
        "/api/data/projects/:projectId/pages/:idx0/words",
        async ({ request }) => {
          deleteCalls.push({
            url: request.url,
            body: await request.json(),
          });
          return HttpResponse.json({
            text_key: "projects/prj_abc/text/0001.txt",
            words_key: "projects/prj_abc/text/0001.words.json",
            deleted_count: 2,
            text: "gamma\n",
            remaining_words: [makeWordRow("w_gamma", 120)],
          });
        },
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // Wait for the page text + words to populate.
    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta gamma\n");
    });

    // Phase 2.2: The window.Image stub fires onload synchronously so
    // naturalSize is set as soon as the useEffect runs. Wait for the
    // event-capture overlay to appear (gates on naturalSize > 0 AND words > 0).
    const overlay = await waitForOverlay();

    const user = userEvent.setup();
    // Toggle-select w_alpha (center x=25) and w_beta (center x=85).
    // clientX/Y are in natural-pixel coords (scaleX=1 because overlay
    // displayWidth matches naturalWidth=1000).
    await clickWordInOverlay(overlay, 25, 10); // w_alpha
    await clickWordInOverlay(overlay, 85, 10); // w_beta

    // The delete button label reflects selection size.
    await screen.findByRole("button", { name: /^Delete 2 words$/i });

    // Press Delete on document.body — DELETE fires immediately (soft-delete).
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });

    // DELETE fires immediately on keydown (before the undo window opens).
    await waitFor(() => {
      expect(deleteCalls).toHaveLength(1);
    });
    // noUncheckedIndexedAccess: length checked above
    expect(deleteCalls[0]!.url).toMatch(
      /\/api\/data\/projects\/prj_abc\/pages\/0\/words$/,
    );
    expect(deleteCalls[0]!.body).toEqual({
      word_ids: ["w_alpha", "w_beta"],
      split_suffix: null,
    });

    // After server confirms, undo banner appears.
    await screen.findByTestId("undo-banner");

    // Textarea reflects the rebuilt text from the server.
    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("gamma\n");
    });

    // Click ✕ — dismisses the restore banner (no additional DELETE fired).
    const confirmBtn = screen.getByRole("button", {
      name: /Dismiss restore banner/i,
    });
    await user.click(confirmBtn);

    // Banner dismissed, still only one DELETE total.
    expect(screen.queryByTestId("undo-banner")).toBeNull();
    expect(deleteCalls).toHaveLength(1);
    await screen.findByRole("button", { name: /^Delete words$/i });
  });

  it("undo banner: Undo button fires restore POST and closes banner", async () => {
    // New behaviour: DELETE fires immediately on keydown. Clicking Undo fires
    // POST .../words/restore to flip the soft-delete back. Banner closes.
    const deleteCalls: { body: unknown }[] = [];
    const restoreCalls: { url: string; body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [makeWordRow("w_alpha", 0), makeWordRow("w_beta", 60)],
        }),
      ),
      http.delete(
        "/api/data/projects/:projectId/pages/:idx0/words",
        async ({ request }) => {
          deleteCalls.push({ body: await request.json() });
          return HttpResponse.json({
            text_key: "k",
            words_key: "k.words.json",
            deleted_count: 1,
            text: "beta\n",
            remaining_words: [makeWordRow("w_beta", 60)],
          });
        },
      ),
      http.post(
        "/api/data/projects/:projectId/pages/:idx0/words/restore",
        async ({ request }) => {
          restoreCalls.push({ url: request.url, body: await request.json() });
          return HttpResponse.json({
            text_key: "k",
            words_key: "k.words.json",
            restored_count: 1,
            text: "alpha beta\n",
            remaining_words: [
              makeWordRow("w_alpha", 0),
              makeWordRow("w_beta", 60),
            ],
          });
        },
      ),
    );

    const user = userEvent.setup();
    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta\n");
    });

    const overlay2 = await waitForOverlay();
    await clickWordInOverlay(overlay2, 25, 10); // select w_alpha

    await screen.findByRole("button", { name: /^Delete 1 word$/i });
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });

    // DELETE fires immediately on keydown.
    await waitFor(() => {
      expect(deleteCalls).toHaveLength(1);
    });

    // Banner appears after server confirms the delete.
    await screen.findByTestId("undo-banner");

    // Click the "Restore last delete" button — fires restore POST, banner closes.
    const undoBtn = screen.getByRole("button", {
      name: /Restore last delete/i,
    });
    await user.click(undoBtn);

    // Banner is dismissed immediately (optimistic restore in local state).
    expect(screen.queryByTestId("undo-banner")).toBeNull();

    // Restore POST fires with the correct word IDs.
    await waitFor(() => {
      expect(restoreCalls).toHaveLength(1);
    });
    // noUncheckedIndexedAccess: restoreCalls length checked above
    expect(restoreCalls[0]!.url).toMatch(
      /\/api\/data\/projects\/prj_abc\/pages\/0\/words\/restore$/,
    );
    expect(restoreCalls[0]!.body).toEqual({
      word_ids: ["w_alpha"],
      split_suffix: null,
    });
  });

  it("clears selection when Escape is pressed", async () => {
    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta gamma\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [
            makeWordRow("w_alpha", 0),
            makeWordRow("w_beta", 60),
            makeWordRow("w_gamma", 120),
          ],
        }),
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta gamma\n");
    });

    const overlay3 = await waitForOverlay();

    await clickWordInOverlay(overlay3, 25, 10); // w_alpha
    await clickWordInOverlay(overlay3, 85, 10); // w_beta

    // Selection of two words → Delete button reflects size; Clear
    // button is now visible alongside it.
    await screen.findByRole("button", { name: /^Delete 2 words$/i });
    expect(
      screen.getByRole("button", { name: /^Clear selection$/i }),
    ).toBeInTheDocument();

    // Press Escape on document.body — same hotkey-hook scope rules
    // apply; `code` is required (see Delete-keydown comment above).
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    // Post-Esc: Delete reverts to the empty-selection label and is
    // disabled, Clear button unmounts.
    const deleteBtn = await screen.findByRole("button", {
      name: /^Delete words$/i,
    });
    expect(deleteBtn).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^Clear selection$/i }),
    ).not.toBeInTheDocument();
  });

  it("clears selection when the Clear selection button is clicked", async () => {
    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta gamma\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [
            makeWordRow("w_alpha", 0),
            makeWordRow("w_beta", 60),
            makeWordRow("w_gamma", 120),
          ],
        }),
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta gamma\n");
    });

    const overlay4 = await waitForOverlay();

    const user = userEvent.setup();
    await clickWordInOverlay(overlay4, 25, 10); // w_alpha
    await clickWordInOverlay(overlay4, 85, 10); // w_beta

    const clearBtn = await screen.findByRole("button", {
      name: /^Clear selection$/i,
    });
    await user.click(clearBtn);

    // Same post-condition as the Escape test: empty-selection label,
    // Delete button disabled, Clear button gone.
    const deleteBtn = await screen.findByRole("button", {
      name: /^Delete words$/i,
    });
    expect(deleteBtn).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^Clear selection$/i }),
    ).not.toBeInTheDocument();
  });

  it("ignores Delete keydown when no words are selected", async () => {
    const deleteCalls: { body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [makeWordRow("w_alpha", 0), makeWordRow("w_beta", 60)],
        }),
      ),
      http.delete(
        "/api/data/projects/:projectId/pages/:idx0/words",
        async ({ request }) => {
          deleteCalls.push({ body: await request.json() });
          return HttpResponse.json({
            text_key: "k",
            words_key: "k.words.json",
            deleted_count: 0,
            text: "alpha beta\n",
            remaining_words: [],
          });
        },
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta\n");
    });

    // No rect clicks → empty selection → Delete must not fire a
    // request. Give the event loop a tick for any spurious mutation
    // to surface, then assert nothing landed.
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteCalls).toHaveLength(0);

    // Toolbar button is also disabled in the empty-selection state.
    const btn = screen.getByRole("button", { name: /^Delete words$/i });
    expect(btn).toBeDisabled();
  });

  it("navigate away while undo window is open does not fire a second DELETE", async () => {
    // With immediate soft-delete, DELETE fires on keydown. Unmounting while
    // the undo window is open should NOT fire an extra DELETE — commitNow's
    // onCommit is now a no-op (the delete is already persisted).
    const deleteCalls: { body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [makeWordRow("w_alpha", 0), makeWordRow("w_beta", 60)],
        }),
      ),
      http.delete(
        "/api/data/projects/:projectId/pages/:idx0/words",
        async ({ request }) => {
          deleteCalls.push({ body: await request.json() });
          return HttpResponse.json({
            text_key: "k",
            words_key: "k.words.json",
            deleted_count: 1,
            text: "beta\n",
            remaining_words: [makeWordRow("w_beta", 60)],
          });
        },
      ),
    );

    const { unmount } = renderAtRoute(
      <TextReviewPage />,
      "/projects/prj_abc/pages/0/review",
    );

    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta\n");
    });

    const overlay5 = await waitForOverlay();
    await clickWordInOverlay(overlay5, 25, 10); // select w_alpha

    await screen.findByRole("button", { name: /^Delete 1 word$/i });
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });

    // DELETE fires immediately on keydown (soft-delete).
    await waitFor(() => {
      expect(deleteCalls).toHaveLength(1);
    });

    // Banner appears after server confirms.
    await screen.findByTestId("undo-banner");

    // Unmount while undo window is open — commitNow is a no-op now;
    // exactly one DELETE was fired total (no extra on unmount).
    unmount();

    // Give a tick for any spurious second DELETE.
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteCalls).toHaveLength(1);
  });

  it("second delete while undo window open fires second DELETE immediately", async () => {
    // With immediate soft-delete: first Delete keydown fires first DELETE
    // right away. When the second Delete fires while the first banner is
    // open, the second DELETE also fires immediately, and a new banner
    // replaces the first.
    const deleteCalls: { body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta gamma\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [
            makeWordRow("w_alpha", 0),
            makeWordRow("w_beta", 60),
            makeWordRow("w_gamma", 120),
          ],
        }),
      ),
      http.delete(
        "/api/data/projects/:projectId/pages/:idx0/words",
        async ({ request }) => {
          const deleted = (await request.json()) as { word_ids: string[] };
          deleteCalls.push({ body: deleted });
          const remaining = [
            makeWordRow("w_alpha", 0),
            makeWordRow("w_beta", 60),
            makeWordRow("w_gamma", 120),
          ].filter((w) => !deleted.word_ids.includes(w.id));
          return HttpResponse.json({
            text_key: "k",
            words_key: "k.words.json",
            deleted_count: deleted.word_ids.length,
            text: remaining.map((w) => w.text).join(" ") + "\n",
            remaining_words: remaining,
          });
        },
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta gamma\n");
    });

    const overlay6 = await waitForOverlay();
    await clickWordInOverlay(overlay6, 25, 10); // select w_alpha

    await screen.findByRole("button", { name: /^Delete 1 word$/i });
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });

    // First DELETE fires immediately on keydown.
    await waitFor(() => {
      expect(deleteCalls).toHaveLength(1);
    });
    // noUncheckedIndexedAccess: length checked above
    expect(deleteCalls[0]!.body).toEqual({
      word_ids: ["w_alpha"],
      split_suffix: null,
    });

    // First undo banner appears after server confirms.
    await screen.findByTestId("undo-banner");

    // Select w_beta and trigger delete again while first window is open.
    // After w_alpha is deleted, the overlay re-renders with remaining words.
    // w_beta is at left=60, width=50 → click at x=85.
    await clickWordInOverlay(overlay6, 85, 10); // select w_beta
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });

    // Second DELETE fires immediately too.
    await waitFor(() => {
      expect(deleteCalls).toHaveLength(2);
    });
    // noUncheckedIndexedAccess: length checked above
    expect(deleteCalls[1]!.body).toEqual({
      word_ids: ["w_beta"],
      split_suffix: null,
    });

    // New undo window should be open for the second batch.
    await screen.findByTestId("undo-banner");
  });

  it("restore banner persists — it does not auto-dismiss after 5 seconds", async () => {
    // §9a-followup strategy (a): the "Restore last delete" banner is driven
    // by the server-side soft-delete and stays open until the proofer
    // restores or dismisses it. It must NOT auto-expire on a timer.
    const deleteCalls: { body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha beta\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [makeWordRow("w_alpha", 0), makeWordRow("w_beta", 60)],
        }),
      ),
      http.delete(
        "/api/data/projects/:projectId/pages/:idx0/words",
        async ({ request }) => {
          deleteCalls.push({ body: await request.json() });
          return HttpResponse.json({
            text_key: "k",
            words_key: "k.words.json",
            deleted_count: 1,
            text: "beta\n",
            remaining_words: [makeWordRow("w_beta", 60)],
          });
        },
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el.value).toBe("alpha beta\n");
    });

    const overlay = await waitForOverlay();
    await clickWordInOverlay(overlay, 25, 10); // select w_alpha

    await screen.findByRole("button", { name: /^Delete 1 word$/i });
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });

    await waitFor(() => {
      expect(deleteCalls).toHaveLength(1);
    });

    // Banner appears after server confirms.
    await screen.findByTestId("undo-banner");

    // Wait well past the old 5-second window — the banner must still be there.
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("undo-banner")).not.toBeNull();
    // Still exactly one DELETE — no expiry-driven commit ever happened.
    expect(deleteCalls).toHaveLength(1);
    // Banner offers the "Restore last delete" affordance, not a countdown.
    expect(
      screen.getByRole("button", { name: /Restore last delete/i }),
    ).toBeInTheDocument();
  });
});

describe("TextReviewPage P2-6 hi-fi layout", () => {
  it("renders PageHeader with page number", async () => {
    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "hello world\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        }),
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // PageHeader renders an h1 with the page number. idx0=0 → "Page 1".
    const header = await screen.findByTestId("page-header");
    expect(header).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Page 1/i }),
    ).toBeInTheDocument();
  });

  it("hotkey hints row renders KeyCap elements", async () => {
    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "hello world\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        }),
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // Wait for the page to load.
    await waitFor(() => {
      const el = document.querySelector("textarea")!;
      expect(el).not.toBeNull();
    });

    // The hotkey hints container is rendered.
    const hintsRow = screen.getByTestId("hotkey-hints");
    expect(hintsRow).toBeInTheDocument();

    // KeyCap renders as <kbd> elements; there should be at least one.
    const kbdElements = hintsRow.querySelectorAll("kbd");
    expect(kbdElements.length).toBeGreaterThan(0);
  });

  it("renders split selector Radix Select when splits exist", async () => {
    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
            splits: [
              { suffix: "_a", reading_order: 0 },
              { suffix: "_b", reading_order: 1 },
            ] as any,
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "hello world\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        }),
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // Wait for page to load and splits to be available.
    // The split selector should render as a Radix Select trigger (button).
    await waitFor(() => {
      // Look for a button with aria-label "Split selection"
      const splitTrigger = document.querySelector(
        'button[aria-label="Split selection"]',
      )!;
      expect(splitTrigger).toBeInTheDocument();
    });
  });

  it("shows correct default value in split selector trigger", async () => {
    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params["projectId"]),
            idx0: Number(params["idx0"]),
            splits: [{ suffix: "_a", reading_order: 0 }] as any,
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "hello world\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        }),
      ),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // Trigger should show "(whole page)" by default.
    await waitFor(() => {
      const splitTrigger = document.querySelector(
        'button[aria-label="Split selection"]',
      )!;
      expect(splitTrigger).toBeInTheDocument();
      // The trigger should display "(whole page)" as the selected value
      expect(splitTrigger.textContent).toContain("(whole page)");
    });
  });
});
