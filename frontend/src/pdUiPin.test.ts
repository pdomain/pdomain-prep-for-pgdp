import { describe, expect, it } from "vitest";

import pkg from "../package.json";

/**
 * Regression guard for ocr-container-meta #293.
 *
 * `@pdomain/pdomain-ui@0.1.0-alpha` shipped broken metadata: no
 * transitive deps (konva, react-konva, @radix-ui/*, clsx, react-virtuoso)
 * resolved on install. `0.1.0-alpha.1` re-published with valid metadata.
 *
 * `@pdomain/pdomain-ui@0.2.0` shipped with react/jsx-dev-runtime bundled
 * in dist (React 18 internals), which crashes React 19 vitest consumers.
 * Fixed in 0.2.1 (externalized react/jsx-dev-runtime in rollupOptions).
 *
 * The pin must stay at ^0.2.1 so a fresh `pnpm install` pulls a version
 * whose dist does not bundle React internals. This is the floor for the
 * Phase 2.7 migration (meta #266).
 */
describe("@pdomain/pdomain-ui pin (meta #293)", () => {
  const pin = (pkg.dependencies as Record<string, string>)[
    "@pdomain/pdomain-ui"
  ];

  it("is declared as a dependency", () => {
    expect(pin).toBeDefined();
  });

  it("is not pinned to the broken 0.1.0-alpha metadata", () => {
    expect(pin).not.toBe("^0.1.0-alpha");
    expect(pin).not.toBe("0.1.0-alpha");
  });

  it("is not pinned to the broken 0.2.0 jsx-dev-runtime bundle", () => {
    expect(pin).not.toBe("^0.2.0");
    expect(pin).not.toBe("0.2.0");
  });

  it("pins at least 0.2.1 (or uses a local path dep for rename worktree)", () => {
    // Accept either a semver range >= 0.2.1 (registry install) or a file:
    // path pointing at the rename worktree (Phase 2 local-dev only).
    expect(pin).toBeDefined();
    const isSemver = /\^0\.2\.[1-9]\d*/.test(pin ?? "");
    const isLocalPath = (pin ?? "").startsWith("file:");
    expect(isSemver || isLocalPath).toBe(true);
  });
});
