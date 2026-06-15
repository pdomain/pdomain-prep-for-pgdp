/**
 * Tests for SettingsPage — hi-fi P3-3 redesign.
 *
 * Covers:
 * - "Settings" heading renders via PageHeader.
 * - FieldSet group titles render (Image processing, OCR, Layout detector, Text post-processing).
 * - Save button is present.
 * - Loading state shows loading text when data has not yet loaded.
 * - Grayscale form initialises from persisted app-wide config (Task 4.3 fix).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { SettingsPage } from "./SettingsPage";
import { GRAYSCALE_CONFIG_DEFAULTS } from "./pipeline/tools/grayscale/grayscaleConfig";

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockDefaults = {
  text_threshold: 140,
  page_h_w_ratio: 1.65,
  default_fuzzy_pct: 0.02,
  default_pixel_count_columns: 150,
  default_pixel_count_rows: 75,
  ocr_engine: "doctr",
  ocr_model_key: null,
  ocr_dpi: 150,
  ocr_bbox_edge_min_words: 5,
  layout_detector: "pp-doclayout-plus-l",
  layout_detector_confidence: 0.5,
  layout_checkpoint: null,
  standard_scannos: { tbe: "the" },
  hyphenation_join_list: ["pre"],
};

describe("SettingsPage", () => {
  it("renders the Settings heading", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    expect(
      await screen.findByRole("heading", { name: /settings/i }),
    ).toBeInTheDocument();
  });

  it("renders FieldSet group title: Image processing", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByText("Image processing")).toBeInTheDocument(),
    );
  });

  it("renders FieldSet group title: OCR", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(screen.getByText("OCR")).toBeInTheDocument());
  });

  it("renders FieldSet group title: Layout detector", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByText("Layout detector")).toBeInTheDocument(),
    );
  });

  it("renders FieldSet group title: Text post-processing", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByText("Text post-processing")).toBeInTheDocument(),
    );
  });

  it("renders the Save defaults button", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /save defaults/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows loading text while data is pending", () => {
    // Never resolve: loading state persists
    server.use(
      http.get("/api/data/system/defaults", () => new Promise(() => {})),
    );
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders OCR engine Radix Select with trigger button", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() => {
      // Find by aria-label which is set on the SelectTrigger
      const trigger = document.querySelector('button[aria-label="Engine"]')!;
      expect(trigger).toBeInTheDocument();
    });
  });

  it("shows current OCR engine value in trigger", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() => {
      // Find the button with aria-label "Engine"
      const trigger = document.querySelector('button[aria-label="Engine"]')!;
      expect(trigger).toBeInTheDocument();
      // The trigger should display the current value (doctr)
      expect(trigger.textContent).toContain("doctr");
    });
  });

  it("renders layout detector Radix Select with trigger button", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() => {
      // Find by aria-label which is set on the SelectTrigger
      const trigger = document.querySelector('button[aria-label="Detector"]')!;
      expect(trigger).toBeInTheDocument();
    });
  });

  it("shows current layout detector value in trigger", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() => {
      // Find the button with aria-label "Detector"
      const trigger = document.querySelector('button[aria-label="Detector"]')!;
      expect(trigger).toBeInTheDocument();
      expect(trigger.textContent).toContain("pp-doclayout-plus-l");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4.3 fix — grayscale form loads persisted app-wide config on mount
// ─────────────────────────────────────────────────────────────────────────────

describe("SettingsPage — grayscale all-tier form load", () => {
  /**
   * Helper: mock GrayscaleConfig returned by GET /api/data/settings/stages/grayscale.
   * Returns a config with converter=best_channel and flatten.enabled=true so we can
   * distinguish it from GRAYSCALE_CONFIG_DEFAULTS (converter=luma, flatten.enabled=false).
   */
  const savedGrayscaleConfig = {
    ...GRAYSCALE_CONFIG_DEFAULTS,
    converter: "best_channel",
    flatten: { ...GRAYSCALE_CONFIG_DEFAULTS.flatten, enabled: true },
  };

  function withBothDefaults() {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
      http.get("/api/data/settings/stages/grayscale", () =>
        HttpResponse.json(savedGrayscaleConfig),
      ),
    );
  }

  it("grayscale converter select reflects the SAVED value, not spec defaults", async () => {
    withBothDefaults();
    renderWithProviders(<SettingsPage />);
    // Wait for the page to finish loading (grayscale section is in a FieldSet that
    // appears after the system-defaults query resolves).
    await waitFor(() =>
      expect(screen.getByText("Grayscale stage defaults")).toBeInTheDocument(),
    );
    // The converter select must show the saved value (best_channel), not the
    // spec default (luma).
    const sel = screen.getByTestId<HTMLSelectElement>(
      "settings-all-grayscale-converter",
    );
    await waitFor(() => {
      expect(sel.value).toBe("best_channel");
    });
  });

  it("grayscale converter select shows spec defaults when nothing is saved", async () => {
    server.use(
      http.get("/api/data/system/defaults", () =>
        HttpResponse.json(mockDefaults),
      ),
      // GET returns {} (nothing saved) — the default handler in handlers.ts
      // already returns {} but we override explicitly to be clear.
      http.get("/api/data/settings/stages/grayscale", () =>
        HttpResponse.json({}),
      ),
    );
    renderWithProviders(<SettingsPage />);
    await waitFor(() =>
      expect(screen.getByText("Grayscale stage defaults")).toBeInTheDocument(),
    );
    const sel = screen.getByTestId<HTMLSelectElement>(
      "settings-all-grayscale-converter",
    );
    // An empty response should fall back to GRAYSCALE_CONFIG_DEFAULTS.converter = "luma"
    await waitFor(() => {
      expect(sel.value).toBe(GRAYSCALE_CONFIG_DEFAULTS.converter);
    });
  });
});
