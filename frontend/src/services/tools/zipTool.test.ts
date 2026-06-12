/**
 * zipTool.test.ts — Service tests for zipTool (R2 stub resolved).
 *
 * Verifies that `fetchZipManifest`:
 * 1. Returns { archive, tree } from GET .../zip/manifest on 200.
 * 2. Returns null when the route returns a non-200 status (graceful).
 *
 * Also verifies that `requestRebuild` POSTs to the run route and is
 * fire-and-forget (swallows errors).
 */

import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { fetchZipManifest, buildRealZipToolServices } from "./zipTool";

const PROJECT_ID = "proj1";

const MANIFEST_RESPONSE = {
  archive: {
    name: "proj1.zip",
    entries: 3,
    bytes: 1234,
    ratio: 0.9,
    sha256: "b".repeat(64),
  },
  tree: [
    { name: "f001.png", dir: false },
    { name: "f001.txt", dir: false },
    { name: "pgdp.json", dir: false },
  ],
};

// ---------------------------------------------------------------------------
// fetchZipManifest
// ---------------------------------------------------------------------------

describe("fetchZipManifest — R2 manifest endpoint", () => {
  it("returns { archive, tree } when manifest route returns 200", async () => {
    server.use(
      http.get(
        `/api/data/projects/${PROJECT_ID}/project-stages/zip/manifest`,
        () => HttpResponse.json(MANIFEST_RESPONSE),
      ),
    );

    const result = await fetchZipManifest(PROJECT_ID);
    expect(result).not.toBeNull();
    expect(result!.archive.sha256).toHaveLength(64);
    expect(result!.archive.entries).toBe(3);
    expect(Array.isArray(result!.tree)).toBe(true);
    expect(result!.tree).toHaveLength(3);
  });

  it("returns null when manifest route returns 404 (stage not clean)", async () => {
    server.use(
      http.get(
        `/api/data/projects/${PROJECT_ID}/project-stages/zip/manifest`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const result = await fetchZipManifest(PROJECT_ID);
    expect(result).toBeNull();
  });

  it("returns null on network error (graceful)", async () => {
    server.use(
      http.get(
        `/api/data/projects/${PROJECT_ID}/project-stages/zip/manifest`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const result = await fetchZipManifest(PROJECT_ID);
    expect(result).toBeNull();
  });

  it("tree contains entries from the archive", async () => {
    server.use(
      http.get(
        `/api/data/projects/${PROJECT_ID}/project-stages/zip/manifest`,
        () => HttpResponse.json(MANIFEST_RESPONSE),
      ),
    );

    const result = await fetchZipManifest(PROJECT_ID);
    expect(result!.tree.map((r) => r.name)).toContain("f001.png");
    expect(result!.tree.map((r) => r.name)).toContain("f001.txt");
  });
});

// ---------------------------------------------------------------------------
// requestRebuild (fire-and-forget)
// ---------------------------------------------------------------------------

describe("requestRebuild — fire-and-forget POST to /zip/run", () => {
  it("resolves without throwing on 202", async () => {
    server.use(
      http.post(`/api/data/projects/${PROJECT_ID}/project-stages/zip/run`, () =>
        HttpResponse.json({ job_id: "j1" }, { status: 202 }),
      ),
    );

    const services = buildRealZipToolServices();
    const settings = {
      format: "zip" as const,
      deterministic: true,
      compression: "fast" as const,
      emitChecksumSidecar: true,
    };
    await expect(
      services.requestRebuild(PROJECT_ID, settings),
    ).resolves.toBeUndefined();
  });

  it("swallows errors (fire-and-forget)", async () => {
    server.use(
      http.post(
        `/api/data/projects/${PROJECT_ID}/project-stages/zip/run`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const services = buildRealZipToolServices();
    const settings = {
      format: "zip" as const,
      deterministic: true,
      compression: "fast" as const,
      emitChecksumSidecar: true,
    };
    await expect(
      services.requestRebuild(PROJECT_ID, settings),
    ).resolves.toBeUndefined();
  });
});
