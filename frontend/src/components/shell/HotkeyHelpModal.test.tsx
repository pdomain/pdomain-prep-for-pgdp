import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HotkeyHelpModal } from "./HotkeyHelpModal";
import { HOTKEY_MAP } from "../../lib/hotkeyMap";

describe("HotkeyHelpModal", () => {
  it("renders title when open", () => {
    render(<HotkeyHelpModal open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("every registered key description appears", () => {
    render(<HotkeyHelpModal open onClose={() => {}} />);
    for (const entry of HOTKEY_MAP) {
      expect(screen.getByText(entry.description)).toBeInTheDocument();
    }
  });

  it("every registered key cap appears", () => {
    render(<HotkeyHelpModal open onClose={() => {}} />);
    const allKeys = HOTKEY_MAP.flatMap((e) => e.keys);
    for (const k of allKeys) {
      // Keys may appear multiple times if duplicated; just check presence
      expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    }
  });

  it("calls onClose when dialog is dismissed", async () => {
    const onClose = vi.fn();
    render(<HotkeyHelpModal open onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
