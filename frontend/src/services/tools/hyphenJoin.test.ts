/**
 * The project hyphen scan uses id, prefix, suffix, and idx0.
 * The tool stores caseId and posts the numeric page index.
 */
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { buildRealHyphenJoinServices } from "./hyphenJoin";

describe("buildRealHyphenJoinServices scan mapping", () => {
  it("maps id and idx0 so a decision posts to that page", async () => {
    let posted = "";
    server.use(
      http.post("/api/data/projects/book/project-stages/hyphen_join/scan", () =>
        HttpResponse.json({
          cases: [
            {
              id: "abc",
              prefix: "ex",
              suffix: "ample",
              pageId: "p045",
              idx0: 12,
              offset: 4,
              matchText: "ex-\nample",
              status: "undecided",
              kind: "auto",
            },
          ],
          totals: {
            total: 1,
            joined: 0,
            validated: 0,
            undecided: 1,
            flagged: 0,
            crosspage: 0,
            mismatch: 0,
            unvalidated: 0,
          },
        }),
      ),
      http.post(
        "/api/data/projects/book/pages/:idx/stages/hyphen-join/decisions",
        ({ params }) => {
          posted = String(params["idx"]);
          return HttpResponse.json({ ok: true });
        },
      ),
    );

    const services = buildRealHyphenJoinServices();
    const scanned = await services.scanHyphenation("book");
    const hyphenCase = scanned.cases[0];
    expect(hyphenCase).toMatchObject({
      caseId: "abc",
      head: "ex",
      tail: "ample",
      page: "0012",
      status: "undecided",
      kind: "auto",
    });
    const persist = services.persistDecision;
    expect(persist).toBeTypeOf("function");
    if (persist === undefined || hyphenCase === undefined) return;
    await persist("book", hyphenCase.page, hyphenCase.caseId, "join");
    expect(posted).toBe("12");
  });
});
