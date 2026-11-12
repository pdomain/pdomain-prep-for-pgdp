import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { buildRealImageStageReviewServices } from "./imageStageReview";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reRunPages", () => {
  it("posts the draft as settings with the page ids", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ rows: [] });

    await buildRealImageStageReviewServices().reRunPages(
      "proj 1",
      "threshold",
      { threshold_level: 170 },
      ["0000", "0012"],
    );

    expect(post).toHaveBeenCalledWith(
      "/api/data/projects/proj%201/project-stages/threshold/rerun",
      { page_ids: ["0000", "0012"], settings: { threshold_level: 170 } },
    );
  });
});
