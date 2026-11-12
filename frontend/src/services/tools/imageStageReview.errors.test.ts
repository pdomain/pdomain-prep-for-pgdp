import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { buildRealImageStageReviewServices } from "./imageStageReview";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("image stage review service failures", () => {
  it("reports a failed page load", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"));

    await expect(
      buildRealImageStageReviewServices().fetchStagePages("p", "threshold"),
    ).rejects.toThrow("offline");
  });

  it("reports a failed re-run", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new Error("no such setting"));

    await expect(
      buildRealImageStageReviewServices().reRunPages("p", "threshold", {}, [
        "0000",
      ]),
    ).rejects.toThrow("no such setting");
  });
});
