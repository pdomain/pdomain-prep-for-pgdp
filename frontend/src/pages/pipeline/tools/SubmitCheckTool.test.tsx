/**
 * SubmitCheckTool.test.tsx — Artboard fixture tests for the Submit Check stage tool surface.
 *
 * Covers:
 * - Initial dry-running state: dry-running indicator
 * - Ready state: dry-run-passed gate, checks-stat, submit-btn, rerun-dry-btn
 * - confirmingSubmit state: submit-confirm-dialog, submit-confirm-btn, submit-cancel-btn
 * - CANCEL from confirmingSubmit → back to ready
 * - submitted (final) state: submitted-final panel
 * - Settings tab: submit-check-settings, target, confirmOnSubmit display
 *
 * @see src/machines/tools/submitCheckTool.ts
 * @see src/pages/pipeline/tools/SubmitCheckTool.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SubmitCheckTool } from "./SubmitCheckTool";
import type {
  SubmitCheckToolServices,
  SubmitCheck,
} from "@/machines/tools/submitCheckTool";

// ---------------------------------------------------------------------------
// Stub runnerRef
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Test services + mock checks
// ---------------------------------------------------------------------------

const MOCK_CHECKS: SubmitCheck[] = [
  { ok: true, label: "All pages have images" },
  { ok: true, label: "All pages have text" },
  { ok: true, label: "Metadata complete" },
  { ok: true, label: "No missing illustrations" },
  { ok: true, label: "Package size within limits" },
];

const TEST_SERVICES: SubmitCheckToolServices = {
  dryRun: async (_projectId, _target) => MOCK_CHECKS,
  liveSubmit: async (_projectId, _target) => ({ at: "2026-06-11T00:00:00Z" }),
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderSubmitCheck() {
  return render(
    <MemoryRouter>
      <SubmitCheckTool
        stageId="submit_check"
        runnerRef={fakeRunnerRef}
        _testServices={TEST_SERVICES}
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Initial state (dry running)
// ---------------------------------------------------------------------------

describe("SubmitCheckTool — initial state (dryRunning)", () => {
  it("renders submit-check-tool root immediately", () => {
    renderSubmitCheck();
    expect(screen.getByTestId("submit-check-tool")).toBeInTheDocument();
  });

  it("shows dry-running indicator on mount", () => {
    renderSubmitCheck();
    expect(screen.getByTestId("dry-running")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Ready state (after dry run completes — all checks ok)
// ---------------------------------------------------------------------------

describe("SubmitCheckTool — ready state (dry run passed)", () => {
  it("renders dry-run-passed gate after dry run", async () => {
    renderSubmitCheck();
    await waitFor(() => {
      expect(screen.getByTestId("dry-run-passed")).toBeInTheDocument();
    });
  });

  it("renders checks-stat after dry run", async () => {
    renderSubmitCheck();
    await waitFor(() => {
      expect(screen.getByTestId("checks-stat")).toBeInTheDocument();
    });
  });

  it("checks-stat shows 5 / 5 (all MOCK_CHECKS pass)", async () => {
    renderSubmitCheck();
    await waitFor(() => {
      expect(screen.getByTestId("checks-stat")).toHaveTextContent("5 / 5");
    });
  });

  it("submit-btn is present and enabled in ready state", async () => {
    renderSubmitCheck();
    await waitFor(() => {
      expect(screen.getByTestId("submit-btn")).toBeInTheDocument();
    });
    expect(screen.getByTestId("submit-btn")).not.toBeDisabled();
  });

  it("rerun-dry-btn is present in ready state", async () => {
    renderSubmitCheck();
    await waitFor(() => {
      expect(screen.getByTestId("rerun-dry-btn")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// ConfirmationSubmit state (GateConfirmation — submit requires confirmation)
// ---------------------------------------------------------------------------

describe("SubmitCheckTool — confirmingSubmit state", () => {
  it("clicking submit-btn opens submit-confirm-dialog (confirmOnSubmit=true)", async () => {
    renderSubmitCheck();
    await waitFor(() => {
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("submit-btn"));
    expect(screen.getByTestId("submit-confirm-dialog")).toBeInTheDocument();
  });

  it("submit-confirm-btn is present in dialog", async () => {
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("submit-btn"));
    expect(screen.getByTestId("submit-confirm-btn")).toBeInTheDocument();
  });

  it("submit-cancel-btn is present in dialog", async () => {
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("submit-btn"));
    expect(screen.getByTestId("submit-cancel-btn")).toBeInTheDocument();
  });

  it("CANCEL from confirmingSubmit closes dialog and returns to ready", async () => {
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("submit-btn"));
    expect(screen.getByTestId("submit-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("submit-cancel-btn"));
    expect(
      screen.queryByTestId("submit-confirm-dialog"),
    ).not.toBeInTheDocument();
    // Back in ready state
    expect(screen.getByTestId("dry-run-passed")).toBeInTheDocument();
  });

  it("CONFIRM → submitted final state", async () => {
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("submit-btn"));
    fireEvent.click(screen.getByTestId("submit-confirm-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("submitted-final")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Submitted (final) state
// ---------------------------------------------------------------------------

describe("SubmitCheckTool — submitted final state", () => {
  it("does not render submit-check-tool tabs in submitted state", async () => {
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("submit-btn")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("submit-btn"));
    fireEvent.click(screen.getByTestId("submit-confirm-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("submitted-final")).toBeInTheDocument();
    });
    // Tab bar is gone
    expect(screen.queryByTestId("submit-check-tool")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

describe("SubmitCheckTool — settings tab", () => {
  it("renders submit-check-settings panel on Settings tab", async () => {
    const user = userEvent.setup();
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("dry-run-passed")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("submit-check-settings")).toBeInTheDocument();
  });

  it("shows target: production in settings", async () => {
    const user = userEvent.setup();
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("dry-run-passed")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByText("production")).toBeInTheDocument();
  });

  it("shows confirmOnSubmit: on in settings (default=true)", async () => {
    const user = userEvent.setup();
    renderSubmitCheck();
    await waitFor(() =>
      expect(screen.getByTestId("dry-run-passed")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    // "on" appears in the confirmOnSubmit row
    expect(screen.getByText("on")).toBeInTheDocument();
  });
});
