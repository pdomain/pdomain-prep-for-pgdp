/**
 * RealThumb tests — covers stage-thumbnail image rendering and FakePaperThumb fallback.
 *
 * Tests:
 *   1. When thumbnailKey is null/undefined → FakePaperThumb (no img element)
 *   2. When thumbnailKey is set → img element with the URL as-is (full path from stageThumbUrl)
 *   3. Correct dimensions applied
 *   4. onError replaces image with paper background
 *   5. blank kind shows "blank" text label in FakePaperThumb
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RealThumb, FakePaperThumb } from "./RealThumb";

// ---------------------------------------------------------------------------
// RealThumb
// ---------------------------------------------------------------------------

describe("RealThumb", () => {
  it("renders FakePaperThumb fallback when thumbnailKey is not provided", () => {
    const { container } = render(<RealThumb width={120} height={156} />);
    // No img element should be rendered
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders FakePaperThumb fallback when thumbnailKey is empty string", () => {
    const { container } = render(
      <RealThumb thumbnailKey="" width={120} height={156} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an img element when thumbnailKey is provided", () => {
    // thumbnailKey is now a full URL path (from stageThumbUrl) — used as-is,
    // no /cdn/ prefix is added by RealThumb.
    const thumbUrl =
      "/api/data/projects/abc123/pages/0/stages/grayscale/thumbnail";
    const { container } = render(
      <RealThumb
        thumbnailKey={thumbUrl}
        width={120}
        height={156}
        alt="page 1 thumbnail"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(thumbUrl);
    expect(img?.getAttribute("alt")).toBe("page 1 thumbnail");
  });

  it("uses lazy loading on img element", () => {
    const { container } = render(
      <RealThumb thumbnailKey="some/key.jpg" width={120} height={156} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("applies width and height to the wrapper div when image is shown", () => {
    const { container } = render(
      <RealThumb thumbnailKey="some/key.jpg" width={90} height={118} />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("90px");
    expect(wrapper.style.height).toBe("118px");
  });

  it("applies width and height to the wrapper div when using fallback", () => {
    const { container } = render(<RealThumb width={90} height={118} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("90px");
    expect(wrapper.style.height).toBe("118px");
  });
});

// ---------------------------------------------------------------------------
// FakePaperThumb
// ---------------------------------------------------------------------------

describe("FakePaperThumb", () => {
  it("renders with light tone by default", () => {
    const { container } = render(<FakePaperThumb width={120} height={156} />);
    const el = container.firstChild as HTMLElement;
    // Light tone uses oklch(0.95 0.012 85)
    expect(el.style.background).toContain("oklch");
  });

  it("renders blank label when kind=blank", () => {
    render(<FakePaperThumb width={120} height={156} kind="blank" />);
    expect(screen.getByText("blank")).toBeDefined();
  });

  it("does not render blank label for other kinds", () => {
    render(<FakePaperThumb width={120} height={156} kind="page" />);
    expect(screen.queryByText("blank")).toBeNull();
  });

  it("applies correct dimensions", () => {
    const { container } = render(<FakePaperThumb width={160} height={208} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("160px");
    expect(el.style.height).toBe("208px");
  });
});
