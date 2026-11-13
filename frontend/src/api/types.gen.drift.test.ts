// P4 #20 (drift guard): asserts the committed `types.gen.ts` byte-matches
// what `openapi-typescript` would emit fresh against the committed
// `openapi.json`. Mirrors `tests/test_openapi_spec_committed.py` which
// guards `openapi.json` against `build_app()`. Together they form a
// two-link chain: app → openapi.json → types.gen.ts.
//
// Skip-condition: if `openapi-typescript` isn't reachable (e.g. CI
// without `node_modules` installed), we skip rather than fail-loud, so
// running `vitest` from a fresh checkout doesn't trip on tooling absence.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(FRONTEND_ROOT, "..");
const OPENAPI_JSON = resolve(REPO_ROOT, "openapi.json");
const COMMITTED_GEN = resolve(FRONTEND_ROOT, "src/api/types.gen.ts");
const CODEGEN_BIN = resolve(
  FRONTEND_ROOT,
  "node_modules/.bin/openapi-typescript",
);

describe("types.gen.ts drift guard", () => {
  const codegenAvailable = existsSync(CODEGEN_BIN);
  const it_or_skip = codegenAvailable ? it : it.skip;

  it_or_skip(
    "committed types.gen.ts matches fresh openapi-typescript output",
    () => {
      const fresh = execFileSync(CODEGEN_BIN, [OPENAPI_JSON], {
        encoding: "utf8",
        cwd: FRONTEND_ROOT,
      });
      const committed = readFileSync(COMMITTED_GEN, "utf8");
      // Helpful failure: tell the developer how to fix it.
      if (fresh !== committed) {
        throw new Error(
          "types.gen.ts is out of sync with openapi.json.\n" +
            "Run `just openapi-export` (or `cd frontend && npm run openapi:gen`) " +
            "and commit the result.",
        );
      }
      expect(fresh).toBe(committed);
    },
  );
});
