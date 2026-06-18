/**
 * Unit tests for persistRuns — asserts that the service maps the machine Run
 * type to the NumberingRunsArtifact wire shape the backend expects.
 *
 * Machine RunStyle: "roman" | "arabic" | "none"
 * Wire RunStyle:    "roman-lower" | "roman-upper" | "arabic" | "alpha" | "none"
 *
 * Mapping applied here:
 *   "roman"   → "roman-lower"  (conservative default; no upper/alpha in machine)
 *   "arabic"  → "arabic"
 *   "none"    → "none"
 *
 * Wire NumberingRun fields not in machine Run:
 *   role  → defaulted to "text"
 *   note  → defaulted to ""
 *
 * Wire NumberingRun fields derived from machine Run:
 *   id         ← run.id
 *   label      ← run.label
 *   start_mode ← run.start.mode   ("set" | "continue")
 *   start      ← run.start.value
 *   step       ← run.step
 *   span       ← run.span         ([number, number] | null)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "@/api/client";
import { buildRealPageOrderToolServices } from "./pageOrderTool";
import type { Run, Leaf } from "@/machines/tools/pageOrderTool";
import type { components } from "@/api/types.gen";

type NumberingRunsArtifact = components["schemas"]["NumberingRunsArtifact"];
type NumberingRun = components["schemas"]["NumberingRun"];

vi.mock("@/api/client", () => ({
  api: {
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ pages: [], total: 0, next_cursor: null }),
    post: vi.fn().mockResolvedValue({}),
  },
}));

const mockApiPut = vi.mocked(api.put);
const mockApiPatch = vi.mocked(api.patch);
const mockApiGet = vi.mocked(api.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistRuns", () => {
  it("PUTs the NumberingRunsArtifact shape for an arabic body run", async () => {
    const svc = buildRealPageOrderToolServices();
    const runs: Run[] = [
      {
        id: "body",
        label: "Body",
        style: "arabic",
        start: { mode: "set", value: 1 },
        step: 1,
        span: [0, 49],
      },
    ];

    await svc.persistRuns("proj-1", runs);

    expect(mockApiPut).toHaveBeenCalledOnce();
    const [url, body] = mockApiPut.mock.calls[0] as [
      string,
      NumberingRunsArtifact,
    ];
    expect(url).toBe(
      "/api/data/projects/proj-1/project-stages/page_order/runs",
    );
    expect(body.version).toBe(1);
    expect(body.runs).toHaveLength(1);
    const run = body.runs![0] as NumberingRun;
    expect(run.id).toBe("body");
    expect(run.label).toBe("Body");
    expect(run.style).toBe("arabic");
    expect(run.start_mode).toBe("set");
    expect(run.start).toBe(1);
    expect(run.step).toBe(1);
    expect(run.span).toEqual([0, 49]);
    expect(run.role).toBe("text");
    expect(run.note).toBe("");
  });

  it("maps machine 'roman' style to wire 'roman-lower'", async () => {
    const svc = buildRealPageOrderToolServices();
    const runs: Run[] = [
      {
        id: "front",
        label: "Front matter",
        style: "roman",
        start: { mode: "set", value: 1 },
        step: 1,
        span: [0, 9],
      },
    ];

    await svc.persistRuns("proj-2", runs);

    const [, body] = mockApiPut.mock.calls[0] as [
      string,
      NumberingRunsArtifact,
    ];
    const run0 = (body.runs as NumberingRun[])[0] as NumberingRun;
    expect(run0.style).toBe("roman-lower");
  });

  it("maps machine 'none' style to wire 'none'", async () => {
    const svc = buildRealPageOrderToolServices();
    const runs: Run[] = [
      {
        id: "skip",
        label: "Unnumbered",
        style: "none",
        start: { mode: "continue", value: 0 },
        step: 1,
        span: [0, 4],
      },
    ];

    await svc.persistRuns("proj-3", runs);

    const [, body] = mockApiPut.mock.calls[0] as [
      string,
      NumberingRunsArtifact,
    ];
    const run0 = (body.runs as NumberingRun[])[0] as NumberingRun;
    expect(run0.style).toBe("none");
    expect(run0.start_mode).toBe("continue");
  });

  it("sends multiple runs preserving order and identity", async () => {
    const svc = buildRealPageOrderToolServices();
    const runs: Run[] = [
      {
        id: "r1",
        label: "Front",
        style: "roman",
        start: { mode: "set", value: 1 },
        step: 1,
        span: [0, 9],
      },
      {
        id: "r2",
        label: "Body",
        style: "arabic",
        start: { mode: "set", value: 1 },
        step: 1,
        span: [10, 99],
      },
    ];

    await svc.persistRuns("proj-4", runs);

    const [url, body] = mockApiPut.mock.calls[0] as [
      string,
      NumberingRunsArtifact,
    ];
    expect(url).toBe(
      "/api/data/projects/proj-4/project-stages/page_order/runs",
    );
    expect(body.version).toBe(1);
    expect(body.runs).toHaveLength(2);
    const [run0, run1] = body.runs as [NumberingRun, NumberingRun];
    expect(run0.id).toBe("r1");
    expect(run0.style).toBe("roman-lower");
    expect(run0.span).toEqual([0, 9]);
    expect(run1.id).toBe("r2");
    expect(run1.style).toBe("arabic");
    expect(run1.span).toEqual([10, 99]);
  });

  it("sends empty runs array when runs is empty", async () => {
    const svc = buildRealPageOrderToolServices();

    await svc.persistRuns("proj-5", []);

    const [, body] = mockApiPut.mock.calls[0] as [
      string,
      NumberingRunsArtifact,
    ];
    expect(body.version).toBe(1);
    expect(body.runs).toEqual([]);
  });

  it("encodes the project id in the URL", async () => {
    const svc = buildRealPageOrderToolServices();
    await svc.persistRuns("abc/def", []);

    const [url] = mockApiPut.mock.calls[0] as [string, NumberingRunsArtifact];
    expect(url).toBe(
      "/api/data/projects/abc%2Fdef/project-stages/page_order/runs",
    );
  });
});

// ---------------------------------------------------------------------------
// persistLeaf — sends leaf_role + run_id
// ---------------------------------------------------------------------------

describe("persistLeaf", () => {
  it("PATCHes leaf_role and run_id for a blank leaf with no run", async () => {
    const svc = buildRealPageOrderToolServices();
    // Do not include plateTag at all — exactOptionalPropertyTypes forbids
    // assigning explicit `undefined` to an optional property typed as `string`.
    const leaf: Leaf = { scan: 3, role: "blank", runId: null, flags: [] };

    await svc.persistLeaf("proj-1", leaf);

    expect(mockApiPatch).toHaveBeenCalledOnce();
    const [url, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe("/api/data/projects/proj-1/pages/3");
    // leaf_role must be sent as the wire enum value matching machine role
    expect(body).toMatchObject({ leaf_role: "blank", run_id: null });
  });

  it("sends explicit run_id: null for a marker leaf (runId === null)", async () => {
    // CRITICAL: explicit null clears the run assignment; omitting it preserves
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = { scan: 0, role: "text", runId: null, flags: [] };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // run_id must be present as explicit null, not missing/undefined
    expect(Object.keys(body)).toContain("run_id");
    expect(body["run_id"]).toBeNull();
  });

  it("sends run_id as the string value when leaf has a run assigned", async () => {
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = { scan: 5, role: "text", runId: "body", flags: [] };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body["run_id"]).toBe("body");
    expect(body["leaf_role"]).toBe("text");
  });

  it("sends plate_tag when leaf has a plateTag", async () => {
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = {
      scan: 10,
      role: "plate",
      runId: null,
      flags: [],
      plateTag: "Plate VIII",
    };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body["plate_tag"]).toBe("Plate VIII");
    expect(body["leaf_role"]).toBe("plate");
  });

  it("sends plate_tag: null when leaf has no plateTag", async () => {
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = { scan: 7, role: "text", runId: "body", flags: [] };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body["plate_tag"]).toBeNull();
  });

  it("still sends page_type for backward compatibility", async () => {
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = { scan: 2, role: "skip", runId: null, flags: [] };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body["page_type"]).toBe("skip");
  });

  it("PATCHes label_override when leaf carries a labelOverride", async () => {
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = {
      scan: 4,
      role: "text",
      runId: "body",
      flags: [],
      labelOverride: "7",
    };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body["label_override"]).toBe("7");
  });

  it("sends label_override: null for an explicit clear (labelOverride null)", async () => {
    // Same model_fields_set contract as run_id: explicit null clears the
    // override; the field must be present, not omitted.
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = {
      scan: 4,
      role: "text",
      runId: "body",
      flags: [],
      labelOverride: null,
    };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(body)).toContain("label_override");
    expect(body["label_override"]).toBeNull();
  });

  it("sends label_override: null when labelOverride is absent (omitted field)", async () => {
    const svc = buildRealPageOrderToolServices();
    const leaf: Leaf = { scan: 4, role: "text", runId: "body", flags: [] };

    await svc.persistLeaf("proj-1", leaf);

    const [, body] = mockApiPatch.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body["label_override"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchFolios — reads ocr_folio not prefix
// ---------------------------------------------------------------------------

describe("fetchFolios", () => {
  it("builds leaves reading ocr_folio from the page record, not prefix", async () => {
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "003p002",
          source_stem: "scan_003",
          leaf_role: null,
          run_id: null,
          ocr_folio: "7",
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    expect(result.leaves).toHaveLength(1);
    const leaf = result.leaves[0]!;
    // ocrFolio must come from ocr_folio field, NOT prefix
    expect(leaf.ocrFolio).toBe("7");
    // must NOT be the prefix value
    expect(leaf.ocrFolio).not.toBe("003p002");
  });

  it("sets ocrFolio to null when ocr_folio is null (not the prefix)", async () => {
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "f001",
          source_stem: "scan_001",
          leaf_role: null,
          run_id: null,
          ocr_folio: null,
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    const leaf = result.leaves[0]!;
    // stopgap was: ocrFolio: p.prefix || null — would have given "f001" here
    // correct: ocrFolio is null because ocr_folio is null
    expect(leaf.ocrFolio).toBeNull();
  });

  it("reads leaf_role and run_id from the page record", async () => {
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "blank",
          prefix: "",
          source_stem: "scan_000",
          leaf_role: "blank",
          run_id: "body",
          ocr_folio: null,
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    const leaf = result.leaves[0]!;
    expect(leaf.role).toBe("blank");
    expect(leaf.runId).toBe("body");
  });

  it("loads an existing label_override into leaf.labelOverride on mount", async () => {
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "p007",
          source_stem: "scan_007",
          leaf_role: null,
          run_id: null,
          ocr_folio: "6",
          label_override: "7",
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    const leaf = result.leaves[0]!;
    // The persisted override must survive reload (severed-chain regression).
    expect(leaf.labelOverride).toBe("7");
    // ocrFolio stays the OCR-read value, distinct from the override.
    expect(leaf.ocrFolio).toBe("6");
  });

  it("sets labelOverride null when label_override is absent from the record", async () => {
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "p001",
          source_stem: "scan_001",
          leaf_role: null,
          run_id: null,
          ocr_folio: null,
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    expect(result.leaves[0]!.labelOverride).toBeNull();
  });

  it("loads an existing plate_tag into leaf.plateTag on mount (M1)", async () => {
    // M1 regression: persistLeaf SENDS plate_tag but fetchFolios never read it
    // back, so a plate caption was lost on reload.
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "plate_p",
          prefix: "",
          source_stem: "scan_000",
          leaf_role: "plate",
          run_id: null,
          ocr_folio: null,
          plate_tag: "Plate VIII",
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    expect(result.leaves[0]!.plateTag).toBe("Plate VIII");
  });

  it("sets plateTag undefined when plate_tag is absent from the record (M1)", async () => {
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "p001",
          source_stem: "scan_001",
          leaf_role: null,
          run_id: null,
          ocr_folio: null,
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    expect(result.leaves[0]!.plateTag).toBeUndefined();
  });

  it("falls back to page_type-derived role when leaf_role is null", async () => {
    mockApiGet.mockResolvedValueOnce({
      pages: [
        {
          idx0: 0,
          page_type: "plate_p",
          prefix: "",
          source_stem: "scan_000",
          leaf_role: null,
          run_id: null,
          ocr_folio: null,
        },
      ],
      total: 1,
      next_cursor: null,
    });

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    const leaf = result.leaves[0]!;
    // leaf_role is null → fall back to page_type "plate_p" → role "plate"
    expect(leaf.role).toBe("plate");
  });
});

// ---------------------------------------------------------------------------
// fetchFolios — reads PERSISTED runs (the severed-chain fix)
// ---------------------------------------------------------------------------

/**
 * Mock both GETs fetchFolios performs, in call order:
 *   1. GET .../pages   → the page list
 *   2. GET .../runs    → the NumberingRunsArtifact
 *
 * The default vi.mock returns the EMPTY-pages shape for any un-`Once`'d call,
 * so the runs GET must be mocked explicitly here or it would resolve to a
 * pages-shaped object (runs === undefined → default body run fallback).
 */
function mockPagesThenRuns(pages: unknown[], runsArtifact: unknown): void {
  mockApiGet
    .mockResolvedValueOnce({ pages, total: pages.length, next_cursor: null })
    .mockResolvedValueOnce(runsArtifact);
}

describe("fetchFolios — persisted runs", () => {
  it("maps a front(roman)+body(arabic) runs artifact to two machine runs", async () => {
    mockPagesThenRuns(
      [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "",
          source_stem: "s0",
          leaf_role: "text",
          run_id: "front",
          ocr_folio: null,
        },
        {
          idx0: 1,
          page_type: "normal",
          prefix: "",
          source_stem: "s1",
          leaf_role: "text",
          run_id: "body",
          ocr_folio: null,
        },
      ],
      {
        version: 1,
        runs: [
          {
            id: "front",
            label: "Front matter",
            style: "roman-lower",
            start_mode: "set",
            start: 1,
            step: 1,
            role: "text",
            span: [0, 0],
            note: "",
          },
          {
            id: "body",
            label: "Body",
            style: "arabic",
            start_mode: "set",
            start: 1,
            step: 1,
            role: "text",
            span: [1, 1],
            note: "",
          },
        ],
      },
    );

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    expect(result.runs).toHaveLength(2);
    const [front, body] = result.runs;
    expect(front!.id).toBe("front");
    expect(front!.style).toBe("roman"); // roman-lower → roman
    expect(front!.label).toBe("Front matter");
    expect(front!.start).toEqual({ mode: "set", value: 1 });
    expect(front!.step).toBe(1);
    expect(front!.span).toEqual([0, 0]);

    expect(body!.id).toBe("body");
    expect(body!.style).toBe("arabic");
    expect(body!.span).toEqual([1, 1]);
  });

  it("collapses wire roman-upper and alpha to machine roman / none (lossy)", async () => {
    mockPagesThenRuns(
      [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "",
          source_stem: "s0",
          leaf_role: "text",
          run_id: "r1",
          ocr_folio: null,
        },
      ],
      {
        version: 1,
        runs: [
          {
            id: "r1",
            label: "Upper",
            style: "roman-upper",
            start_mode: "set",
            start: 1,
            step: 1,
            role: "text",
            span: [0, 0],
            note: "",
          },
          {
            id: "r2",
            label: "Alpha",
            style: "alpha",
            start_mode: "set",
            start: 1,
            step: 1,
            role: "text",
            span: [0, 0],
            note: "",
          },
        ],
      },
    );

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    expect(result.runs[0]!.style).toBe("roman"); // roman-upper → roman
    expect(result.runs[1]!.style).toBe("none"); // alpha → none (lossy fallback)
  });

  it("maps continue start_mode and a null span to the full leaf range", async () => {
    mockPagesThenRuns(
      [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "",
          source_stem: "s0",
          leaf_role: "text",
          run_id: "r1",
          ocr_folio: null,
        },
        {
          idx0: 1,
          page_type: "normal",
          prefix: "",
          source_stem: "s1",
          leaf_role: "text",
          run_id: "r1",
          ocr_folio: null,
        },
        {
          idx0: 2,
          page_type: "normal",
          prefix: "",
          source_stem: "s2",
          leaf_role: "text",
          run_id: "r1",
          ocr_folio: null,
        },
      ],
      {
        version: 1,
        runs: [
          {
            id: "r1",
            label: "All",
            style: "arabic",
            start_mode: "continue",
            start: 5,
            step: 2,
            role: "text",
            span: null,
            note: "",
          },
        ],
      },
    );

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    const run = result.runs[0]!;
    expect(run.start).toEqual({ mode: "continue", value: 5 });
    expect(run.step).toBe(2);
    // null wire span → full [0, leafCount-1]
    expect(run.span).toEqual([0, 2]);
  });

  it("falls back to a single default body run when the artifact has no runs", async () => {
    mockPagesThenRuns(
      [
        {
          idx0: 0,
          page_type: "normal",
          prefix: "",
          source_stem: "s0",
          leaf_role: "text",
          run_id: null,
          ocr_folio: null,
        },
        {
          idx0: 1,
          page_type: "normal",
          prefix: "",
          source_stem: "s1",
          leaf_role: "text",
          run_id: null,
          ocr_folio: null,
        },
      ],
      { version: 1, runs: [] },
    );

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    // Empty persisted runs → default body run covering all leaves.
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]!.id).toBe("body");
    expect(result.runs[0]!.style).toBe("arabic");
    expect(result.runs[0]!.span).toEqual([0, 1]);
  });

  it("falls back to the default body run when the runs GET fails", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        pages: [
          {
            idx0: 0,
            page_type: "normal",
            prefix: "",
            source_stem: "s0",
            leaf_role: "text",
            run_id: null,
            ocr_folio: null,
          },
        ],
        total: 1,
        next_cursor: null,
      })
      .mockRejectedValueOnce(new Error("runs endpoint 500"));

    const svc = buildRealPageOrderToolServices();
    const result = await svc.fetchFolios("proj-1");

    // A failing runs GET degrades to the default run, not a thrown error.
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]!.id).toBe("body");
  });

  it("GETs the runs endpoint with the encoded project id", async () => {
    mockPagesThenRuns([], { version: 1, runs: [] });

    const svc = buildRealPageOrderToolServices();
    await svc.fetchFolios("abc/def");

    // Second GET call is the runs endpoint.
    const runsCall = mockApiGet.mock.calls[1]!;
    expect(runsCall[0]).toBe(
      "/api/data/projects/abc%2Fdef/project-stages/page_order/runs",
    );
  });
});
