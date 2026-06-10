/**
 * attributesPanel invariant tests.
 *
 * Key invariants:
 * 1. Exclusive inline edit: one section open at a time; EDIT picks section.
 * 2. Dirty guard: CANCEL with changes → confirmDiscard; CANCEL without → idle.
 * 3. confirmDiscard: DISCARD clears draft; KEEP returns to active.
 * 4. Save round-trip: SAVE invokes saveAttributes, commitDraft on success.
 * 5. Section collapse toggles via TOGGLE_* events.
 * 6. RETRY from loadError re-enters loading.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  attributesPanelMachine,
  type AttributesPanelInput,
  type AttributesPanelServices,
} from "./attributesPanel";
import type { AttributeRecord } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_FIELDS: AttributeRecord = {
  bib: { title: "Book Title", author: "Test Author", year: "1900", lang: "en" },
  pgdp: { project_id: "pgdp-123", round: "P1", genre: "Fiction" },
  fmt: { charset: "Latin-1", scanDpi: "600" },
  comments: "initial comment",
};

function makeServices(
  overrides: Partial<AttributesPanelServices> = {},
): AttributesPanelServices {
  return {
    fetchAttributes: vi.fn().mockResolvedValue(MOCK_FIELDS),
    saveAttributes: vi
      .fn()
      .mockImplementation(async (_projectId, _section, draft) => ({
        ...MOCK_FIELDS,
        bib: { ...MOCK_FIELDS.bib, ...draft },
      })),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<AttributesPanelInput> = {},
): AttributesPanelInput {
  return {
    projectId: "proj-1",
    services: makeServices(),
    ...overrides,
  };
}

async function startLoadedActor(overrides: Partial<AttributesPanelInput> = {}) {
  const actor = createActor(attributesPanelMachine, {
    input: makeInput(overrides),
  });
  actor.start();
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches("viewing")).toBe(true);
  });
  return actor;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

describe("attributesPanel — loading", () => {
  it("starts in loading state", () => {
    const actor = createActor(attributesPanelMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("transitions to viewing after successful fetch", async () => {
    const actor = await startLoadedActor();
    expect(actor.getSnapshot().matches("viewing")).toBe(true);
    expect(actor.getSnapshot().context.fields).toEqual(MOCK_FIELDS);
    actor.stop();
  });

  it("transitions to loadError on fetch failure", async () => {
    const services = makeServices({
      fetchAttributes: vi.fn().mockRejectedValue(new Error("network")),
    });
    const actor = createActor(attributesPanelMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("loadError");
    });
    actor.stop();
  });

  it("RETRY from loadError re-enters loading", async () => {
    const services = makeServices({
      fetchAttributes: vi.fn().mockRejectedValue(new Error("network")),
    });
    const actor = createActor(attributesPanelMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("loadError");
    });
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Exclusive inline edit
// ---------------------------------------------------------------------------

describe("attributesPanel — exclusive inline edit", () => {
  it("EDIT sets editingSection and initializes draft", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    const snap = actor.getSnapshot();
    expect(snap.context.editingSection).toBe("bib");
    expect(snap.context.draft).toEqual(MOCK_FIELDS.bib);
    actor.stop();
  });

  it("EDIT auto-opens the section being edited", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    expect(actor.getSnapshot().context.open.bib).toBe(true);
    actor.stop();
  });

  it("active.clean transitions to active.dirty on CHANGE", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    actor.send({ type: "CHANGE", field: "title", value: "New Title" });
    expect(
      actor
        .getSnapshot()
        .matches({ viewing: { editing: { active: "dirty" } } }),
    ).toBe(true);
    expect(actor.getSnapshot().context.draft?.["title"]).toBe("New Title");
    actor.stop();
  });

  it("CANCEL when clean (not dirty) returns to idle", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    // No CHANGE — draft equals original → not dirty
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches({ viewing: { editing: "idle" } })).toBe(
      true,
    );
    expect(actor.getSnapshot().context.editingSection).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Dirty guard → confirmDiscard
// ---------------------------------------------------------------------------

describe("attributesPanel — dirty guard + confirmDiscard", () => {
  it("CANCEL with dirty draft routes to confirmDiscard", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    actor.send({ type: "CHANGE", field: "title", value: "Changed" });
    actor.send({ type: "CANCEL" });
    expect(
      actor.getSnapshot().matches({ viewing: { editing: "confirmDiscard" } }),
    ).toBe(true);
    actor.stop();
  });

  it("DISCARD from confirmDiscard clears draft and returns to idle", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    actor.send({ type: "CHANGE", field: "title", value: "Changed" });
    actor.send({ type: "CANCEL" });
    actor.send({ type: "DISCARD" });
    expect(actor.getSnapshot().matches({ viewing: { editing: "idle" } })).toBe(
      true,
    );
    expect(actor.getSnapshot().context.draft).toBeNull();
    expect(actor.getSnapshot().context.editingSection).toBeNull();
    actor.stop();
  });

  it("KEEP from confirmDiscard returns to active editing", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    actor.send({ type: "CHANGE", field: "title", value: "Changed" });
    actor.send({ type: "CANCEL" });
    actor.send({ type: "KEEP" });
    expect(
      actor.getSnapshot().matches({ viewing: { editing: "active" } }),
    ).toBe(true);
    // Draft should still have the change
    expect(actor.getSnapshot().context.draft?.["title"]).toBe("Changed");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Save round-trip
// ---------------------------------------------------------------------------

describe("attributesPanel — save round-trip", () => {
  it("SAVE calls saveAttributes and commits on success", async () => {
    const saveAttributes = vi.fn().mockResolvedValue({
      ...MOCK_FIELDS,
      bib: { ...MOCK_FIELDS.bib, title: "Saved Title" },
    });
    const services = makeServices({ saveAttributes });
    const actor = await startLoadedActor({ services });
    actor.send({ type: "EDIT", section: "bib" });
    actor.send({ type: "CHANGE", field: "title", value: "Saved Title" });
    actor.send({ type: "SAVE" });
    expect(
      actor.getSnapshot().matches({ viewing: { editing: "saving" } }),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(
        actor.getSnapshot().matches({ viewing: { editing: "idle" } }),
      ).toBe(true);
    });
    expect(saveAttributes).toHaveBeenCalledWith(
      "proj-1",
      "bib",
      expect.objectContaining({ title: "Saved Title" }),
    );
    // fields updated with saved result
    expect(actor.getSnapshot().context.fields?.bib["title"]).toBe(
      "Saved Title",
    );
    actor.stop();
  });

  it("save failure returns to active with error", async () => {
    const services = makeServices({
      saveAttributes: vi.fn().mockRejectedValue(new Error("save failed")),
    });
    const actor = await startLoadedActor({ services });
    actor.send({ type: "EDIT", section: "bib" });
    actor.send({ type: "CHANGE", field: "title", value: "X" });
    actor.send({ type: "SAVE" });
    await vi.waitFor(() => {
      // Should return to active (not saving)
      expect(
        actor.getSnapshot().matches({ viewing: { editing: "active" } }),
      ).toBe(true);
    });
    expect(actor.getSnapshot().context.error).toBe("save failed");
    actor.stop();
  });

  it("SAVE is only available in dirty state (not clean)", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "EDIT", section: "bib" });
    // No CHANGE — clean state
    actor.send({ type: "SAVE" });
    // Should stay in active.clean (SAVE not handled there)
    expect(
      actor
        .getSnapshot()
        .matches({ viewing: { editing: { active: "clean" } } }),
    ).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Section collapse toggle
// ---------------------------------------------------------------------------

describe("attributesPanel — section collapse", () => {
  it("starts with all sections open", async () => {
    const actor = await startLoadedActor();
    const { open } = actor.getSnapshot().context;
    expect(open.bib).toBe(true);
    expect(open.pgdp).toBe(true);
    expect(open.fmt).toBe(true);
    expect(open.comments).toBe(true);
    actor.stop();
  });

  it("TOGGLE_BIB closes bib section", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "TOGGLE_BIB" });
    expect(actor.getSnapshot().context.open.bib).toBe(false);
    actor.stop();
  });

  it("TOGGLE_BIB twice restores open state", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "TOGGLE_BIB" });
    actor.send({ type: "TOGGLE_BIB" });
    expect(actor.getSnapshot().context.open.bib).toBe(true);
    actor.stop();
  });

  it("TOGGLE_COMMENTS only affects comments section", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "TOGGLE_COMMENTS" });
    const { open } = actor.getSnapshot().context;
    expect(open.comments).toBe(false);
    expect(open.bib).toBe(true);
    expect(open.pgdp).toBe(true);
    expect(open.fmt).toBe(true);
    actor.stop();
  });
});
