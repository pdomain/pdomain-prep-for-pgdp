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
import type { Run } from "@/machines/tools/pageOrderTool";
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
