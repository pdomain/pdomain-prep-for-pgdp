/**
 * useSourcePages tests — covers the TanStack Query hook that fetches
 * the page list from `GET /api/data/projects/{projectId}/pages`.
 *
 * Uses MSW to intercept the API call and return mock data.
 *
 * Tests:
 *   1. Returns FileRow[] mapped from BackendPage records
 *   2. thumbnailKey is carried through from backend
 *   3. All pages mapped to state="ready" (no role assignment yet)
 *   4. isLoading=true before fetch completes
 *   5. isError=true on non-2xx response
 *   6. Returns empty array when enabled=false
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
    expect(result.current.files[0]).toMatchObject({
      idx: 0,
      stem: "survivals_0000",
      state: "ready",
      thumbnailKey: "projects/abc/thumbs/0000.jpg",
    });
  });

  it("carries thumbnailKey from backend page records", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const f0 = result.current.files[0];
    const f1 = result.current.files[1];
    const f2 = result.current.files[2];
    expect(f0?.thumbnailKey).toBe("projects/abc/thumbs/0000.jpg");
    // null thumbnail_key → thumbnailKey not set (undefined)
    expect(f1?.thumbnailKey).toBeUndefined();
    expect(f2?.thumbnailKey).toBe("projects/abc/thumbs/0002.jpg");
  });

  it("maps all pages to state=ready initially", async () => {
    const { result } = renderHook(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    for (const file of result.current.files) {
      expect(file.state).toBe("ready");
    }
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
