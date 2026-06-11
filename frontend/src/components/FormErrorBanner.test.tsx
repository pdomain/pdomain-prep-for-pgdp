/**
 * Tests for FormErrorBanner — side-effect-only component that fires a sonner
 * `toast.error(...)` whenever its `error` prop transitions from null/undefined
 * to a real Error.
 *
 * §13a step 2 (sonner): the inline `<span role="alert">` body retired in
 * favor of a global toast surface. The component exists so call sites (e.g.
 * the ProjectListPage create-modal error branch) can stay declarative —
 * they pass an error and the banner deals with the toast plumbing.
 *
 * Contract:
 *   - Renders nothing (returns null) — confirms the toast is the only UX surface.
 *   - When `error` becomes a real Error, calls `toast.error("${prefix}: ${msg}")`.
 *   - Null/undefined errors do NOT fire a toast.
 *   - The toast fires once per distinct Error instance — re-renders with the
 *     same Error reference do not re-toast (mutations don't typically reuse
 *     Error instances, but the dedupe guards strict-mode double-render).
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormErrorBanner } from "./FormErrorBanner";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { toast } from "sonner";

describe("FormErrorBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing (toast is the only surface)", () => {
    const { container } = render(
      <FormErrorBanner prefix="save failed" error={new Error("boom")} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not fire a toast when error is null", () => {
    render(<FormErrorBanner prefix="save failed" error={null} />);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not fire a toast when error is undefined", () => {
    render(<FormErrorBanner prefix="save failed" error={undefined} />);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("fires toast.error with `${prefix}: ${message}` when an Error is passed", () => {
    render(<FormErrorBanner prefix="save failed" error={new Error("boom")} />);
    expect(toast.error).toHaveBeenCalledWith("save failed: boom");
  });

  it("does not re-fire on re-render with the same Error reference", () => {
    const err = new Error("same");
    const { rerender } = render(
      <FormErrorBanner prefix="ocr failed" error={err} />,
    );
    rerender(<FormErrorBanner prefix="ocr failed" error={err} />);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("fires again when a new Error instance arrives", () => {
    const { rerender } = render(
      <FormErrorBanner prefix="delete failed" error={new Error("first")} />,
    );
    rerender(
      <FormErrorBanner prefix="delete failed" error={new Error("second")} />,
    );
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenLastCalledWith("delete failed: second");
  });
});
