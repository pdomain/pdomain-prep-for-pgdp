/**
 * Tests for the typed toast helper module.
 * Verifies each helper delegates to the correct Sonner function without
 * importing Sonner directly at call-sites.
 *
 * We mock Sonner rather than spy on it because Sonner's `toast` export is
 * non-configurable and cannot be redefined with spyOn.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("sonner", () => {
  const toastFn = Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  });
  return { toast: toastFn };
});

import * as sonner from "sonner";
// Import toast module after mock is set up (hoisted by Vitest anyway)
import { toast } from "./toast";

// Cast to access the mock fn helpers attached in vi.mock above.
// Double-cast via unknown because the Sonner `toast` type and our mock type
// don't share enough surface for a direct assertion.
type MockToast = ReturnType<typeof vi.fn> & {
  success: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
const sonnerToast = sonner.toast as unknown as MockToast;

describe("toast helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toast.info calls sonner toast (default variant)", () => {
    toast.info("hello");
    expect(sonnerToast).toHaveBeenCalledWith("hello");
  });

  it("toast.success calls sonner toast.success", () => {
    toast.success("done");
    expect(sonnerToast.success).toHaveBeenCalledWith("done");
  });

  it("toast.warn calls sonner toast.warning", () => {
    toast.warn("heads up");
    expect(sonnerToast.warning).toHaveBeenCalledWith("heads up");
  });

  it("toast.error calls sonner toast.error", () => {
    toast.error("oops");
    expect(sonnerToast.error).toHaveBeenCalledWith("oops");
  });
});
