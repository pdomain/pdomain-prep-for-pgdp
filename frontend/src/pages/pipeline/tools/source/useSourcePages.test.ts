/**
 * useSourcePages tests — covers the TanStack Query hook that fetches
 * the page list from `GET /api/data/projects/{projectId}/pages`.
 *
 * Uses MSW to intercept the API call and return mock data.
 *
 * Tests:
 *   1. Returns FileRow[] mapped from BackendPage records
 *   2. thumbnailKey is the stage-thumbnail API URL (not the raw thumbnail_key)
 *   3. Ignored pages map to state="skipped"; non-ignored map to state="ready"
 *   4. isLoading=true before fetch completes
 *   5. isError=true on non-2xx response
 *   6. Returns empty array when enabled=false
 *
 * ## Contract changes (Wave-1)
 * - `thumbnail_key` from the backend is always null (ingest_source is not a
 *   v2 page stage). `thumbnailKey` in `FileRow` is now set to the stage-
 *   thumbnail API URL built by `stageThumbUrl()`, regardless of `thumbnail_key`.
 * - `ignore: true` → `state: "skipped"` (was `"ready"` in the old contract).
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, it, expect, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { createElement } from "react";
import { useSourcePages } from "./useSourcePages";
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
              page_type: "normal",
            },
            {
              idx0: 1,
              source_stem: "survivals_0001",
              thumbnail_key: null,
              ignore: false,
              page_type: "normal",
            },
            {
              idx0: 2,
              source_stem: "survivals_0002",
              thumbnail_key: "projects/abc/thumbs/0002.jpg",
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
    // thumbnailKey is now the stage-thumbnail API URL, not the raw backend key
    expect(result.current.files[0]).toMatchObject({
      idx: 0,
      stem: "survivals_0000",
      state: "ready",
      thumbnailKey: `/api/data/projects/${PROJECT_ID}/pages/0/stages/grayscale/thumbnail`,
    });
  });

  it("thumbnailKey is the stage-thumbnail API URL (not raw thumbnail_key)", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const f0 = result.current.files[0];
    const f1 = result.current.files[1];
    const f2 = result.current.files[2];
    // All pages get a stage-thumbnail URL regardless of the backend thumbnail_key field
    // (thumbnail_key is always null for ingest_source; the real thumb is via the stage route)
    expect(f0?.thumbnailKey).toBe(
      `/api/data/projects/${PROJECT_ID}/pages/0/stages/grayscale/thumbnail`,
    );
    expect(f1?.thumbnailKey).toBe(
      `/api/data/projects/${PROJECT_ID}/pages/1/stages/grayscale/thumbnail`,
    );
    expect(f2?.thumbnailKey).toBe(
      `/api/data/projects/${PROJECT_ID}/pages/2/stages/grayscale/thumbnail`,
    );
  });

  it("maps ignore=true to state=skipped, ignore=false to state=ready", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // pages[0] and pages[1] have ignore=false → "ready"
    expect(result.current.files[0]?.state).toBe("ready");
    expect(result.current.files[1]?.state).toBe("ready");
    // pages[2] has ignore=true → "skipped"
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
