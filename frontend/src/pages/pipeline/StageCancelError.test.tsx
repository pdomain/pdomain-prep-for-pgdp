import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import { stageRunnerMachine } from "@/machines/stageRunner";
import { StageCancelError } from "./StageCancelError";

function startRunner(requestCancel: () => Promise<void>) {
  const actor = createActor(stageRunnerMachine, {
    input: {
      stageId: "grayscale",
      index: 1,
      group: "Image",
      projectId: "proj-1",
      pageScoped: true,
      services: {
        runStage: vi
          .fn()
          .mockResolvedValue({ status: "clean", flaggedPages: [] }),
        requestCancel,
        requestPause: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
  actor.start();
  return actor;
}

describe("StageCancelError", () => {
  it("shows nothing until a cancel fails", () => {
    const actor = startRunner(vi.fn().mockResolvedValue(undefined));
    render(<StageCancelError runner={actor} />);
    expect(screen.queryByRole("alert")).toBeNull();
    actor.stop();
  });

  it("shows the failure when the cancel request is rejected", async () => {
    const actor = startRunner(vi.fn().mockRejectedValue(new Error("HTTP 500")));
    render(<StageCancelError runner={actor} />);
    act(() => {
      actor.send({ type: "RUN" });
      actor.send({ type: "CANCEL" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not cancel this stage: HTTP 500",
    );
    actor.stop();
  });
});
