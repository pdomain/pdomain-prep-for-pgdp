// P4 #20 (codegen scaffold): exists to lock in the *generated* TS shape
// produced by `openapi-typescript` against `openapi.json`. The hand-written
// `types.ts` is still the canonical type source for SPA consumers; this
// scaffold lets future iterations diff the generated output and migrate
// surfaces over deliberately.
//
// To regenerate: `just openapi-export` (writes both types.ts and types.gen.ts)
// or `cd frontend && npm run openapi:gen`.
import { describe, expect, it } from "vitest";
import type { components } from "./types.gen";

describe("types.gen.ts (openapi-typescript codegen)", () => {
  it("round-trips the SourcePreviewResponse shape", () => {
    // openapi-typescript emits components["schemas"]["X"] indexed types.
    // A value of the exact shape must satisfy the type — both fields
    // present, correctly typed, no extras required.
    const sample: components["schemas"]["SourcePreviewResponse"] = {
      filenames: ["0001.jpg", "0002.jpg"],
      total_image_count: 12,
    };
    expect(sample.filenames).toHaveLength(2);
    expect(sample.total_image_count).toBe(12);
  });

  it("exposes Project with the fields the SPA already relies on", () => {
    // Smoke-check: a small subset of Project fields type-check via the
    // generated shape. We don't enumerate every field — we just want
    // confidence that future codegen runs don't silently drop these.
    const partial: Pick<
      components["schemas"]["Project"],
      "id" | "name" | "status" | "page_count" | "archived"
    > = {
      id: "p1",
      name: "Test Book",
      status: "configuring",
      page_count: 100,
      archived: false,
    };
    expect(partial.status).toBe("configuring");
  });
});
