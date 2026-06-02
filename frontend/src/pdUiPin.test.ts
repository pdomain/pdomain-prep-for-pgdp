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
 * `@pdomain/pdomain-ui@0.4.0` adopts the right-side utility dock (M8
 * consumer migration). JobsPill hover popover removed; Settings + Keybinds
 * render in the dock. The floor is now ^0.4.0.
 *
 * The pin must stay at ^0.4.0 or higher so a fresh `pnpm install` pulls a
 * version with the utility dock API. This is the floor for the M8 migration.
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

  it("pins at least 0.4.0 as a semver range (no file: path deps — registry is live)", () => {
    // M8 migration: @pdomain/pdomain-ui@0.4.0 adds the utility dock API.
    // file: path deps are not acceptable. Only semver ranges are valid.
    expect(pin).toBeDefined();
    expect((pin ?? "").startsWith("file:")).toBe(false);
    const isSemver = /^\^?\d+\.\d+\.\d+/.test(pin ?? "");
    expect(isSemver).toBe(true);
    // Floor: must be at least 0.4.0 (utility dock API).
    const isSufficientVersion = /\^0\.[4-9]\.\d+|\^[1-9]/.test(pin ?? "");
    expect(isSufficientVersion).toBe(true);
  });
});
