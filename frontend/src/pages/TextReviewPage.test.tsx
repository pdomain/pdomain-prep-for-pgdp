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

// Defuse the `react-konva` -> `konva/lib/index-node.js` -> `require("canvas")`
// chain at module-load time. jsdom has no canvas; `WordBboxOverlay`'s own
// test (`components/WordBboxOverlay.test.tsx`) uses the same trick. Vitest
// hoists `vi.mock` calls above the imports, so the page's transitive konva
// import resolves to these stubs.
//
// `Rect` surfaces as a clickable `<div>` so the §9a select-and-delete tests
// can drive bbox clicks via Testing-Library. The earlier two tests
// (save-lifecycle, re-OCR diff) never trigger the source `<img>`'s onLoad,
// so `naturalSize` stays {0,0} and `WordBboxOverlay` early-returns before
// any Rect mounts — they're unaffected by the change.
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
            project_id: String(params.projectId),
            idx0: Number(params.idx0),
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
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
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
    expect(patchCalls[0].url).toMatch(
      /\/api\/data\/projects\/prj_abc\/pages\/0\/text$/,
    );
    expect(patchCalls[0].body).toEqual({
      split_suffix: null,
      text: "first line\nsecond line\n extra",
    });

    // Post-save UI: dirty cleared.
    await screen.findByRole("button", { name: /^Saved$/i });
  });

  it("re-OCRs and shows diff", async () => {
    // Capture the body posted to /api/gpu/run-ocr-page so we can
    // assert the wire shape `reocr.mutate()` actually sends. The
    // route also mocks the GET endpoints the page issues on mount,
    // mirroring the first test's scaffold.
    const ocrCalls: { url: string; body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params.projectId),
            idx0: Number(params.idx0),
          }),
        ),
      ),
      http.get("/api/data/projects/:projectId/pages/:idx0/text/_", () =>
        HttpResponse.json({
          text: "alpha\nbeta\ngamma\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        }),
      ),
      // Re-OCR endpoint — returns a payload with a deliberate single-
      // line edit ("beta" -> "BETA") so the resulting diff is
      // guaranteed to have at least one delete row and one insert row
      // (the LCS keeps "alpha" / "gamma" as `equal`).
      http.post("/api/gpu/run-ocr-page", async ({ request }) => {
        ocrCalls.push({
          url: request.url,
          body: await request.json(),
        });
        return HttpResponse.json({
          text: "alpha\nBETA\ngamma\n",
          text_key: "projects/prj_abc/text/0001.txt",
          words: [],
        });
      }),
    );

    renderAtRoute(<TextReviewPage />, "/projects/prj_abc/pages/0/review");

    // Wait for the textarea to populate from the GET /text response.
    await waitFor(() => {
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
      expect(el).not.toBeNull();
      expect(el.value).toBe("alpha\nbeta\ngamma\n");
    });

    const user = userEvent.setup();
    const reocrBtn = screen.getByRole("button", {
      name: /^Re-OCR this page$/i,
    });
    await user.click(reocrBtn);

    // (a) POST fired with the documented body shape. `splitSuffix` is
    // empty, so the wire value is `null` (see TextReviewPage.tsx:121).
    await waitFor(() => {
      expect(ocrCalls).toHaveLength(1);
    });
    expect(ocrCalls[0].url).toMatch(/\/api\/gpu\/run-ocr-page$/);
    expect(ocrCalls[0].body).toEqual({
      project_id: "prj_abc",
      idx0: 0,
      split_suffix: null,
    });

    // (b) Textarea content is replaced with the re-OCR response.
    await waitFor(() => {
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
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
  // Force `WordBboxOverlay` to render its mocked Rects. Two gates
  // must fall together — the overlay early-returns on either alone:
  //   1. `naturalSize` (set by `<img>`.onLoad) must be non-zero, and
  //   2. the trackElement's getBoundingClientRect (read in the
  //      overlay's first sync `update()` before the ResizeObserver
  //      attaches) must be non-zero.
  // jsdom's default `getBoundingClientRect()` is all zeroes, and
  // the overlay's effect runs once on mount (deps are `[trackElement]`),
  // so we must stub the rect on `HTMLImageElement.prototype` BEFORE
  // the page mounts. fireImgLoad() then just sets natural dims and
  // dispatches the load event so the parent's `setNaturalSize` flips.
  // Restored in afterAll so the existing (save / re-OCR) describe
  // blocks above retain jsdom's default 0×0 rect — those tests rely
  // on `WordBboxOverlay` early-returning before any Rect mounts.
  let originalGetBoundingClientRect:
    | typeof HTMLImageElement.prototype.getBoundingClientRect
    | undefined;
  beforeAll(() => {
    originalGetBoundingClientRect =
      HTMLImageElement.prototype.getBoundingClientRect;
    HTMLImageElement.prototype.getBoundingClientRect = function () {
      return {
        width: 1000,
        height: 100,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
  });
  afterAll(() => {
    if (originalGetBoundingClientRect) {
      HTMLImageElement.prototype.getBoundingClientRect =
        originalGetBoundingClientRect;
    }
  });

  function fireImgLoad(natural: { w: number; h: number }) {
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    Object.defineProperty(img, "naturalWidth", {
      configurable: true,
      value: natural.w,
    });
    Object.defineProperty(img, "naturalHeight", {
      configurable: true,
      value: natural.h,
    });
    fireEvent.load(img);
  }

  function makeWordRow(id: string, x: number) {
    return {
      id,
      text: id,
      confidence: 0.99,
      bounding_box: { left: x, top: 0, width: 50, height: 20 },
    };
  }

  it("selects words via clicks, then DELETEs the selected ids on keydown", async () => {
    const deleteCalls: { url: string; body: unknown }[] = [];

    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params.projectId),
            idx0: Number(params.idx0),
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
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
      expect(el.value).toBe("alpha beta gamma\n");
    });

    // Light up the bbox overlay (see helper above for why both
    // dimensions and the bounding rect must be stubbed).
    fireImgLoad({ w: 1000, h: 100 });

    // Three rects → one per OCR word. The mock surfaces them as
    // `data-testid="konva-rect"` divs with the click handler bound.
    const rects = await screen.findAllByTestId("konva-rect");
    expect(rects).toHaveLength(3);

    const user = userEvent.setup();
    // Toggle-select the first two words.
    await user.click(rects[0]);
    await user.click(rects[1]);

    // The delete button label reflects selection size — proves the
    // selection state actually flipped.
    await screen.findByRole("button", { name: /^Delete 2 words$/i });

    // Press Delete on the body (NOT in the textarea — the keydown
    // handler is scope-aware and would no-op there). Window-level
    // keydown is what the page listens for.
    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => {
      expect(deleteCalls).toHaveLength(1);
    });
    expect(deleteCalls[0].url).toMatch(
      /\/api\/data\/projects\/prj_abc\/pages\/0\/words$/,
    );
    expect(deleteCalls[0].body).toEqual({
      word_ids: ["w_alpha", "w_beta"],
      split_suffix: null,
    });

    // After success: textarea reflects the rebuilt text, button
    // returns to its empty-selection label.
    await waitFor(() => {
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
      expect(el.value).toBe("gamma\n");
    });
    await screen.findByRole("button", { name: /^Delete words$/i });
  });

  it("clears selection when Escape is pressed", async () => {
    server.use(
      http.get("/api/data/projects/:projectId/pages/:idx0", ({ params }) =>
        HttpResponse.json(
          makePage({
            project_id: String(params.projectId),
            idx0: Number(params.idx0),
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
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
      expect(el.value).toBe("alpha beta gamma\n");
    });

    fireImgLoad({ w: 1000, h: 100 });

    const rects = await screen.findAllByTestId("konva-rect");
    expect(rects).toHaveLength(3);

    const user = userEvent.setup();
    await user.click(rects[0]);
    await user.click(rects[1]);

    // Selection of two words → Delete button reflects size; Clear
    // button is now visible alongside it.
    await screen.findByRole("button", { name: /^Delete 2 words$/i });
    expect(
      screen.getByRole("button", { name: /^Clear selection$/i }),
    ).toBeInTheDocument();

    // Press Escape on the body — handler is scope-aware (mirrors the
    // Delete keydown path) and clears `selectedWordIds`.
    fireEvent.keyDown(window, { key: "Escape" });

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
            project_id: String(params.projectId),
            idx0: Number(params.idx0),
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
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
      expect(el.value).toBe("alpha beta gamma\n");
    });

    fireImgLoad({ w: 1000, h: 100 });

    const rects = await screen.findAllByTestId("konva-rect");
    expect(rects).toHaveLength(3);

    const user = userEvent.setup();
    await user.click(rects[0]);
    await user.click(rects[1]);

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
            project_id: String(params.projectId),
            idx0: Number(params.idx0),
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
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
      expect(el.value).toBe("alpha beta\n");
    });

    // No rect clicks → empty selection → Delete must not fire a
    // request. Give the event loop a tick for any spurious mutation
    // to surface, then assert nothing landed.
    fireEvent.keyDown(window, { key: "Delete" });
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteCalls).toHaveLength(0);

    // Toolbar button is also disabled in the empty-selection state.
    const btn = screen.getByRole("button", { name: /^Delete words$/i });
    expect(btn).toBeDisabled();
  });
});
