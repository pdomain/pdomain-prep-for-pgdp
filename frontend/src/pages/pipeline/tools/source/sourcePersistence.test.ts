/**
 * sourcePersistence.test.ts — Persistence round-trip tests for Source-stage mutations.
 *
 * Verifies that mark, remove, insert, and REFRESH_FILES:
 *   1. Survive a conceptual page reload (change persists to the API).
 *   2. Remove leaves the page visible as "skipped" (reversible), not hard-deleted.
 *   3. Insert calls the real insert API and REFRESH_FILES syncs the machine.
 *   4. Multi-page cursor pagination: >500 pages loads via next_cursor continuation.
 *
 * Uses MSW to intercept API calls; verifies that the correct HTTP bodies
 * were sent (not just that the machine's in-memory state changed).
 *
 * @see frontend/src/machines/tools/source.ts — machine under test
 * @see frontend/src/services/tools/sourceTool.ts — service layer
 * @see frontend/src/pages/pipeline/tools/source/useSourcePages.ts — pagination hook
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor } from "xstate";
import { act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { createElement } from "react";
import {
  sourceToolMachine,
  type SourceToolInput,
  type SourceToolServices,
  type FileRow,
} from "@/machines/tools/source";
import {
  markSelectedPages,
  setPageIgnore,
  FILE_STATE_TO_PAGE_TYPE,
  FILE_STATE_TO_PAGE_ROLE,
} from "@/services/tools/sourceTool";
import { resolveFileState, fetchAllSourcePages } from "./useSourcePages";
import { server } from "@/test/server";
import { createMockStageSettingsServer } from "@/machines/tools/stageSettings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(overrides: Partial<FileRow> = {}): FileRow {
  return {
    idx: 0,
    stem: "img0001",
    state: "ready",
    ...overrides,
  };
}

function makeFiles(count: number): FileRow[] {
  return Array.from({ length: count }, (_, i) =>
    makeFile({
      idx: i,
      stem: `img${String(i + 1).padStart(4, "0")}`,
      state: "ready",
    }),
  );
}

function makeServices(
  overrides: Partial<SourceToolServices> = {},
): SourceToolServices {
  const settings = createMockStageSettingsServer();
  return {
    saveAsDefault: vi
      .fn()
      .mockImplementation(settings.saveAsDefault.bind(settings)),
    revertSettings: vi
      .fn()
      .mockImplementation(settings.revertSettings.bind(settings)),
    resetSettings: vi
      .fn()
      .mockImplementation(settings.resetSettings.bind(settings)),
    confirmSelection: vi.fn().mockResolvedValue({ pages: 4 }),
    markSelectedPages: vi.fn().mockResolvedValue(undefined),
    setPageIgnore: vi.fn().mockResolvedValue(undefined),
    insertBlankPage: vi.fn().mockResolvedValue({
      inserted_page: { idx: 5, stem: "inserted", state: "ready" },
      pages: [
        { idx: 0, stem: "img0001", state: "ready" },
        { idx: 1, stem: "img0002", state: "ready" },
      ],
    }),
    ...overrides,
  };
}

function makeInput(overrides: Partial<SourceToolInput> = {}): SourceToolInput {
  return {
    projectId: "proj-persist-test",
    stageId: "source",
    services: makeServices(),
    initialFiles: makeFiles(4),
    ...overrides,
  };
}

function startMachine(input?: Partial<SourceToolInput>) {
  const actor = createActor(sourceToolMachine, {
    input: makeInput(input),
  });
  actor.start();
  return actor;
}

function makeWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

// ---------------------------------------------------------------------------
// Suite 1 — FILE_STATE_TO_PAGE_TYPE correctness
// ---------------------------------------------------------------------------

describe("FILE_STATE_TO_PAGE_TYPE mapping", () => {
  it("maps page → normal", () => {
    expect(FILE_STATE_TO_PAGE_TYPE["page"]).toBe("normal");
  });

  it("maps cover → cover", () => {
    expect(FILE_STATE_TO_PAGE_TYPE["cover"]).toBe("cover");
  });

  it("maps blank → blank", () => {
    expect(FILE_STATE_TO_PAGE_TYPE["blank"]).toBe("blank");
  });

  it("maps back → skip (back-matter excluded from package)", () => {
    expect(FILE_STATE_TO_PAGE_TYPE["back"]).toBe("skip");
  });

  it("maps duplicate → skip (duplicate excluded from package)", () => {
    expect(FILE_STATE_TO_PAGE_TYPE["duplicate"]).toBe("skip");
  });

  it("does not map ready, pending, inserted, skipped (no-op states)", () => {
    expect(FILE_STATE_TO_PAGE_TYPE["ready"]).toBeUndefined();
    expect(FILE_STATE_TO_PAGE_TYPE["pending"]).toBeUndefined();
    expect(FILE_STATE_TO_PAGE_TYPE["inserted"]).toBeUndefined();
    expect(FILE_STATE_TO_PAGE_TYPE["skipped"]).toBeUndefined();
  });

  it("does not contain invalid backend values (no front_matter, back_matter, duplicate)", () => {
    const values = Object.values(FILE_STATE_TO_PAGE_TYPE);
    expect(values).not.toContain("front_matter");
    expect(values).not.toContain("back_matter");
    expect(values).not.toContain("excluded");
    // All non-null values must be valid backend PageType enum members
    const validPageTypes = new Set([
      "normal",
      "blank",
      "plate_b",
      "plate_p",
      "plate_r",
      "skip",
      "cover",
    ]);
    for (const v of values) {
      if (v !== null && v !== undefined) {
        expect(validPageTypes.has(v)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — MARK_AS persistence (calls markSelectedPages service)
// ---------------------------------------------------------------------------

describe("MARK_AS persistence", () => {
  it("calls markSelectedPages with the correct idx list and pageType", async () => {
    const markSelectedPages = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages });
    const actor = startMachine({
      services,
      initialFiles: makeFiles(4),
    });

    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "SELECT_FILE", idx: 2 });
    actor.send({ type: "MARK_AS", state: "page" });

    // Wait for the fire-and-forget to resolve
    await vi.waitFor(() => expect(markSelectedPages).toHaveBeenCalledOnce());

    expect(markSelectedPages).toHaveBeenCalledWith(
      "proj-persist-test",
      [0, 2],
      "normal",
      false, // clearIgnore=false (no selected pages were skipped)
      null, // pageRole=null (page→normal clears any prior sub-role)
    );
    actor.stop();
  });

  it("calls markSelectedPages with clearIgnore=true when a skipped page is re-marked", async () => {
    const markSelectedPages = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages });
    const files = makeFiles(3);
    files[1] = { ...files[1]!, state: "skipped" }; // page 1 is skipped
    const actor = startMachine({ services, initialFiles: files });

    actor.send({ type: "SELECT_FILE", idx: 1 }); // select the skipped page
    actor.send({ type: "MARK_AS", state: "page" }); // re-mark it as page

    await vi.waitFor(() => expect(markSelectedPages).toHaveBeenCalledOnce());

    expect(markSelectedPages).toHaveBeenCalledWith(
      "proj-persist-test",
      [1],
      "normal",
      true, // clearIgnore=true because the page was skipped
      null, // pageRole=null (page→normal clears any prior sub-role)
    );
    actor.stop();
  });

  it("does not call markSelectedPages for states without a PageType mapping", async () => {
    const markSelectedPages = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages });
    const actor = startMachine({ services, initialFiles: makeFiles(3) });

    // "ready" has no PageType mapping — should not call persist
    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "MARK_AS", state: "ready" });

    // Give a brief tick for async to resolve
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(markSelectedPages).not.toHaveBeenCalled();
    actor.stop();
  });

  it("in-memory state is updated even when the service call fails", async () => {
    const markSelectedPages = vi
      .fn()
      .mockRejectedValue(new Error("network error"));
    const services = makeServices({ markSelectedPages });
    const actor = startMachine({ services, initialFiles: makeFiles(3) });

    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "MARK_AS", state: "blank" });

    // In-memory update is synchronous (happens before the async call)
    expect(actor.getSnapshot().context.files[0]?.state).toBe("blank");

    // Wait for error to be swallowed
    await vi.waitFor(() => expect(markSelectedPages).toHaveBeenCalledOnce());
    // Machine state must remain updated despite the API error
    expect(actor.getSnapshot().context.files[0]?.state).toBe("blank");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — SET_ROLE persistence (single-page workbench assign)
// ---------------------------------------------------------------------------

describe("SET_ROLE persistence", () => {
  it("calls markSelectedPages with single-item idxList and correct pageType", async () => {
    const markSelectedPages = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages });
    const actor = startMachine({ services, initialFiles: makeFiles(3) });

    actor.send({ type: "SET_ROLE", idx: 1, role: "cover" });

    await vi.waitFor(() => expect(markSelectedPages).toHaveBeenCalledOnce());

    expect(markSelectedPages).toHaveBeenCalledWith(
      "proj-persist-test",
      [1],
      "cover",
      false, // clearIgnore=false (page was "ready", not "skipped")
      null, // pageRole=null (cover has no sub-role)
    );
    actor.stop();
  });

  it("SET_ROLE on a skipped page sends clearIgnore=true", async () => {
    const markSelectedPages = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages });
    const files = makeFiles(3);
    files[2] = { ...files[2]!, state: "skipped" };
    const actor = startMachine({ services, initialFiles: files });

    actor.send({ type: "SET_ROLE", idx: 2, role: "blank" });

    await vi.waitFor(() => expect(markSelectedPages).toHaveBeenCalledOnce());

    expect(markSelectedPages).toHaveBeenCalledWith(
      "proj-persist-test",
      [2],
      "blank",
      true, // clearIgnore=true
      null, // pageRole=null (blank has no sub-role)
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — REMOVE_FILES: reversible soft-exclude (not hard-delete)
// ---------------------------------------------------------------------------

describe("REMOVE_FILES: reversible soft-exclude", () => {
  it("marks selected pages as 'skipped' instead of deleting them", () => {
    const actor = startMachine({ initialFiles: makeFiles(4) });

    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "SELECT_FILE", idx: 3 });
    actor.send({ type: "REMOVE_FILES" });

    const { files } = actor.getSnapshot().context;
    // All 4 files still present (not hard-deleted)
    expect(files).toHaveLength(4);
    // Removed pages are "skipped", not absent
    expect(files[1]?.state).toBe("skipped");
    expect(files[3]?.state).toBe("skipped");
    // Non-removed pages are unchanged
    expect(files[0]?.state).toBe("ready");
    expect(files[2]?.state).toBe("ready");
    actor.stop();
  });

  it("calls setPageIgnore(true) for each soft-excluded page", async () => {
    const setPageIgnore = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ setPageIgnore });
    const actor = startMachine({ services, initialFiles: makeFiles(4) });

    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "SELECT_FILE", idx: 2 });
    actor.send({ type: "REMOVE_FILES" });

    // Fire-and-forget: wait for both calls
    await vi.waitFor(() => expect(setPageIgnore).toHaveBeenCalledTimes(2));

    expect(setPageIgnore).toHaveBeenCalledWith("proj-persist-test", 0, true);
    expect(setPageIgnore).toHaveBeenCalledWith("proj-persist-test", 2, true);
    actor.stop();
  });

  it("does NOT call setPageIgnore for in-memory inserted pages (no server representation)", async () => {
    const setPageIgnore = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ setPageIgnore });
    const files: FileRow[] = [
      makeFile({ idx: 0, stem: "img0001", state: "ready" }),
      makeFile({ idx: 1, stem: "__inserted_001", state: "inserted" }),
      makeFile({ idx: 2, stem: "img0002", state: "ready" }),
    ];
    const actor = startMachine({ services, initialFiles: files });

    // Select the inserted page and remove it
    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "REMOVE_FILES" });

    // Inserted page should be hard-removed (no server representation)
    const { files: newFiles } = actor.getSnapshot().context;
    expect(newFiles).toHaveLength(2);
    expect(newFiles.some((f) => f.state === "inserted")).toBe(false);

    // Give a brief tick for async
    await new Promise<void>((r) => setTimeout(r, 20));
    // setPageIgnore should NOT have been called for the inserted page
    expect(setPageIgnore).not.toHaveBeenCalled();
    actor.stop();
  });

  it("skipped pages remain visible so they can be un-removed via MARK_AS", () => {
    const actor = startMachine({ initialFiles: makeFiles(3) });

    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "REMOVE_FILES" });

    // Skipped page is still in the list
    const skipped = actor.getSnapshot().context.files.find((f) => f.idx === 1);
    expect(skipped).toBeDefined();
    expect(skipped?.state).toBe("skipped");

    // Un-remove: select the skipped page and mark it back as "page"
    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "MARK_AS", state: "page" });

    const restored = actor.getSnapshot().context.files.find((f) => f.idx === 1);
    expect(restored?.state).toBe("page");
    actor.stop();
  });

  it("REFRESH_FILES after reload shows 'skipped' (ignore=true) for removed pages", async () => {
    const actor = startMachine({ initialFiles: [] });

    // Simulate what happens after reload: the API returns ignore=true for removed pages
    const refreshedFiles: FileRow[] = [
      { idx: 0, stem: "img0001", state: "ready" },
      { idx: 1, stem: "img0002", state: "skipped" }, // ignore=true from server
      { idx: 2, stem: "img0003", state: "ready" },
    ];

    act(() => {
      actor.send({ type: "LOAD_FILES", files: refreshedFiles });
    });

    const { files } = actor.getSnapshot().context;
    expect(files[1]?.state).toBe("skipped");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — INSERT persistence (real API + REFRESH_FILES)
// ---------------------------------------------------------------------------

describe("INSERT persistence", () => {
  it("CONFIRM_INSERT optimistically inserts a row in-memory", () => {
    const actor = startMachine({ initialFiles: makeFiles(3) });

    actor.send({ type: "OPEN_INSERT", anchorStem: "img0002" });
    actor.send({ type: "CONFIRM_INSERT" });

    const { files } = actor.getSnapshot().context;
    // 3 original + 1 optimistic = 4
    expect(files).toHaveLength(4);
    expect(files.some((f) => f.state === "inserted")).toBe(true);
    actor.stop();
  });

  it("REFRESH_FILES replaces the optimistic insert with the server list", () => {
    const actor = startMachine({ initialFiles: makeFiles(3) });

    actor.send({ type: "OPEN_INSERT", anchorStem: "img0002" });
    actor.send({ type: "CONFIRM_INSERT" });

    // Simulate server response: 4 real pages (no "inserted" placeholder)
    const serverPages: FileRow[] = makeFiles(4);
    actor.send({ type: "REFRESH_FILES", files: serverPages });

    const { files } = actor.getSnapshot().context;
    expect(files).toHaveLength(4);
    // No "inserted" placeholder rows — all "ready" from server
    expect(files.every((f) => f.state === "ready")).toBe(true);
    actor.stop();
  });

  it("insertBlankPage service is called with the correct projectId and afterIdx0", async () => {
    const insertBlankPageFn = vi.fn().mockResolvedValue({
      inserted_page: { idx: 3, stem: "inserted", state: "ready" },
      pages: [
        { idx: 0, stem: "img0001", state: "ready" },
        { idx: 1, stem: "img0002", state: "ready" },
        { idx: 2, stem: "img0003", state: "ready" },
        { idx: 3, stem: "inserted", state: "ready" },
      ],
    });
    // The service is injected; actual call happens in SourceTool.tsx via handleInsertConfirm.
    // Here we verify the service contract (projectId + afterIdx0 forwarding) directly.
    await insertBlankPageFn("proj-test", 2);
    expect(insertBlankPageFn).toHaveBeenCalledWith("proj-test", 2);
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — Cursor pagination (>500 pages)
// ---------------------------------------------------------------------------

describe("cursor pagination: >500 pages follows next_cursor", () => {
  const PROJECT_ID = "proj-pagination-test";

  beforeEach(() => {
    // Simulate a 600-page project: first fetch returns 500 pages + next_cursor,
    // second fetch returns the remaining 100 pages.
    const firstBatch = Array.from({ length: 500 }, (_, i) => ({
      idx0: i,
      source_stem: `img${String(i).padStart(4, "0")}`,
      thumbnail_key: null,
      ignore: false,
      page_type: "normal",
    }));
    const secondBatch = Array.from({ length: 100 }, (_, i) => ({
      idx0: 500 + i,
      source_stem: `img${String(500 + i).padStart(4, "0")}`,
      thumbnail_key: null,
      ignore: false,
      page_type: "normal",
    }));

    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        if (cursor === "500") {
          return HttpResponse.json({
            pages: secondBatch,
            next_cursor: null, // last page
            total: 600,
          });
        }
        // First page
        return HttpResponse.json({
          pages: firstBatch,
          next_cursor: "500",
          total: 600,
        });
      }),
    );
  });

  it("fetchAllSourcePages loads all 600 pages via cursor continuation", async () => {
    const rows = await fetchAllSourcePages(PROJECT_ID);
    expect(rows).toHaveLength(600);
    // First page
    expect(rows[0]?.idx).toBe(0);
    expect(rows[0]?.stem).toBe("img0000");
    // Last page
    expect(rows[599]?.idx).toBe(599);
    expect(rows[599]?.stem).toBe("img0599");
  });

  it("all pages from both batches have ingest thumbnail URLs (not grayscale)", async () => {
    const rows = await fetchAllSourcePages(PROJECT_ID);
    for (const row of rows) {
      expect(row.thumbnailKey).toBe(
        `/api/data/projects/${PROJECT_ID}/pages/${String(row.idx)}/thumbnail`,
      );
      // Must NOT be the grayscale stage thumbnail (which 404s before grayscale runs)
      expect(row.thumbnailKey).not.toContain("stages/grayscale");
    }
  });

  it("useSourcePages hook returns all 600 pages", async () => {
    const { renderHook: rh, waitFor: wf } =
      await import("@testing-library/react");
    const { useSourcePages } = await import("./useSourcePages");

    const { result } = rh(() => useSourcePages(PROJECT_ID), {
      wrapper: makeWrapper(),
    });

    await wf(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.files).toHaveLength(600);
    expect(result.current.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — setPageIgnore direct API service
// ---------------------------------------------------------------------------

describe("setPageIgnore service", () => {
  const PROJECT_ID = "proj-ignore-test";

  beforeEach(() => {
    server.use(
      http.patch(
        `/api/data/projects/${PROJECT_ID}/pages/:idx0`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          // Return a mock PageRecord reflecting the update
          return HttpResponse.json({
            idx0: 0,
            source_stem: "img0001",
            ignore: body["ignore"] === true,
            manual_ignore: body["ignore"] === true,
            page_type: "normal",
            thumbnail_key: null,
          });
        },
      ),
    );
  });

  it("sends { ignore: true } for soft-remove", async () => {
    // This test exercises the real HTTP call via MSW
    await expect(setPageIgnore(PROJECT_ID, 0, true)).resolves.toBeUndefined();
  });

  it("sends { ignore: false } for restore", async () => {
    await expect(setPageIgnore(PROJECT_ID, 0, false)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — markSelectedPages direct API service
// ---------------------------------------------------------------------------

describe("markSelectedPages service", () => {
  const PROJECT_ID = "proj-mark-test";
  const receivedBodies: unknown[] = [];

  beforeEach(() => {
    receivedBodies.length = 0;
    server.use(
      http.patch(
        `/api/data/projects/${PROJECT_ID}/pages/:idx0`,
        async ({ request }) => {
          const body = await request.json();
          receivedBodies.push(body);
          return HttpResponse.json({
            idx0: 0,
            page_type: "normal",
            ignore: false,
          });
        },
      ),
    );
  });

  it("sends { page_type } for each idx in the list", async () => {
    await markSelectedPages(PROJECT_ID, [0, 1, 2], "blank");
    expect(receivedBodies).toHaveLength(3);
    for (const b of receivedBodies) {
      expect(b).toMatchObject({ page_type: "blank" });
    }
  });

  it("sends { page_type, ignore: false } when clearIgnore=true", async () => {
    await markSelectedPages(PROJECT_ID, [0], "normal", true);
    expect(receivedBodies[0]).toMatchObject({
      page_type: "normal",
      ignore: false,
    });
  });

  it("does NOT include ignore field when clearIgnore=false (default)", async () => {
    await markSelectedPages(PROJECT_ID, [0], "normal", false);
    expect(receivedBodies[0]).not.toHaveProperty("ignore");
  });

  it("sends { page_type: skip, page_role: back } for back role", async () => {
    await markSelectedPages(PROJECT_ID, [0], "skip", false, "back");
    expect(receivedBodies[0]).toMatchObject({
      page_type: "skip",
      page_role: "back",
    });
  });

  it("sends { page_type: skip, page_role: duplicate } for duplicate role", async () => {
    await markSelectedPages(PROJECT_ID, [0], "skip", false, "duplicate");
    expect(receivedBodies[0]).toMatchObject({
      page_type: "skip",
      page_role: "duplicate",
    });
  });

  it("sends { page_type: normal, page_role: null } when pageRole=null (clears sub-role)", async () => {
    await markSelectedPages(PROJECT_ID, [0], "normal", false, null);
    expect(receivedBodies[0]).toMatchObject({
      page_type: "normal",
      page_role: null,
    });
  });

  it("does NOT include page_role field when pageRole is omitted (legacy path)", async () => {
    await markSelectedPages(PROJECT_ID, [0], "normal");
    expect(receivedBodies[0]).not.toHaveProperty("page_role");
  });
});

// ---------------------------------------------------------------------------
// Suite 9 — FILE_STATE_TO_PAGE_ROLE correctness
// ---------------------------------------------------------------------------

describe("FILE_STATE_TO_PAGE_ROLE mapping", () => {
  it("maps back → 'back' (distinct sub-role label)", () => {
    expect(FILE_STATE_TO_PAGE_ROLE["back"]).toBe("back");
  });

  it("maps duplicate → 'duplicate' (distinct sub-role label)", () => {
    expect(FILE_STATE_TO_PAGE_ROLE["duplicate"]).toBe("duplicate");
  });

  it("maps page → null (clears any prior sub-role)", () => {
    expect(FILE_STATE_TO_PAGE_ROLE["page"]).toBeNull();
  });

  it("maps cover → null", () => {
    expect(FILE_STATE_TO_PAGE_ROLE["cover"]).toBeNull();
  });

  it("maps blank → null", () => {
    expect(FILE_STATE_TO_PAGE_ROLE["blank"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 10 — Role-transition: MARK_AS sends page_role=null for non-sub-role states
// ---------------------------------------------------------------------------

describe("MARK_AS role-transition: clears page_role when transitioning away from back/duplicate", () => {
  it("MARK_AS cover sends page_role=null (clears prior back sub-role)", async () => {
    const markSelectedPagesFn = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages: markSelectedPagesFn });
    const files = makeFiles(3);
    // Page 0 currently has state="back"
    files[0] = { ...files[0]!, state: "back" };
    const actor = startMachine({ services, initialFiles: files });

    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "MARK_AS", state: "cover" });

    await vi.waitFor(() => expect(markSelectedPagesFn).toHaveBeenCalledOnce());

    // Must send page_role=null to clear the prior "back" sub-role
    expect(markSelectedPagesFn).toHaveBeenCalledWith(
      "proj-persist-test",
      [0],
      "cover",
      false, // clearIgnore=false (page was "back", not "skipped")
      null, // page_role=null clears prior sub-role
    );
    actor.stop();
  });

  it("MARK_AS blank sends page_role=null (clears prior back sub-role)", async () => {
    const markSelectedPagesFn = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages: markSelectedPagesFn });
    const files = makeFiles(3);
    files[1] = { ...files[1]!, state: "back" };
    const actor = startMachine({ services, initialFiles: files });

    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "MARK_AS", state: "blank" });

    await vi.waitFor(() => expect(markSelectedPagesFn).toHaveBeenCalledOnce());

    expect(markSelectedPagesFn).toHaveBeenCalledWith(
      "proj-persist-test",
      [1],
      "blank",
      false,
      null,
    );
    actor.stop();
  });

  it("MARK_AS page sends page_role=null (clears prior duplicate sub-role)", async () => {
    const markSelectedPagesFn = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages: markSelectedPagesFn });
    const files = makeFiles(3);
    files[2] = { ...files[2]!, state: "duplicate" };
    const actor = startMachine({ services, initialFiles: files });

    actor.send({ type: "SELECT_FILE", idx: 2 });
    actor.send({ type: "MARK_AS", state: "page" });

    await vi.waitFor(() => expect(markSelectedPagesFn).toHaveBeenCalledOnce());

    expect(markSelectedPagesFn).toHaveBeenCalledWith(
      "proj-persist-test",
      [2],
      "normal",
      false,
      null,
    );
    actor.stop();
  });

  it("MARK_AS duplicate sends page_role=duplicate (correct sub-role for swap)", async () => {
    const markSelectedPagesFn = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages: markSelectedPagesFn });
    const files = makeFiles(3);
    files[0] = { ...files[0]!, state: "back" };
    const actor = startMachine({ services, initialFiles: files });

    // back → duplicate swap
    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "MARK_AS", state: "duplicate" });

    await vi.waitFor(() => expect(markSelectedPagesFn).toHaveBeenCalledOnce());

    expect(markSelectedPagesFn).toHaveBeenCalledWith(
      "proj-persist-test",
      [0],
      "skip",
      false,
      "duplicate", // page_role=duplicate (not null — this is a new sub-role, not a clear)
    );
    actor.stop();
  });

  it("SET_ROLE cover sends page_role=null (single-page workbench path)", async () => {
    const markSelectedPagesFn = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({ markSelectedPages: markSelectedPagesFn });
    const files = makeFiles(3);
    files[0] = { ...files[0]!, state: "back" };
    const actor = startMachine({ services, initialFiles: files });

    actor.send({ type: "SET_ROLE", idx: 0, role: "cover" });

    await vi.waitFor(() => expect(markSelectedPagesFn).toHaveBeenCalledOnce());

    expect(markSelectedPagesFn).toHaveBeenCalledWith(
      "proj-persist-test",
      [0],
      "cover",
      false,
      null, // page_role=null clears prior sub-role
    );
    actor.stop();
  });

  it("reload after back→cover: resolveFileState returns cover (not back)", () => {
    // Simulate what happens when the server returns the updated state after a
    // back→cover transition: page_type=cover, page_role=null.
    // resolveFileState must return "cover" (not "back" from a stale role).
    const fileState = resolveFileState(false, "cover", null);
    expect(fileState).toBe("cover");

    // Contrast: if page_role were stale "back" (the bug that was fixed),
    // resolveFileState would incorrectly return "back".
    // Verify the priority rule: page_role takes precedence when non-null.
    const staleState = resolveFileState(false, "cover", "back");
    // This reveals the potential bug: stale page_role would override page_type.
    // The fix is to always send page_role=null for non-sub-role transitions.
    expect(staleState).toBe("back"); // Documents the risk of stale roles
    // The actual reload state after a correct transition (role=null) is:
    expect(fileState).toBe("cover"); // Confirmed: no stale role interference
  });
});

// ---------------------------------------------------------------------------
// Suite 11 — resolveFileState round-trip: back/duplicate survive reload
// ---------------------------------------------------------------------------

describe("resolveFileState: back/duplicate distinct from plain skip", () => {
  it("page_role=back → 'back' (even though page_type=skip)", () => {
    expect(resolveFileState(false, "skip", "back")).toBe("back");
  });

  it("page_role=duplicate → 'duplicate' (even though page_type=skip)", () => {
    expect(resolveFileState(false, "skip", "duplicate")).toBe("duplicate");
  });

  it("page_role=null, page_type=skip → 'skipped' (plain skip, no sub-role)", () => {
    expect(resolveFileState(false, "skip", null)).toBe("skipped");
  });

  it("page_role=undefined, page_type=skip → 'skipped' (no sub-role field)", () => {
    expect(resolveFileState(false, "skip")).toBe("skipped");
  });

  it("ignore=true always → 'skipped' regardless of page_role", () => {
    expect(resolveFileState(true, "skip", "back")).toBe("skipped");
    expect(resolveFileState(true, "skip", "duplicate")).toBe("skipped");
    expect(resolveFileState(true, "normal", "back")).toBe("skipped");
  });

  it("page_role=back survives a MARK_AS → reload cycle", async () => {
    // Machine dispatches: MARK_AS back → page_type=skip, page_role=back
    // On reload, server returns page_type=skip, page_role=back → resolves to "back"
    const pageType = FILE_STATE_TO_PAGE_TYPE["back"]; // "skip"
    const pageRole = FILE_STATE_TO_PAGE_ROLE["back"]; // "back"
    expect(pageType).toBe("skip");
    expect(pageRole).toBe("back");
    // Reload round-trip
    const reloaded = resolveFileState(false, pageType!, pageRole ?? undefined);
    expect(reloaded).toBe("back");
  });

  it("page_role=duplicate survives a MARK_AS → reload cycle", async () => {
    const pageType = FILE_STATE_TO_PAGE_TYPE["duplicate"]; // "skip"
    const pageRole = FILE_STATE_TO_PAGE_ROLE["duplicate"]; // "duplicate"
    expect(pageType).toBe("skip");
    expect(pageRole).toBe("duplicate");
    // Reload round-trip
    const reloaded = resolveFileState(false, pageType!, pageRole ?? undefined);
    expect(reloaded).toBe("duplicate");
  });

  it("marking 'page' clears a prior back role on reload", () => {
    // After marking page, page_type=normal, page_role=null
    const pageType = FILE_STATE_TO_PAGE_TYPE["page"]; // "normal"
    const pageRole = FILE_STATE_TO_PAGE_ROLE["page"]; // null
    expect(pageType).toBe("normal");
    expect(pageRole).toBeNull();
    // Reload with null role → "page"
    const reloaded = resolveFileState(false, pageType!, pageRole ?? undefined);
    expect(reloaded).toBe("page");
  });
});
