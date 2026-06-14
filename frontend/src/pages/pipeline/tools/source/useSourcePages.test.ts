/**
 * useSourcePages tests — covers the TanStack Query hook that fetches
 * the page list from `GET /api/data/projects/{projectId}/pages`.
 *
 * Uses MSW to intercept the API call and return mock data.
 *
 * Tests:
 *   1. Returns FileRow[] mapped from BackendPage records
 *   2. thumbnailKey is the ingest-thumbnail URL (not the grayscale stage thumbnail)
 *   3. page_type reverse-map: normal→page, cover→cover, blank→blank, skip→skipped
 *   4. ignore=true wins over page_type (shows "skipped" regardless of page_type)
 *   5. isError=true on non-2xx response
 *   6. Returns empty array when enabled=false
 *   7. [ROUND-TRIP] mark cover → refetch → role chip still shows cover
 *   8. [ROUND-TRIP] back/duplicate collapse to skip honestly on reload
 *
 * ## State-mapping contract (after Wave-2 fix)
 * - ignore=true wins over page_type → "skipped" (manual soft-remove)
 * - page_type "normal"  → "page"
 * - page_type "cover"   → "cover"
 * - page_type "blank"   → "blank"
 * - page_type "skip"    → "skipped" (back + duplicate both write "skip";
 *                          they cannot be distinguished on reload — backend
 *                          limitation; see PAGE_TYPE_TO_FILE_STATE in useSourcePages.ts)
 * - unknown page_type   → "ready" (safe default)
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { createElement } from "react";
import { useSourcePages, fetchAllSourcePages } from "./useSourcePages";
import { server } from "@/test/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

/** Stateful fake backend — stores PATCH page_type and reflects it on GET. */
function makeStatefulBackend(projectId: string): {
  pageStore: Map<number, { page_type: string; ignore: boolean }>;
} {
  const baseUrl = `/api/data/projects/${projectId}/pages`;

  // Initial state: three pages, all normal / not ignored
  const pageStore = new Map<number, { page_type: string; ignore: boolean }>([
    [0, { page_type: "normal", ignore: false }],
    [1, { page_type: "normal", ignore: false }],
    [2, { page_type: "normal", ignore: false }],
  ]);

  // GET handler — returns current pageStore state
  server.use(
    http.get(`*${baseUrl}*`, () => {
      const pages = Array.from(pageStore.entries()).map(([idx0, p]) => ({
        idx0,
        source_stem: `page_${String(idx0).padStart(4, "0")}`,
        thumbnail_key: null,
        ignore: p.ignore,
        page_type: p.page_type,
      }));
      return HttpResponse.json({ pages, next_cursor: null });
    }),

    // PATCH handler — stores page_type and/or ignore updates
    http.patch(`*${baseUrl}/:idx0`, async ({ params, request }) => {
      const idx0 = Number(params["idx0"]);
      const body = (await request.json()) as {
        page_type?: string;
        ignore?: boolean;
      };
      const current = pageStore.get(idx0) ?? {
        page_type: "normal",
        ignore: false,
      };
      pageStore.set(idx0, {
        page_type: body.page_type ?? current.page_type,
        ignore: body.ignore ?? current.ignore,
      });
      return HttpResponse.json({ ok: true });
    }),
  );

  return { pageStore };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSourcePages", () => {
  const PROJECT_ID = "test-project-abc";
  const BASE_URL = `/api/data/projects/${PROJECT_ID}/pages`;

  beforeEach(() => {
    server.use(
      http.get(`*${BASE_URL}*`, () => {
        return HttpResponse.json({
          pages: [
            {
              idx0: 0,
              source_stem: "survivals_0000",
              thumbnail_key: "projects/abc/thumbs/0000.jpg",
              ignore: false,
              // page_type "normal" → state "page"
              page_type: "normal",
            },
            {
              idx0: 1,
              source_stem: "survivals_0001",
              thumbnail_key: null,
              ignore: false,
              // page_type "cover" → state "cover"
              page_type: "cover",
            },
            {
              idx0: 2,
              source_stem: "survivals_0002",
              thumbnail_key: "projects/abc/thumbs/0002.jpg",
              // ignore=true wins over page_type → state "skipped"
              ignore: true,
              page_type: "normal",
            },
          ],
          next_cursor: null,
        });
      }),
    );
  });

  it("returns FileRow[] mapped from backend pages", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.files).toHaveLength(3);
    // page_type "normal" + ignore=false → "page"
    // thumbnailKey is the ingest-thumbnail URL
    expect(result.current.files[0]).toMatchObject({
      idx: 0,
      stem: "survivals_0000",
      state: "page",
      thumbnailKey: `/api/data/projects/${PROJECT_ID}/pages/0/thumbnail`,
    });
  });

  it("thumbnailKey is the ingest-thumbnail URL (not grayscale stage thumbnail)", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const f0 = result.current.files[0];
    const f1 = result.current.files[1];
    const f2 = result.current.files[2];
    // All pages get the ingest-thumbnail URL (works at Source time before any stage runs).
    // The grayscale stage thumbnail (/stages/grayscale/thumbnail) would 404 at Source time.
    expect(f0?.thumbnailKey).toBe(
      `/api/data/projects/${PROJECT_ID}/pages/0/thumbnail`,
    );
    expect(f1?.thumbnailKey).toBe(
      `/api/data/projects/${PROJECT_ID}/pages/1/thumbnail`,
    );
    expect(f2?.thumbnailKey).toBe(
      `/api/data/projects/${PROJECT_ID}/pages/2/thumbnail`,
    );
  });

  it("page_type reverse-map: normal→page, cover→cover, blank→blank, skip→skipped", async () => {
    server.use(
      http.get(`*${BASE_URL}*`, () => {
        return HttpResponse.json({
          pages: [
            {
              idx0: 0,
              source_stem: "p0",
              thumbnail_key: null,
              ignore: false,
              page_type: "normal",
            },
            {
              idx0: 1,
              source_stem: "p1",
              thumbnail_key: null,
              ignore: false,
              page_type: "cover",
            },
            {
              idx0: 2,
              source_stem: "p2",
              thumbnail_key: null,
              ignore: false,
              page_type: "blank",
            },
            {
              idx0: 3,
              source_stem: "p3",
              thumbnail_key: null,
              ignore: false,
              page_type: "skip",
            },
            {
              idx0: 4,
              source_stem: "p4",
              thumbnail_key: null,
              ignore: false,
              page_type: "plate_b",
            },
          ],
          next_cursor: null,
        });
      }),
    );

    const files = await fetchAllSourcePages(PROJECT_ID);

    expect(files[0]?.state).toBe("page"); // normal → page
    expect(files[1]?.state).toBe("cover"); // cover → cover
    expect(files[2]?.state).toBe("blank"); // blank → blank
    expect(files[3]?.state).toBe("skipped"); // skip → skipped (back + duplicate collapse here)
    expect(files[4]?.state).toBe("ready"); // plate_b → ready (unknown → safe default)
  });

  it("ignore=true wins over page_type (shows skipped regardless of page_type)", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // pages[0] page_type=normal, ignore=false → "page"
    expect(result.current.files[0]?.state).toBe("page");
    // pages[1] page_type=cover, ignore=false → "cover"
    expect(result.current.files[1]?.state).toBe("cover");
    // pages[2] page_type=normal, ignore=true → "skipped" (ignore wins)
    expect(result.current.files[2]?.state).toBe("skipped");
  });

  it("returns empty array when enabled=false", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID, false), {
      wrapper: makeWrapper(),
    });

    // Should not even start loading
    expect(result.current.isLoading).toBe(false);
    expect(result.current.files).toHaveLength(0);
  });

  it("reports isError=true on non-2xx response", async () => {
    server.use(
      http.get(`*${BASE_URL}*`, () => {
        return HttpResponse.json({ detail: "not found" }, { status: 404 });
      }),
    );

    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.files).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests — stateful fake backend
// ---------------------------------------------------------------------------

describe("useSourcePages — round-trip role persistence", () => {
  const PROJECT_ID = "round-trip-project";

  it("mark cover → refetch → role chip still shows cover", async () => {
    // Set up stateful backend: PATCH stores page_type, GET reflects it.
    const { pageStore } = makeStatefulBackend(PROJECT_ID);

    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    // Initial load: all pages are "normal" → state "page"... wait, normal→page.
    // Let me confirm initial state first.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.files[0]?.state).toBe("page"); // normal → page

    // Simulate PATCH page_type=cover (the machine does this via markSelectedPages).
    // We update pageStore directly as if the PATCH was sent and stored.
    pageStore.set(0, { page_type: "cover", ignore: false });

    // Refetch simulates a reload: new GET will return the updated page_type.
    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.files[0]?.state).toBe("cover");
    });
  });

  it("mark blank → refetch → role chip still shows blank", async () => {
    const { pageStore } = makeStatefulBackend(PROJECT_ID);

    const files = await fetchAllSourcePages(PROJECT_ID);
    expect(files[1]?.state).toBe("page"); // initial: normal → page

    // Simulate PATCH page_type=blank
    pageStore.set(1, { page_type: "blank", ignore: false });

    const filesAfter = await fetchAllSourcePages(PROJECT_ID);
    expect(filesAfter[1]?.state).toBe("blank");
  });

  it("soft-remove (ignore=true) → refetch → page comes back as skipped (reversible)", async () => {
    const { pageStore } = makeStatefulBackend(PROJECT_ID);

    const files = await fetchAllSourcePages(PROJECT_ID);
    expect(files[2]?.state).toBe("page"); // initial

    // Simulate PATCH ignore=true (Remove from project)
    pageStore.set(2, { page_type: "normal", ignore: true });

    const filesAfter = await fetchAllSourcePages(PROJECT_ID);
    expect(filesAfter[2]?.state).toBe("skipped"); // ignore=true wins
  });

  it("back/duplicate collapse to skip on reload (documented limitation)", async () => {
    // Both "back" and "duplicate" FileStates map to page_type="skip" on save.
    // On reload, page_type="skip" → "skipped" (state).
    // The original "back" vs "duplicate" distinction is NOT recoverable.
    // This test confirms the honest behaviour: skip → "skipped", not silently "ready".
    const { pageStore } = makeStatefulBackend(PROJECT_ID);

    // Simulate: user marked page 0 as "back" (which writes page_type="skip")
    pageStore.set(0, { page_type: "skip", ignore: false });

    const files = await fetchAllSourcePages(PROJECT_ID);
    // After reload: "skip" → "skipped" (not "ready", not "back")
    expect(files[0]?.state).toBe("skipped");

    // Simulate: user marked page 1 as "duplicate" (also writes page_type="skip")
    pageStore.set(1, { page_type: "skip", ignore: false });

    const files2 = await fetchAllSourcePages(PROJECT_ID);
    expect(files2[1]?.state).toBe("skipped");

    // Both collapse — they can't be told apart from each other or from
    // a soft-remove. This is a backend limitation (no back/duplicate enum).
  });
});
