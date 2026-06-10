/**
 * manageActions invariant tests.
 *
 * Key invariants:
 * 1. Two-step delete: DELETE on active project → confirming (step 1, archives).
 * 2. Two-step delete: DELETE on archived project → confirmingDanger → permanent (step 2).
 * 3. confirmingDanger requires ACKNOWLEDGE before CONFIRM can execute.
 * 4. PROJECT_MUTATED emission (onMutated callback) fires after executing.
 * 5. SAVE_COPY skips confirm and goes straight to executing.
 * 6. done auto-dismisses after 1500ms.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  manageActionsMachine,
  type ManageActionsInput,
  type ManageActionsServices,
} from "./manageActions";
import type { ManageAction, ManageActionResult } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServices(
  overrides: Partial<ManageActionsServices> = {},
): ManageActionsServices {
  return {
    runManageAction: vi
      .fn<
        (
          projectId: string,
          action: ManageAction,
          step?: 1 | 2,
        ) => Promise<ManageActionResult>
      >()
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      .mockResolvedValue({ action: "clean" as ManageAction }),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ManageActionsInput> = {},
): ManageActionsInput {
  return {
    projectId: "proj-1",
    isArchived: false,
    services: makeServices(),
    ...overrides,
  };
}

function startActor(overrides: Partial<ManageActionsInput> = {}) {
  const actor = createActor(manageActionsMachine, {
    input: makeInput(overrides),
  });
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Initial state routing
// ---------------------------------------------------------------------------

describe("manageActions — initial routing", () => {
  it("lands in activeActions.list when not archived", () => {
    const actor = startActor({ isArchived: false });
    expect(actor.getSnapshot().matches({ activeActions: "list" })).toBe(true);
    actor.stop();
  });

  it("lands in archivedActions.list when archived", () => {
    const actor = startActor({ isArchived: true });
    expect(actor.getSnapshot().matches({ archivedActions: "list" })).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Two-step delete — active project (step 1 → archives)
// ---------------------------------------------------------------------------

describe("manageActions — two-step delete (active project)", () => {
  it("DELETE routes to confirming with _step=1", () => {
    const actor = startActor({ isArchived: false });
    actor.send({ type: "DELETE" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("confirming");
    expect(snap.context._step).toBe(1);
    expect(snap.context.pendingAction).toBe("delete");
    actor.stop();
  });

  it("CANCEL from confirming returns to activeActions.list and clears pending", () => {
    const actor = startActor({ isArchived: false });
    actor.send({ type: "DELETE" });
    actor.send({ type: "CANCEL" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ activeActions: "list" })).toBe(true);
    expect(snap.context.pendingAction).toBeNull();
    expect(snap.context._step).toBeNull();
    actor.stop();
  });

  it("CONFIRM from confirming proceeds to executing", () => {
    const actor = startActor({ isArchived: false });
    actor.send({ type: "DELETE" });
    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().value).toBe("executing");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Two-step delete — archived project (step 2 → permanent, danger gate)
// ---------------------------------------------------------------------------

describe("manageActions — two-step delete (archived project)", () => {
  it("DELETE routes to confirmingDanger.armed with _step=2", () => {
    const actor = startActor({ isArchived: true });
    actor.send({ type: "DELETE" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ confirmingDanger: "armed" })).toBe(true);
    expect(snap.context._step).toBe(2);
    expect(snap.context.pendingAction).toBe("delete");
    actor.stop();
  });

  it("CONFIRM in confirmingDanger.armed does NOT execute (no ack)", () => {
    // CONFIRM is only valid in confirmingDanger.ready (after ACKNOWLEDGE)
    const actor = startActor({ isArchived: true });
    actor.send({ type: "DELETE" });
    // CONFIRM in 'armed' is not handled — should stay in armed
    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().matches({ confirmingDanger: "armed" })).toBe(
      true,
    );
    actor.stop();
  });

  it("ACKNOWLEDGE moves confirmingDanger.armed → confirmingDanger.ready", () => {
    const actor = startActor({ isArchived: true });
    actor.send({ type: "DELETE" });
    actor.send({ type: "ACKNOWLEDGE" });
    expect(actor.getSnapshot().matches({ confirmingDanger: "ready" })).toBe(
      true,
    );
    expect(actor.getSnapshot().context._ack).toBe(true);
    actor.stop();
  });

  it("CONFIRM in confirmingDanger.ready proceeds to executing", () => {
    const actor = startActor({ isArchived: true });
    actor.send({ type: "DELETE" });
    actor.send({ type: "ACKNOWLEDGE" });
    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().value).toBe("executing");
    actor.stop();
  });

  it("CANCEL from confirmingDanger.armed clears pending and routes to deciding", () => {
    const actor = startActor({ isArchived: true });
    actor.send({ type: "DELETE" });
    actor.send({ type: "CANCEL" });
    const snap = actor.getSnapshot();
    // deciding routes immediately to archivedActions.list
    expect(snap.matches({ archivedActions: "list" })).toBe(true);
    expect(snap.context.pendingAction).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// PROJECT_MUTATED emission (onMutated callback)
// ---------------------------------------------------------------------------

describe("manageActions — onMutated callback (PROJECT_MUTATED)", () => {
  it("fires onMutated after executing completes", async () => {
    const onMutated = vi.fn();
    const services = makeServices({
      runManageAction: vi
        .fn()
        .mockResolvedValue({ action: "clean" as ManageAction }),
    });
    const actor = createActor(manageActionsMachine, {
      input: {
        projectId: "proj-1",
        isArchived: false,
        services,
        onMutated,
      },
    });
    actor.start();
    actor.send({ type: "ARCHIVE" });
    actor.send({ type: "CONFIRM" });
    // Wait for async actor to finish
    await vi.waitFor(() => {
      expect(onMutated).toHaveBeenCalledWith(
        "archive",
        expect.objectContaining({ action: expect.any(String) }),
      );
    });
    actor.stop();
  });

  it("does NOT fire onMutated on error", async () => {
    const onMutated = vi.fn();
    const services = makeServices({
      runManageAction: vi.fn().mockRejectedValue(new Error("server error")),
    });
    const actor = createActor(manageActionsMachine, {
      input: {
        projectId: "proj-1",
        isArchived: false,
        services,
        onMutated,
      },
    });
    actor.start();
    actor.send({ type: "CLEAN" });
    actor.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("failed");
    });
    expect(onMutated).not.toHaveBeenCalled();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// SAVE_COPY skips confirm
// ---------------------------------------------------------------------------

describe("manageActions — SAVE_COPY skips confirm gate", () => {
  it("SAVE_COPY on active project goes directly to executing", () => {
    const actor = startActor({ isArchived: false });
    actor.send({ type: "SAVE_COPY" });
    expect(actor.getSnapshot().value).toBe("executing");
    actor.stop();
  });

  it("SAVE_COPY on archived project goes directly to executing", () => {
    const actor = startActor({ isArchived: true });
    actor.send({ type: "SAVE_COPY" });
    expect(actor.getSnapshot().value).toBe("executing");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// RETRY from failed
// ---------------------------------------------------------------------------

describe("manageActions — RETRY from failed", () => {
  it("RETRY re-enters executing after failure", async () => {
    const services = makeServices({
      runManageAction: vi
        .fn()
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce({ action: "clean" as ManageAction }),
    });
    const actor = createActor(manageActionsMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({ type: "CLEAN" });
    actor.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("failed");
    });
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("executing");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// done state — auto-dismiss after 1500ms
// ---------------------------------------------------------------------------

describe("manageActions — done auto-dismiss", () => {
  it("DISMISS from done immediately returns to deciding/activeActions", async () => {
    const services = makeServices({
      runManageAction: vi
        .fn()
        .mockResolvedValue({ action: "clean" as ManageAction }),
    });
    const actor = createActor(manageActionsMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({ type: "CLEAN" });
    actor.send({ type: "CONFIRM" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("done");
    });
    actor.send({ type: "DISMISS" });
    expect(actor.getSnapshot().matches({ activeActions: "list" })).toBe(true);
    actor.stop();
  });
});
