/**
 * Smoke test for Phase 2.7a (ocr-container-meta #328).
 *
 * Acceptance criteria: pdomain-prep-for-pgdp uses pdomain-ui's `PageImageCanvas`
 * as its canvas host — no local copy of that component should exist, and
 * canvas consumers must import it from `@pdomain/pdomain-ui/canvas`.
 *
 * This test acts as a canary: if someone adds a local `PageImageCanvas.tsx`
 * or changes the import path, the assertion below fails before any runtime
 * regression can slip through.
 *
 * Implementation note: the migration was performed at commit d65db3a as part
 * of the Phase 2.5 / #266 work block. PageWorkbenchPage was deleted at I1
 * (statechart convergence). WordBboxOverlay remains as the remaining consumer.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");

function srcText(relPath: string): string {
  return readFileSync(resolve(SRC_ROOT, relPath), "utf8");
}

describe("Phase 2.7a — pdomain-ui PageImageCanvas adoption (meta #328)", () => {
  it("WordBboxOverlay imports PageImageCanvas from @pdomain/pdomain-ui/canvas", () => {
    const src = srcText("components/WordBboxOverlay.tsx");
    expect(src).toMatch(
      /import\s+\{[^}]*PageImageCanvas[^}]*\}\s+from\s+["']@pdomain\/pdomain-ui\/canvas["']/,
    );
  });

  it("no local PageImageCanvas.tsx exists in the repo", () => {
    const localCandidates = [
      "components/PageImageCanvas.tsx",
      "components/canvas/PageImageCanvas.tsx",
      "pages/PageImageCanvas.tsx",
    ];
    for (const candidate of localCandidates) {
      expect(
        () => srcText(candidate),
        `${candidate} should not exist`,
      ).toThrow();
    }
  });
});
