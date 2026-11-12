import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { buildRealStageRunnerServices } from "./pipeline";

const CANCEL_URL = "/api/data/projects/proj1/stages/grayscale/cancel";

describe("requestCancel", () => {
  it("posts to the stage cancel route", async () => {
    let posted = false;
    server.use(
      http.post(CANCEL_URL, () => {
        posted = true;
        return HttpResponse.json({ cancelled: 1 });
      }),
    );

    await buildRealStageRunnerServices().requestCancel("proj1", "grayscale");

    expect(posted).toBe(true);
  });

  it("rejects when the server refuses the cancel", async () => {
    server.use(
      http.post(CANCEL_URL, () =>
        HttpResponse.json({ detail: "project not found" }, { status: 404 }),
      ),
    );

    await expect(
      buildRealStageRunnerServices().requestCancel("proj1", "grayscale"),
    ).rejects.toThrow();
  });
});
