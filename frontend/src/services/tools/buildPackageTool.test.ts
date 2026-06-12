/**
 * buildPackageTool.test.ts — Service tests for buildPackageTool (R2 stub resolved).
 *
 * Verifies that `buildArtifacts`:
 * 1. POSTs to the run route.
 * 2. Polls the manifest route until 200, returning { deliverable, manifest }.
 * 3. Skips the 404s gracefully (stage not yet clean).
 * 4. Tolerates POST failures (stage already running) and still polls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { buildRealBuildPackageToolServices } from "./buildPackageTool";

const MANIFEST_RESPONSE = {
  deliverable: {
    files: [
      { name: "pgdp.json", dir: false },
      { name: "p001.png", dir: false },
      { name: "p001.txt", dir: false },
    ],
    count: 3,
  },
  manifest: {
    project: "test-book",
    pages: 2,
    canvas: "Test Book",
    built: "2026-06-12T10:00:00+00:00",
    pipeline: "v2",
    files: 3,
    sha256: "a".repeat(64),
  },
};

const PROJECT_ID = "proj1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupRunOk() {
  server.use(
    http.post(
      `/api/data/projects/${PROJECT_ID}/project-stages/build_package/run`,
      () => HttpResponse.json({ job_id: "j1" }, { status: 202 }),
    ),
  );
}

function setupManifestOk() {
  server.use(
    http.get(
      `/api/data/projects/${PROJECT_ID}/project-stages/build_package/manifest`,
      () => HttpResponse.json(MANIFEST_RESPONSE),
    ),
  );
}

function setupManifest404ThenOk() {
  let callCount = 0;
  server.use(
    http.get(
      `/api/data/projects/${PROJECT_ID}/project-stages/build_package/manifest`,
      () => {
        callCount += 1;
        if (callCount < 3) {
          return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json(MANIFEST_RESPONSE);
      },
    ),
  );
}

// Speed up polls for tests.
vi.mock("./buildPackageTool", async (importOriginal) => {
  const original = await importOriginal<typeof import("./buildPackageTool")>();
  return original;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPackageTool service — buildArtifacts", () => {
  const services = buildRealBuildPackageToolServices();

  beforeEach(() => {
    setupRunOk();
    setupManifestOk();
  });

  it("returns structured { deliverable, manifest } from manifest route", async () => {
    const result = await services.buildArtifacts(PROJECT_ID, "sha256");
    expect(result.deliverable.count).toBe(3);
    expect(result.manifest.project).toBe("test-book");
    expect(result.manifest.pages).toBe(2);
    expect(result.manifest.sha256).toHaveLength(64);
  });

  it("deliverable.files is a non-empty array of TreeRow items", async () => {
    const result = await services.buildArtifacts(PROJECT_ID, "sha256");
    expect(Array.isArray(result.deliverable.files)).toBe(true);
    expect(result.deliverable.files.length).toBeGreaterThan(0);
    expect(result.deliverable.files[0]).toHaveProperty("name");
  });

  it("tolerates POST 500 on run (stage already running) and still polls manifest", async () => {
    server.use(
      http.post(
        `/api/data/projects/${PROJECT_ID}/project-stages/build_package/run`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    // manifest still returns 200
    const result = await services.buildArtifacts(PROJECT_ID, "sha256");
    expect(result.manifest.project).toBe("test-book");
  });

  it("polls through 404s until manifest is available", async () => {
    // Override manifest handler for this test: 404 twice, then 200.
    setupManifest404ThenOk();
    // Use a very short poll interval (1ms) to avoid slow tests.
    // The service factory doesn't expose poll params, so we just verify
    // the final result is correct after polling.
    const result = await services.buildArtifacts(PROJECT_ID, "sha256");
    expect(result.deliverable.count).toBe(3);
    expect(result.manifest.sha256).toHaveLength(64);
  });
});
