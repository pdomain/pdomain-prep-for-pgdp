import { describe, it, expect } from "vitest";
import { HOTKEY_MAP } from "./hotkeyMap";

describe("HOTKEY_MAP", () => {
  it("has at least one entry", () => {
    expect(HOTKEY_MAP.length).toBeGreaterThan(0);
  });

  it("every entry has keys, description, section", () => {
    for (const entry of HOTKEY_MAP) {
      expect(entry.keys.length).toBeGreaterThan(0);
      expect(entry.description).toBeTruthy();
      expect(["Navigation", "Editing", "View"]).toContain(entry.section);
    }
  });

  it("has at least one Editing entry", () => {
    const editing = HOTKEY_MAP.filter((h) => h.section === "Editing");
    expect(editing.length).toBeGreaterThan(0);
  });

  it("has at least one Navigation entry", () => {
    const nav = HOTKEY_MAP.filter((h) => h.section === "Navigation");
    expect(nav.length).toBeGreaterThan(0);
  });
});
