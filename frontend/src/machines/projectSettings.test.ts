/**
 * projectSettings machine test suite.
 *
 * Tests per Task F4 specification:
 * 1. Load → ready lifecycle
 * 2. Group navigation
 * 3. Autosave fields
 * 4. Automation toggles
 * 5. Danger zone confirm gate
 * 6. Error handling
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  projectSettingsMachine,
  type ProjectSettingsInput,
  type ProjectSettingsServices,
} from "./projectSettings";
import type { AutomationToggles } from "./pipelineShell";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_VALUES = { name: "Test Book", author: "Test Author" };
const DEFAULT_AUTOMATION: AutomationToggles = {
  autoRunAfterIngest: true,
  rerunDownstreamOnStale: true,
  notifyOnError: true,
  pauseOnFlagPct: 10,
};

function makeServices(
  overrides: Partial<ProjectSettingsServices> = {},
): ProjectSettingsServices {
  return {
    fetchSettings: vi.fn().mockResolvedValue({
      values: DEFAULT_VALUES,
      automation: DEFAULT_AUTOMATION,
    }),
    saveField: vi.fn().mockResolvedValue(undefined),
    saveAutomation: vi.fn().mockResolvedValue(undefined),
    runDestructive: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ProjectSettingsInput> = {},
): ProjectSettingsInput {
  return {
    projectId: "proj-1",
    services: makeServices(),
    ...overrides,
  };
}

async function readySettings(overrides: Partial<ProjectSettingsInput> = {}) {
  const actor = createActor(projectSettingsMachine, {
    input: makeInput(overrides),
  });
  actor.start();
  await new Promise((r) => setTimeout(r, 0));
  return actor;
}

// ---------------------------------------------------------------------------
// Boot lifecycle
// ---------------------------------------------------------------------------

describe("projectSettings — boot lifecycle", () => {
  it("starts in loading state", () => {
    const actor = createActor(projectSettingsMachine, {
      input: makeInput(),
    });
    actor.start();
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("transitions loading → ready after fetchSettings resolves", async () => {
    const actor = await readySettings();
    expect(actor.getSnapshot().matches("ready")).toBe(true);
    actor.stop();
  });

  it("assigns values and automation from fetch response", async () => {
    const actor = await readySettings();
    const ctx = actor.getSnapshot().context;
    expect(ctx.values).toEqual(DEFAULT_VALUES);
    expect(ctx.automation).toEqual(DEFAULT_AUTOMATION);
    actor.stop();
  });

  it("transitions loading → loadError when fetchSettings rejects", async () => {
    const actor = createActor(projectSettingsMachine, {
      input: makeInput({
        services: makeServices({
          fetchSettings: vi.fn().mockRejectedValue(new Error("fetch failed")),
        }),
      }),
    });
    actor.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("loadError");
    actor.stop();
  });

  it("can RETRY from loadError", async () => {
    const fetchSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue({ values: {}, automation: DEFAULT_AUTOMATION });

    const actor = createActor(projectSettingsMachine, {
      input: makeInput({ services: makeServices({ fetchSettings }) }),
    });
    actor.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("loadError");

    actor.send({ type: "RETRY" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().matches("ready")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Group navigation
// ---------------------------------------------------------------------------

describe("projectSettings — group navigation", () => {
  it("starts in general group", async () => {
    const actor = await readySettings();
    expect(actor.getSnapshot().context.group).toBe("general");
    actor.stop();
  });

  it("SET_GROUP changes the group", async () => {
    const actor = await readySettings();
    actor.send({ type: "SET_GROUP", group: "danger" });
    expect(actor.getSnapshot().context.group).toBe("danger");
    actor.stop();
  });

  it("SET_GROUP to same group is ignored", async () => {
    const actor = await readySettings();
    actor.send({ type: "SET_GROUP", group: "general" });
    // No change — guard groupChanged blocks same-group events
    expect(actor.getSnapshot().context.group).toBe("general");
    actor.stop();
  });

  it("can navigate to all valid groups", async () => {
    const actor = await readySettings();
    const groups = [
      "bib",
      "pgdp",
      "format",
      "defaults",
      "members",
      "storage",
      "danger",
      "general",
    ] as const;
    for (const group of groups) {
      actor.send({ type: "SET_GROUP", group });
      expect(actor.getSnapshot().context.group).toBe(group);
      // Switch to a different group before next iteration to avoid same-group guard
      if (group !== "general") {
        actor.send({ type: "SET_GROUP", group: "general" });
      }
    }
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Autosave fields
// ---------------------------------------------------------------------------

describe("projectSettings — autosave fields", () => {
  it("FIELD_CHANGE marks field dirty", async () => {
    const actor = await readySettings();
    actor.send({ type: "FIELD_CHANGE", key: "name", value: "New Name" });
    expect(actor.getSnapshot().context.dirtyFields.has("name")).toBe(true);
    actor.stop();
  });

  it("FIELD_SAVED clears field dirty", async () => {
    const actor = await readySettings();
    actor.send({ type: "FIELD_CHANGE", key: "name", value: "New Name" });
    actor.send({ type: "FIELD_SAVED", key: "name" });
    expect(actor.getSnapshot().context.dirtyFields.has("name")).toBe(false);
    actor.stop();
  });

  it("FIELD_CHANGE calls saveField service", async () => {
    const saveField = vi.fn().mockResolvedValue(undefined);
    const actor = await readySettings({
      services: makeServices({ saveField }),
    });
    actor.send({ type: "FIELD_CHANGE", key: "author", value: "New Author" });
    expect(saveField).toHaveBeenCalledWith("proj-1", "author", "New Author");
    actor.stop();
  });

  it("FIELD_FAILED clears dirty and sets error", async () => {
    const actor = await readySettings();
    actor.send({ type: "FIELD_CHANGE", key: "name", value: "x" });
    actor.send({ type: "FIELD_FAILED", key: "name", error: "Save failed" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.dirtyFields.has("name")).toBe(false);
    expect(ctx.error).toBe("Save failed");
    actor.stop();
  });

  it("multiple fields can be dirty simultaneously", async () => {
    const actor = await readySettings();
    actor.send({ type: "FIELD_CHANGE", key: "name", value: "a" });
    actor.send({ type: "FIELD_CHANGE", key: "author", value: "b" });
    const { dirtyFields } = actor.getSnapshot().context;
    expect(dirtyFields.has("name")).toBe(true);
    expect(dirtyFields.has("author")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Automation toggles
// ---------------------------------------------------------------------------

describe("projectSettings — automation toggles", () => {
  it("TOGGLE_AUTOMATION updates automation context", async () => {
    const actor = await readySettings();
    actor.send({
      type: "TOGGLE_AUTOMATION",
      key: "rerunDownstreamOnStale",
      value: false,
    });
    expect(actor.getSnapshot().context.automation.rerunDownstreamOnStale).toBe(
      false,
    );
    actor.stop();
  });

  it("TOGGLE_AUTOMATION calls saveAutomation service", async () => {
    const saveAutomation = vi.fn().mockResolvedValue(undefined);
    const actor = await readySettings({
      services: makeServices({ saveAutomation }),
    });
    actor.send({
      type: "TOGGLE_AUTOMATION",
      key: "notifyOnError",
      value: false,
    });
    expect(saveAutomation).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ notifyOnError: false }),
    );
    actor.stop();
  });

  it("TOGGLE_AUTOMATION can update pauseOnFlagPct (number value)", async () => {
    const actor = await readySettings();
    actor.send({
      type: "TOGGLE_AUTOMATION",
      key: "pauseOnFlagPct",
      value: 25,
    });
    expect(actor.getSnapshot().context.automation.pauseOnFlagPct).toBe(25);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

describe("projectSettings — danger zone", () => {
  async function inDanger() {
    const actor = await readySettings();
    actor.send({ type: "SET_GROUP", group: "danger" });
    return actor;
  }

  it("starts in danger.idle", async () => {
    const actor = await inDanger();
    expect(actor.getSnapshot().matches({ ready: { danger: "idle" } })).toBe(
      true,
    );
    actor.stop();
  });

  it("REQUEST_DESTRUCTIVE → confirming; sets _pending", async () => {
    const actor = await inDanger();
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "reset" });
    expect(
      actor.getSnapshot().matches({ ready: { danger: "confirming" } }),
    ).toBe(true);
    expect(actor.getSnapshot().context._pending).toBe("reset");
    actor.stop();
  });

  it("CANCEL from confirming → idle; clears _pending", async () => {
    const actor = await inDanger();
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "purge" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches({ ready: { danger: "idle" } })).toBe(
      true,
    );
    expect(actor.getSnapshot().context._pending).toBeNull();
    actor.stop();
  });

  it("ACKNOWLEDGE from confirming → armed; sets _ack", async () => {
    const actor = await inDanger();
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "delete" });
    actor.send({ type: "ACKNOWLEDGE" });
    expect(actor.getSnapshot().matches({ ready: { danger: "armed" } })).toBe(
      true,
    );
    expect(actor.getSnapshot().context._ack).toBe(true);
    actor.stop();
  });

  it("CONFIRM from armed (acknowledged) → executing", async () => {
    const actor = await inDanger();
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "reset" });
    actor.send({ type: "ACKNOWLEDGE" });
    actor.send({ type: "CONFIRM" });
    expect(
      actor.getSnapshot().matches({ ready: { danger: "executing" } }),
    ).toBe(true);
    actor.stop();
  });

  it("CONFIRM without ACKNOWLEDGE is blocked (guard)", async () => {
    const actor = await inDanger();
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "reset" });
    // Skip ACKNOWLEDGE — go straight to CONFIRM
    actor.send({ type: "CONFIRM" });
    // Should still be in confirming, not executing
    expect(
      actor.getSnapshot().matches({ ready: { danger: "confirming" } }),
    ).toBe(true);
    actor.stop();
  });

  it("executing → idle on success; clears _pending and _ack", async () => {
    const actor = await inDanger();
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "reset" });
    actor.send({ type: "ACKNOWLEDGE" });
    actor.send({ type: "CONFIRM" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().matches({ ready: { danger: "idle" } })).toBe(
      true,
    );
    expect(actor.getSnapshot().context._pending).toBeNull();
    expect(actor.getSnapshot().context._ack).toBe(false);
    actor.stop();
  });

  it("executing → idle on error; sets error context", async () => {
    const actor = await readySettings({
      services: makeServices({
        runDestructive: vi.fn().mockRejectedValue(new Error("cannot delete")),
      }),
    });
    actor.send({ type: "SET_GROUP", group: "danger" });
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "delete" });
    actor.send({ type: "ACKNOWLEDGE" });
    actor.send({ type: "CONFIRM" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().matches({ ready: { danger: "idle" } })).toBe(
      true,
    );
    expect(actor.getSnapshot().context.error).toBe("cannot delete");
    actor.stop();
  });

  it("runDestructive service is called with correct projectId and action", async () => {
    const runDestructive = vi.fn().mockResolvedValue({ ok: true });
    const actor = await readySettings({
      services: makeServices({ runDestructive }),
    });
    actor.send({ type: "SET_GROUP", group: "danger" });
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "purge" });
    actor.send({ type: "ACKNOWLEDGE" });
    actor.send({ type: "CONFIRM" });
    await new Promise((r) => setTimeout(r, 0));
    expect(runDestructive).toHaveBeenCalledWith("proj-1", "purge");
    actor.stop();
  });

  it("CANCEL from armed → idle; clears _pending", async () => {
    const actor = await inDanger();
    actor.send({ type: "REQUEST_DESTRUCTIVE", action: "reset" });
    actor.send({ type: "ACKNOWLEDGE" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches({ ready: { danger: "idle" } })).toBe(
      true,
    );
    expect(actor.getSnapshot().context._pending).toBeNull();
    expect(actor.getSnapshot().context._ack).toBe(false);
    actor.stop();
  });
});
