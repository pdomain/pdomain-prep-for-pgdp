/**
 * The archive service reads the project's stage files from the items route.
 */

import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { buildRealArchiveToolServices } from "./archiveTool";

const PROJECT_ID = "proj1";
const STAGE_FILE = "pages/0001/stages/threshold/output.png";

describe("listItems", () => {
  it("returns the stage files from the archive items route", async () => {
    server.use(
      http.get(
        `/api/data/projects/${PROJECT_ID}/project-stages/archive/items`,
        () =>
          HttpResponse.json({
            items: [{ name: STAGE_FILE, meta: "9 B", keep: true }],
          }),
      ),
    );

    const services = buildRealArchiveToolServices();
    await expect(services.listItems(PROJECT_ID)).resolves.toEqual([
      { name: STAGE_FILE, meta: "9 B", keep: true },
    ]);
  });

  it("rejects a body that is not a list", async () => {
    server.use(
      http.get(
        `/api/data/projects/${PROJECT_ID}/project-stages/archive/items`,
        () => HttpResponse.json({ kept: "Original scans" }),
      ),
    );

    const services = buildRealArchiveToolServices();
    await expect(services.listItems(PROJECT_ID)).rejects.toThrow(
      "Archive list response is not a list.",
    );
  });

  it("returns no rows when the project has no stage files", async () => {
    server.use(
      http.get(
        `/api/data/projects/${PROJECT_ID}/project-stages/archive/items`,
        () => HttpResponse.json({ items: [] }),
      ),
    );

    const services = buildRealArchiveToolServices();
    await expect(services.listItems(PROJECT_ID)).resolves.toEqual([]);
  });
});

describe("persistItem", () => {
  it("patches a stage path without encoding its slashes as one segment", async () => {
    let pathname = "";
    server.use(
      http.patch("*/project-stages/archive/items/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ ok: true, name: STAGE_FILE, keep: false });
      }),
    );

    const services = buildRealArchiveToolServices();
    await expect(
      services.persistItem(PROJECT_ID, STAGE_FILE, false),
    ).resolves.toEqual({ ok: true });
    expect(pathname).toBe(
      `/api/data/projects/${PROJECT_ID}/project-stages/archive/items/${STAGE_FILE}`,
    );
  });
});
