/**
 * Hydrate loaders for OCR, wordcheck, and text review.
 * Demo and missing ids do not call the network. Empty results stay empty.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import {
  hydrateOcrProject,
  loadFinishedOcrRow,
  ocrRowFromSseId,
} from "./ocrTool";
import {
  EMPTY_SUSPECT_TOTALS,
  loadWordcheckScan,
  suspectTypeForWord,
} from "./wordcheckTool";
import { EMPTY_REVIEW_TOTALS, loadTextReviewQueue } from "./textReviewTool";

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("hydrateOcrProject", () => {
  it("does not fetch for a demo id", async () => {
    let hits = 0;
    server.use(
      http.get("/api/data/projects/:projectId/pages", () => {
        hits += 1;
        return HttpResponse.json({ pages: [], next_cursor: null });
      }),
    );
    await expect(hydrateOcrProject("demo", signal())).resolves.toEqual({
      kind: "empty",
    });
    await expect(hydrateOcrProject("", signal())).resolves.toEqual({
      kind: "empty",
    });
    expect(hits).toBe(0);
  });

  it("returns empty when the project has no pages", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({ pages: [], next_cursor: null, total: 0 }),
      ),
    );
    await expect(hydrateOcrProject("book", signal())).resolves.toEqual({
      kind: "empty",
    });
  });

  it("flags a clean page from words and skips deleted tokens", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 4, prefix: "img0004" }],
          next_cursor: null,
        }),
      ),
      http.get("/api/data/projects/book/pages/4/stages", () =>
        HttpResponse.json([{ stage_id: "ocr", status: "clean" }]),
      ),
      http.get("/api/data/projects/book/pages/4/text/_", () =>
        HttpResponse.json({
          words: [
            { text: "tbe", confidence: 0.2, deleted: false },
            { text: "cat", confidence: 0.9, deleted: false },
            { text: "gone", confidence: 0.1, deleted: true },
          ],
        }),
      ),
    );
    const result = await hydrateOcrProject("book", signal());
    expect(result.kind).toBe("rows");
    if (result.kind !== "rows") return;
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row).toMatchObject({
      idx: "0004",
      prefix: "img0004",
      state: "flagged",
      words: 2,
      lowConf: 1,
    });
    expect(row?.meanConf).toBeCloseTo(0.55);
  });

  it("falls back to the OCR artifact when page text has no words", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 0, prefix: "img0000" }],
          next_cursor: null,
        }),
      ),
      http.get("/api/data/projects/book/pages/0/stages", () =>
        HttpResponse.json([{ stage_id: "ocr", status: "clean" }]),
      ),
      http.get(
        "/api/data/projects/book/pages/0/text/_",
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get("/api/data/projects/book/pages/0/stages/ocr/artifact", () =>
        HttpResponse.json([{ confidence: 0.99, deleted: false }]),
      ),
    );
    const result = await hydrateOcrProject("book", signal());
    expect(result).toMatchObject({
      kind: "rows",
      rows: [
        {
          idx: "0000",
          prefix: "img0000",
          state: "clean",
          words: 1,
          lowConf: 0,
        },
      ],
    });
  });

  it("lists a running page before a clean page", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [
            { idx0: 0, prefix: "a" },
            { idx0: 1, prefix: "b" },
          ],
          next_cursor: null,
        }),
      ),
      http.get("/api/data/projects/book/pages/:idx0/stages", ({ params }) =>
        HttpResponse.json([
          {
            stage_id: "ocr",
            status: params["idx0"] === "1" ? "running" : "clean",
          },
        ]),
      ),
      http.get("/api/data/projects/book/pages/:idx0/text/_", () =>
        HttpResponse.json({
          words: [{ confidence: 0.95, deleted: false }],
        }),
      ),
    );
    const result = await hydrateOcrProject("book", signal());
    expect(result.kind).toBe("rows");
    if (result.kind !== "rows") return;
    expect(result.rows.map((row) => row.state)).toEqual(["running", "clean"]);
    expect(result.rows.map((row) => row.idx)).toEqual(["0001", "0000"]);
  });

  it("returns empty when no page is running or clean", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 0, prefix: "a" }],
          next_cursor: null,
        }),
      ),
      http.get("/api/data/projects/book/pages/0/stages", () =>
        HttpResponse.json([{ stage_id: "ocr", status: "not-run" }]),
      ),
    );
    await expect(hydrateOcrProject("book", signal())).resolves.toEqual({
      kind: "empty",
    });
  });
});

describe("loadFinishedOcrRow", () => {
  it("loads word stats before it marks a clean page done", async () => {
    server.use(
      http.get("/api/data/projects/book/pages/4/stages", () =>
        HttpResponse.json([{ stage_id: "ocr", status: "clean" }]),
      ),
      http.get("/api/data/projects/book/pages/4/text/_", () =>
        HttpResponse.json({
          words: [
            { text: "tbe", confidence: 0.2, deleted: false },
            { text: "cat", confidence: 0.9, deleted: false },
          ],
        }),
      ),
    );
    const row = await loadFinishedOcrRow("book", "0004", signal());
    expect(row).toMatchObject({
      idx: "0004",
      state: "flagged",
      words: 2,
      lowConf: 1,
    });
  });

  it("does not mark a page done while OCR is still running", async () => {
    server.use(
      http.get("/api/data/projects/book/pages/4/stages", () =>
        HttpResponse.json([{ stage_id: "ocr", status: "running" }]),
      ),
    );
    await expect(
      loadFinishedOcrRow("book", "0004", signal()),
    ).resolves.toBeNull();
  });
});

describe("ocrRowFromSseId", () => {
  it("maps the bridge id onto a clean row", () => {
    expect(ocrRowFromSseId("0003")).toEqual({
      idx: "0003",
      prefix: "0003",
      state: "clean",
    });
  });
});

describe("suspectTypeForWord", () => {
  it("treats a short alphabetic token as stealth", () => {
    expect(suspectTypeForWord("arid")).toBe("stealth");
    expect(suspectTypeForWord("scanner")).toBe("common");
    expect(suspectTypeForWord("a")).toBe("common");
  });
});

describe("loadWordcheckScan", () => {
  it("does not fetch for demo", async () => {
    let hits = 0;
    server.use(
      http.get("/api/data/projects/:projectId/pages", () => {
        hits += 1;
        return HttpResponse.json({ pages: [], next_cursor: null });
      }),
    );
    await expect(loadWordcheckScan("demo", signal())).resolves.toEqual({
      suspects: [],
      totals: EMPTY_SUSPECT_TOTALS,
    });
    expect(hits).toBe(0);
  });

  it("sends an empty scan when every flags route is 404", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 0, prefix: "a" }],
          next_cursor: null,
        }),
      ),
      http.get(
        "/api/data/projects/book/pages/0/stages/wordcheck/flags",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    await expect(loadWordcheckScan("book", signal())).resolves.toEqual({
      suspects: [],
      totals: EMPTY_SUSPECT_TOTALS,
    });
  });

  it("maps flags to suspects", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [
            { idx0: 0, prefix: "a" },
            { idx0: 1, prefix: "b" },
          ],
          next_cursor: null,
        }),
      ),
      http.get("/api/data/projects/book/pages/0/stages/wordcheck/flags", () =>
        HttpResponse.json({
          flags: [
            { word_id: "s1", word_text: "arid" },
            { word_id: "s2", word_text: "scanner" },
          ],
        }),
      ),
      http.get("/api/data/projects/book/pages/1/stages/wordcheck/flags", () =>
        HttpResponse.json({ flags: [] }),
      ),
    );
    const scan = await loadWordcheckScan("book", signal());
    expect(scan.suspects).toEqual([
      {
        id: "s1",
        word: "arid",
        fix: "",
        ctxL: "",
        ctxR: "",
        type: "stealth",
        page: "0000",
        line: 0,
        rule: "bad_word",
        score: 1,
      },
      {
        id: "s2",
        word: "scanner",
        fix: "",
        ctxL: "",
        ctxR: "",
        type: "common",
        page: "0000",
        line: 0,
        rule: "bad_word",
        score: 1,
      },
    ]);
    expect(scan.totals).toEqual({
      total: 2,
      done: 2,
      suspects: 2,
      stealth: 1,
      flagged: 2,
      reviewed: 0,
      clean: 1,
    });
  });
});

describe("loadTextReviewQueue", () => {
  it("skips an attested page and does not read its flags", async () => {
    let flagHits = 0;
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 0, prefix: "a" }],
          next_cursor: null,
        }),
      ),
      http.get("/api/data/projects/book/pages/0/stages", () =>
        HttpResponse.json([{ stage_id: "text_review", status: "clean" }]),
      ),
      http.get("/api/data/projects/book/pages/0/stages/wordcheck/flags", () => {
        flagHits += 1;
        return HttpResponse.json({
          flags: [{ word_id: "qi", word_text: "tbe" }],
        });
      }),
    );
    await expect(loadTextReviewQueue("book", signal())).resolves.toEqual({
      queue: [],
      threads: [],
      totals: EMPTY_REVIEW_TOTALS,
    });
    expect(flagHits).toBe(0);
  });

  it("queues flags on a page that is not attested", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 3, prefix: "c" }],
          next_cursor: null,
        }),
      ),
      http.get("/api/data/projects/book/pages/3/stages", () =>
        HttpResponse.json([{ stage_id: "text_review", status: "not-run" }]),
      ),
      http.get("/api/data/projects/book/pages/3/stages/wordcheck/flags", () =>
        HttpResponse.json({
          flags: [{ word_id: "w1", word_text: "arid" }],
        }),
      ),
    );
    const snapshot = await loadTextReviewQueue("book", signal());
    expect(snapshot.threads).toEqual([]);
    expect(snapshot.queue).toEqual([
      {
        id: "w1",
        word: "arid",
        ctxL: "",
        ctxR: "",
        reason: "bad_word",
        page: "0003",
        line: 0,
        reviewer: "auto",
        comments: 0,
        status: "pending",
      },
    ]);
    expect(snapshot.totals).toEqual({
      total: 1,
      queue: 1,
      pending: 1,
      discuss: 0,
      approved: 0,
      clean: 0,
      comments: 0,
    });
  });
});
