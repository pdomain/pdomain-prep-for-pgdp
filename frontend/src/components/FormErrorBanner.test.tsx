/**
 * Tests for FormErrorBanner — small inline error-message component that
 * consolidates the duplicated `<span class="text-xs text-red-600">…</span>`
 * sites in TextReviewPage (save / re-OCR / delete-words mutation errors).
 *
 * This is the §13a stepping-stone before the sonner/toast swap: keep the
 * visual + a11y contract identical, just behind a single component so the
 * later swap is one edit, not three.
 *
 * Contract:
 *   - Renders nothing (returns null) when `error` is null/undefined.
 *   - When an Error is passed, renders a single element containing
 *     `${prefix}: ${error.message}`.
 *   - Has role="alert" so AT users get the failure announced.
 *   - Carries the existing tailwind classes so visual regression is nil.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormErrorBanner } from "./FormErrorBanner";

describe("FormErrorBanner", () => {
  it("renders nothing when error is null", () => {
    const { container } = render(
      <FormErrorBanner prefix="save failed" error={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when error is undefined", () => {
    const { container } = render(
      <FormErrorBanner prefix="save failed" error={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders prefix + message when error is an Error", () => {
    render(<FormErrorBanner prefix="save failed" error={new Error("boom")} />);
    expect(screen.getByText("save failed: boom")).toBeInTheDocument();
  });

  it("exposes role=alert so screen readers announce the failure", () => {
    render(<FormErrorBanner prefix="ocr failed" error={new Error("nope")} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("ocr failed: nope");
  });

  it("preserves the existing tailwind error styling classes", () => {
    render(<FormErrorBanner prefix="delete failed" error={new Error("x")} />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("text-xs");
    expect(alert.className).toContain("text-red-600");
  });
});
