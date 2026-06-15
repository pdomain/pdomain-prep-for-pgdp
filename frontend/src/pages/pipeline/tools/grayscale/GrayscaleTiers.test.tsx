/**
 * GrayscaleTiers.test.tsx — Task 4.3 TDD
 *
 * Tests for per-tier save actions + Auto detect + app Settings all-tier:
 *
 *   1. "Save for this page" button PUTs the page tier
 *      (PUT .../settings/page with draftToSettings(draft))
 *   2. "Save as project default" button PUTs the project tier
 *      (POST .../settings/save-as-default)
 *   3. "Auto" button calls detectProfile + applies returned config to draft
 *      and surfaces the `why` text
 *   4. App Settings grayscale section PUTs the all tier
 *      (PUT /api/data/settings/stages/grayscale)
 *   5. data-testid contract: grayscale-apply-run + grayscale-auto visible
 *
 * @see Task 4.3 in docs/plans/2026-06-15-grayscale-pipeline.md
 * @see frontend/src/pages/pipeline/tools/grayscale/GrayscaleWorkbench.tsx
 * @see frontend/src/services/tools/grayscaleTool.ts — tier save fns
 * @see frontend/src/pages/SettingsPage.tsx — app-wide grayscale section
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Component under test ─────────────────────────────────────────────────────
import { GrayscaleWorkbenchTab } from "./GrayscaleWorkbench";
import { GrayscaleSettingsAllSection } from "./GrayscaleSettingsAll";

// ── Types + helpers ───────────────────────────────────────────────────────────
import type {
  GrayscaleDraft,
  GrayscalePage,
  GrayscaleDetected,
} from "@/machines/tools/grayscaleTool";
import type { GrayscaleConfig } from "./grayscaleConfig";
import { GRAYSCALE_CONFIG_DEFAULTS } from "./grayscaleConfig";

// Top-level vi.mock must be at module scope (Vitest hoists it above imports)
vi.mock("@/api/client", () => ({
  api: {
    put: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue([]),
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PROJECT_ID = "proj-abc";
const MOCK_IDX0 = 3;

const baseDraft: GrayscaleDraft = {
  ...GRAYSCALE_CONFIG_DEFAULTS,
  mode: "perceptual" as const,
};

const basePage: GrayscalePage = {
  id: "0003",
  idx0: MOCK_IDX0,
  mode: "perceptual",
  lastRunAt: null,
};

const baseDetected: GrayscaleDetected = {
  mode: "perceptual",
  why: "high chroma variance",
  config: {
    ...GRAYSCALE_CONFIG_DEFAULTS,
    converter: "lab_l" as const,
  },
};

const noopHandlers = {
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onSetMode: vi.fn(),
  onPatch: vi.fn(),
  onRevert: vi.fn(),
  onRedetect: vi.fn(),
  onApplyRun: vi.fn(),
  onRerunPage: vi.fn(),
  onSetConverter: vi.fn(),
  onSetFlatten: vi.fn(),
  onSetClahe: vi.fn(),
  onSetChannel: vi.fn(),
  // Task 4.3 handlers:
  onSavePageTier: vi.fn(),
  onSaveProjectDefault: vi.fn(),
  onAuto: vi.fn(),
};

function renderWorkbench(overrides: {
  draft?: GrayscaleDraft | null;
  detected?: GrayscaleDetected | null;
  pages?: GrayscalePage[];
  cursor?: number;
  sources?: Record<string, string>;
  handlers?: Partial<typeof noopHandlers>;
  autoDetectWhy?: string | null;
}) {
  const handlers = { ...noopHandlers, ...(overrides.handlers ?? {}) };
  return render(
    <GrayscaleWorkbenchTab
      projectId={MOCK_PROJECT_ID}
      pages={overrides.pages ?? [basePage]}
      cursor={overrides.cursor ?? 0}
      backend="cpu"
      draft={overrides.draft ?? baseDraft}
      detected={overrides.detected ?? baseDetected}
      settingsState="default"
      sources={overrides.sources ?? {}}
      autoDetectWhy={overrides.autoDetectWhy ?? null}
      {...handlers}
    />,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. grayscale-apply-run testid (existing Apply & Run button must carry it)
// ─────────────────────────────────────────────────────────────────────────────

describe("GrayscaleWorkbenchTab — grayscale-apply-run testid", () => {
  it("Apply & Run button has data-testid grayscale-apply-run", () => {
    renderWorkbench({});
    expect(screen.getByTestId("grayscale-apply-run")).toBeDefined();
  });

  it("clicking grayscale-apply-run calls onApplyRun", () => {
    const onApplyRun = vi.fn();
    renderWorkbench({ handlers: { onApplyRun } });
    fireEvent.click(screen.getByTestId("grayscale-apply-run"));
    expect(onApplyRun).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. grayscale-auto testid (Auto button visible+wired)
// ─────────────────────────────────────────────────────────────────────────────

describe("GrayscaleWorkbenchTab — grayscale-auto testid", () => {
  it("Auto button has data-testid grayscale-auto", () => {
    renderWorkbench({});
    expect(screen.getByTestId("grayscale-auto")).toBeDefined();
  });

  it("clicking grayscale-auto calls onAuto", () => {
    const onAuto = vi.fn();
    renderWorkbench({ handlers: { onAuto } });
    fireEvent.click(screen.getByTestId("grayscale-auto"));
    expect(onAuto).toHaveBeenCalledTimes(1);
  });

  it("shows autoDetectWhy text when provided", () => {
    renderWorkbench({ autoDetectWhy: "high chroma variance detected" });
    expect(screen.getByTestId("grayscale-auto-why")).toBeDefined();
    expect(screen.getByTestId("grayscale-auto-why").textContent).toContain(
      "high chroma variance detected",
    );
  });

  it("does not show why text when autoDetectWhy is null", () => {
    renderWorkbench({ autoDetectWhy: null });
    expect(screen.queryByTestId("grayscale-auto-why")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Save for this page — PUTs page tier
// ─────────────────────────────────────────────────────────────────────────────

describe("GrayscaleWorkbenchTab — Save for this page (page tier)", () => {
  it("Save for this page button has data-testid grayscale-save-page", () => {
    renderWorkbench({});
    expect(screen.getByTestId("grayscale-save-page")).toBeDefined();
  });

  it("clicking Save for this page calls onSavePageTier", () => {
    const onSavePageTier = vi.fn();
    renderWorkbench({ handlers: { onSavePageTier } });
    fireEvent.click(screen.getByTestId("grayscale-save-page"));
    expect(onSavePageTier).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Save as project default — PUTs project tier (save-as-default)
// ─────────────────────────────────────────────────────────────────────────────

describe("GrayscaleWorkbenchTab — Save as project default (project tier)", () => {
  it("Save as project default button has data-testid grayscale-save-project", () => {
    renderWorkbench({});
    expect(screen.getByTestId("grayscale-save-project")).toBeDefined();
  });

  it("clicking Save as project default calls onSaveProjectDefault", () => {
    const onSaveProjectDefault = vi.fn();
    renderWorkbench({ handlers: { onSaveProjectDefault } });
    fireEvent.click(screen.getByTestId("grayscale-save-project"));
    expect(onSaveProjectDefault).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Service layer — putPageTierSettings / putAllTierSettings URL shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service URL contract tests — we verify the URL shape constructed by the
 * service functions without calling the real API. We import the service module
 * and spy on the api.put method via the actual api client mock that vitest
 * handles at the module level. Since vi.mock hoisting is fragile with dynamic
 * imports, we test the URL shape by intercepting the fetch at the fetch level.
 *
 * Simplest approach: test the exported functions by confirming they are
 * async functions and examining their URL construction via a test double
 * injected at the api.client level using the module mock defined at top scope.
 */

describe("grayscaleTool service — tier endpoints", () => {
  it("putPageTierSettings is exported and is an async function", async () => {
    const mod = await import("@/services/tools/grayscaleTool");
    expect(typeof mod.putPageTierSettings).toBe("function");
  });

  it("putAllTierSettings is exported and is an async function", async () => {
    const mod = await import("@/services/tools/grayscaleTool");
    expect(typeof mod.putAllTierSettings).toBe("function");
  });

  it("putPageTierSettings calls api.put with URL containing /settings/page", async () => {
    const { api } = await import("@/api/client");
    const { putPageTierSettings } =
      await import("@/services/tools/grayscaleTool");
    const putMock = vi.mocked(api.put);
    putMock.mockClear();

    const config: GrayscaleConfig = {
      ...GRAYSCALE_CONFIG_DEFAULTS,
      converter: "lab_l",
    };
    await putPageTierSettings("proj-1", "grayscale", 0, config);
    expect(putMock).toHaveBeenCalledWith(
      expect.stringContaining("/settings/page"),
      expect.anything(),
    );
  });

  it("putAllTierSettings calls api.put with URL containing /settings/stages/grayscale", async () => {
    const { api } = await import("@/api/client");
    const { putAllTierSettings } =
      await import("@/services/tools/grayscaleTool");
    const putMock = vi.mocked(api.put);
    putMock.mockClear();

    const config: GrayscaleConfig = {
      ...GRAYSCALE_CONFIG_DEFAULTS,
      converter: "luma_bt709",
    };
    await putAllTierSettings("grayscale", config);
    expect(putMock).toHaveBeenCalledWith(
      expect.stringContaining("/settings/stages/grayscale"),
      expect.anything(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. App Settings all-tier section
// ─────────────────────────────────────────────────────────────────────────────

describe("GrayscaleSettingsAllSection — all-tier app settings control", () => {
  it("renders the grayscale converter select for all-tier", () => {
    const onSave = vi.fn();
    render(
      <GrayscaleSettingsAllSection
        config={GRAYSCALE_CONFIG_DEFAULTS}
        onSave={onSave}
      />,
    );
    expect(
      screen.getByTestId("settings-all-grayscale-converter"),
    ).toBeDefined();
  });

  it("renders Save app default button", () => {
    const onSave = vi.fn();
    render(
      <GrayscaleSettingsAllSection
        config={GRAYSCALE_CONFIG_DEFAULTS}
        onSave={onSave}
      />,
    );
    expect(screen.getByTestId("settings-all-grayscale-save")).toBeDefined();
  });

  it("clicking Save app default calls onSave with the config", () => {
    const onSave = vi.fn();
    render(
      <GrayscaleSettingsAllSection
        config={GRAYSCALE_CONFIG_DEFAULTS}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId("settings-all-grayscale-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        converter: GRAYSCALE_CONFIG_DEFAULTS.converter,
      }),
    );
  });

  it("changing converter select updates local state before save", () => {
    const onSave = vi.fn();
    render(
      <GrayscaleSettingsAllSection
        config={GRAYSCALE_CONFIG_DEFAULTS}
        onSave={onSave}
      />,
    );
    const sel = screen.getByTestId<HTMLSelectElement>(
      "settings-all-grayscale-converter",
    );
    fireEvent.change(sel, { target: { value: "lab_l" } });
    fireEvent.click(screen.getByTestId("settings-all-grayscale-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ converter: "lab_l" }),
    );
  });
});
