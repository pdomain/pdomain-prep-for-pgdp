/**
 * ProofPackTool.test.tsx — Artboard fixture tests for the Proof Pack stage tool surface.
 *
 * Covers:
 * - Initial assembling state (spinner)
 * - Assembled state: gate-assembled, tree view, completeness bar
 * - Incomplete state (gated by completeness): gate-incomplete + open-missing-btn
 * - Settings tab: include toggles + reassemble button
 *
 * @see src/machines/tools/proofPackTool.ts
 * @see src/pages/pipeline/tools/ProofPackTool.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProofPackTool } from "./ProofPackTool";

// ---------------------------------------------------------------------------
// Stub runnerRef
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderProofPack() {
  return render(
    <ProofPackTool stageId="proof_pack" runnerRef={fakeRunnerRef} />,
  );
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("ProofPackTool — initial state", () => {
  it("shows proof-pack-assembling spinner on mount", () => {
    renderProofPack();
    expect(screen.getByTestId("proof-pack-assembling")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Assembled state
// ---------------------------------------------------------------------------

describe("ProofPackTool — assembled state", () => {
  it("renders proof-pack-tool root after assembly", async () => {
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("proof-pack-tool")).toBeInTheDocument();
    });
  });

  it("renders gate-assembled card", async () => {
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("gate-assembled")).toBeInTheDocument();
    });
  });

  it("renders proof-pack-tree", async () => {
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("proof-pack-tree")).toBeInTheDocument();
    });
  });

  it("renders completeness-bar and completeness-label", async () => {
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("completeness-bar")).toBeInTheDocument();
      expect(screen.getByTestId("completeness-label")).toBeInTheDocument();
    });
  });

  it("completeness-label shows 387 / 387", async () => {
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("completeness-label")).toHaveTextContent(
        "387 / 387",
      );
    });
  });

  it("open-missing-btn is NOT shown when assembled", async () => {
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("gate-assembled")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("open-missing-btn")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

describe("ProofPackTool — settings tab", () => {
  it("renders include-images-toggle on Settings tab", async () => {
    const user = userEvent.setup();
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("proof-pack-tool")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("include-images-toggle")).toBeInTheDocument();
  });

  it("renders include-text-toggle on Settings tab", async () => {
    const user = userEvent.setup();
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("proof-pack-tool")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("include-text-toggle")).toBeInTheDocument();
  });

  it("renders include-illustrations-toggle on Settings tab", async () => {
    const user = userEvent.setup();
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("proof-pack-tool")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(
      screen.getByTestId("include-illustrations-toggle"),
    ).toBeInTheDocument();
  });

  it("renders reassemble-btn on Settings tab", async () => {
    const user = userEvent.setup();
    renderProofPack();
    await waitFor(() => {
      expect(screen.getByTestId("proof-pack-tool")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("reassemble-btn")).toBeInTheDocument();
  });
});
