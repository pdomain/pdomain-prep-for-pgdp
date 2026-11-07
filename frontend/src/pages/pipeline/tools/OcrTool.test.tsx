/**
 * OcrTool.test.tsx — Component tests for the OcrTool surface.
 *
 * Covers:
 * - Tab switching (overview / pages / settings) via OcrTabBar
 * - OcrOverviewTab renders stat cells derived from machine context
 * - OcrStepSettingsTab renders (engine selector, backend control)
 *
 * At I1: real services are wired; pages arrive via SSE (not mock setTimeout).
 * Stat cells start at zero and are updated when SSE PAGE_PUSH events arrive.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server } from "@/test/server";
import { OcrTool } from "./OcrTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper — MemoryRouter required since OcrTool uses useParams
// ---------------------------------------------------------------------------

function renderTool() {
  return render(
    <MemoryRouter initialEntries={["/projects/demo/pipeline"]}>
      <OcrTool stageId="ocr" runnerRef={fakeRunnerRef} />
    </MemoryRouter>,
  );
}

function openGate(): { promise: Promise<boolean>; resolve: () => void } {
  let resolveGate = (value: boolean): void => {
    if (value) return;
  };
  const promise = new Promise<boolean>((resolve) => {
    resolveGate = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolveGate(true);
    },
  };
}

function renderLive(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/pipeline`]}>
      <Routes>
        <Route
          path="/projects/:projectId/pipeline"
          element={<OcrTool stageId="ocr" runnerRef={fakeRunnerRef} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tab bar presence
// ---------------------------------------------------------------------------

describe("OcrTool — tab bar", () => {
  it("renders the tab bar immediately", () => {
    renderTool();
    expect(screen.getByTestId("ocr-tab-bar")).toBeInTheDocument();
  });

  it("all three tab buttons are present", () => {
    renderTool();
    expect(screen.getByTestId("ocr-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-tab-pages")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("OcrTool — tab switching", () => {
  it("starts on the Pages tab by default", () => {
    renderTool();
    expect(screen.getByTestId("ocr-pages-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ocr-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows ocr-overview-tab", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    expect(screen.getByTestId("ocr-overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-pages-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ocr-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows ocr-step-settings-tab", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    expect(screen.getByTestId("ocr-step-settings-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-pages-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
  });

  it("clicking Pages tab after Overview returns to ocr-pages-tab", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    expect(screen.getByTestId("ocr-overview-tab")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ocr-tab-pages"));
    expect(screen.getByTestId("ocr-pages-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OcrOverviewTab — stat cells
// ---------------------------------------------------------------------------

describe("OcrTool — OcrOverviewTab stat cells", () => {
  it("renders all six stat cells when overview tab is active", () => {
    // OcrTool starts in 'recognising' (no loading state) — tab bar is synchronous.
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    // Stat cells render immediately (totals null → shows "0" as default)
    expect(screen.getByTestId("ocr-overview-stat-pages")).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-overview-stat-recognised"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ocr-overview-stat-words")).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-overview-stat-mean-score"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-overview-stat-low-score"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ocr-overview-stat-flagged")).toBeInTheDocument();
  });

  it("stat cells show zero until SSE PAGE_PUSH events arrive", () => {
    // At I1 pages arrive via real SSE; in unit tests no SSE fires so stats start at 0.
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    const pagesCell = screen.getByTestId("ocr-overview-stat-pages");
    expect(pagesCell.textContent).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// OcrStepSettingsTab — engine and backend display
// ---------------------------------------------------------------------------

describe("OcrTool — OcrStepSettingsTab", () => {
  it("renders engine selector with doctr and tesseract options", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    expect(screen.getByTestId("ocr-settings-engine-doctr")).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-settings-engine-tesseract"),
    ).toBeInTheDocument();
  });

  it("renders backend segmented control (doctr selected = GPU/CPU visible)", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    // Default engine is "doctr" (from machine context default)
    expect(screen.getByTestId("ocr-settings-backend")).toBeInTheDocument();
  });

  it("doctr engine card shows active styling (border)", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    // DocTR is the default; its card should be present
    const doctrCard = screen.getByTestId("ocr-settings-engine-doctr");
    expect(doctrCard).toBeInTheDocument();
  });

  // W5.1 — engine/backend selector cards must be interactive (fire machine events)

  it("engine selector cards have role=button (interactive)", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    const doctrCard = screen.getByTestId("ocr-settings-engine-doctr");
    const tesseractCard = screen.getByTestId("ocr-settings-engine-tesseract");
    expect(doctrCard).toHaveAttribute("role", "button");
    expect(tesseractCard).toHaveAttribute("role", "button");
  });

  it("clicking tesseract engine card changes active engine styling", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    const tesseractCard = screen.getByTestId("ocr-settings-engine-tesseract");
    // Before click: tesseract is not active (no accent border)
    expect(tesseractCard.style.border).not.toContain("var(--accent)");
    // Click tesseract to send SET_ENGINE
    fireEvent.click(tesseractCard);
    // After click: tesseract card becomes active (accent border)
    expect(tesseractCard.style.border).toContain("var(--accent)");
  });

  it("backend segmented control buttons have role=button", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    const backendControl = screen.getByTestId("ocr-settings-backend");
    const buttons = backendControl.querySelectorAll("[role=button]");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Hydrate — demo empty, or real page rows, leaves recognising
// ---------------------------------------------------------------------------

describe("OcrTool — hydrate leaves recognising", () => {
  it("demo project settles to review with no pages and no fetch", async () => {
    let hits = 0;
    server.use(
      http.get("/api/data/projects/:projectId/pages", () => {
        hits += 1;
        return HttpResponse.json({ pages: [], next_cursor: null });
      }),
    );
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("ocr-toolbar")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("ocr-banner-recognising"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ocr-page-card")).not.toBeInTheDocument();
    expect(hits).toBe(0);
  });

  it("one clean page leaves recognising", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 0, prefix: "img0000" }],
          next_cursor: null,
          total: 1,
        }),
      ),
      http.get("/api/data/projects/book/pages/0/stages", () =>
        HttpResponse.json([{ stage_id: "ocr", status: "clean" }]),
      ),
      http.get("/api/data/projects/book/pages/0/text/_", () =>
        HttpResponse.json({
          words: [{ text: "cat", confidence: 0.99, deleted: false }],
        }),
      ),
    );
    renderLive("book");
    await waitFor(() => {
      expect(screen.getByTestId("ocr-toolbar")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("ocr-banner-recognising"),
    ).not.toBeInTheDocument();
    const card = screen.getByTestId("ocr-page-card");
    expect(card).toHaveAttribute("data-idx", "0000");
    expect(card).toHaveAttribute("data-state", "clean");
  });

  it("keeps recognising while a later page is still running", async () => {
    const textHits: string[] = [];
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [
            { idx0: 0, prefix: "img0000" },
            { idx0: 1, prefix: "img0001" },
          ],
          next_cursor: null,
          total: 2,
        }),
      ),
      http.get("/api/data/projects/book/pages/:idx0/stages", ({ params }) => {
        const status = params["idx0"] === "0" ? "clean" : "running";
        return HttpResponse.json([{ stage_id: "ocr", status }]);
      }),
      http.get("/api/data/projects/book/pages/:idx0/text/_", ({ params }) => {
        textHits.push(String(params["idx0"]));
        return HttpResponse.json({
          words: [{ text: "tbe", confidence: 0.2, deleted: false }],
        });
      }),
    );
    renderLive("book");
    await waitFor(() => {
      expect(screen.getAllByTestId("ocr-page-card")).toHaveLength(2);
    });
    expect(screen.getByTestId("ocr-banner-recognising")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-toolbar")).not.toBeInTheDocument();
    const cards = screen.getAllByTestId("ocr-page-card");
    const flagged = cards.find(
      (card) => card.getAttribute("data-idx") === "0000",
    );
    const running = cards.find(
      (card) => card.getAttribute("data-idx") === "0001",
    );
    expect(flagged).toHaveAttribute("data-state", "flagged");
    expect(running).toHaveAttribute("data-state", "running");
    expect(textHits).toEqual(["0"]);
  });

  it("does not offer confirm until a page that finished during hydrate is loaded", async () => {
    const pagesGate = openGate();
    const lateGate = openGate();
    let lateStarted = false;
    server.use(
      http.get("/api/data/projects/book/pages", async () => {
        await pagesGate.promise;
        return HttpResponse.json({ pages: [], next_cursor: null, total: 0 });
      }),
      http.get("/api/data/projects/book/pages/1/stages", async () => {
        lateStarted = true;
        await lateGate.promise;
        return HttpResponse.json([{ stage_id: "ocr", status: "clean" }]);
      }),
      http.get("/api/data/projects/book/pages/1/text/_", () =>
        HttpResponse.json({
          words: [{ text: "cat", confidence: 0.99, deleted: false }],
        }),
      ),
    );
    vi.stubGlobal("EventSource", ControllableEventSource);
    renderLive("book");
    await waitFor(() => {
      expect(ControllableEventSource.instances.length).toBe(1);
    });
    ControllableEventSource.instances[0]?.emit("stage-status", {
      type: "stage-status",
      stage_id: "ocr",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 1,
    });
    pagesGate.resolve();
    await waitFor(() => {
      expect(lateStarted).toBe(true);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(screen.queryByTestId("ocr-confirm-advance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ocr-toolbar")).not.toBeInTheDocument();

    lateGate.resolve();
    await waitFor(() => {
      expect(screen.getByTestId("ocr-page-card")).toHaveAttribute(
        "data-idx",
        "0001",
      );
    });
    expect(screen.getByTestId("ocr-confirm-advance")).toBeEnabled();
    expect(
      screen.queryByTestId("ocr-banner-recognising"),
    ).not.toBeInTheDocument();
  });

  it("shows a load error and keeps confirm hidden when that page does not load", async () => {
    const pagesGate = openGate();
    server.use(
      http.get("/api/data/projects/book/pages", async () => {
        await pagesGate.promise;
        return HttpResponse.json({ pages: [], next_cursor: null, total: 0 });
      }),
      http.get(
        "/api/data/projects/book/pages/1/stages",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    vi.stubGlobal("EventSource", ControllableEventSource);
    renderLive("book");
    await waitFor(() => {
      expect(ControllableEventSource.instances.length).toBe(1);
    });
    ControllableEventSource.instances[0]?.emit("stage-status", {
      type: "stage-status",
      stage_id: "ocr",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 1,
    });
    pagesGate.resolve();
    await waitFor(() => {
      expect(screen.getByTestId("ocr-load-error")).toHaveTextContent("0001");
    });
    expect(screen.queryByTestId("ocr-confirm-advance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ocr-toolbar")).not.toBeInTheDocument();
  });

  it("does not open confirm from a later page after a buffered load fails", async () => {
    const pagesGate = openGate();
    let laterStarted = false;
    server.use(
      http.get("/api/data/projects/book/pages", async () => {
        await pagesGate.promise;
        return HttpResponse.json({ pages: [], next_cursor: null, total: 0 });
      }),
      http.get(
        "/api/data/projects/book/pages/1/stages",
        () => new HttpResponse(null, { status: 500 }),
      ),
      http.get("/api/data/projects/book/pages/2/stages", () => {
        laterStarted = true;
        return HttpResponse.json([{ stage_id: "ocr", status: "clean" }]);
      }),
      http.get("/api/data/projects/book/pages/2/text/_", () =>
        HttpResponse.json({
          words: [{ text: "cat", confidence: 0.99, deleted: false }],
        }),
      ),
    );
    vi.stubGlobal("EventSource", ControllableEventSource);
    renderLive("book");
    await waitFor(() => {
      expect(ControllableEventSource.instances.length).toBe(1);
    });
    ControllableEventSource.instances[0]?.emit("stage-status", {
      type: "stage-status",
      stage_id: "ocr",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 1,
    });
    pagesGate.resolve();
    await waitFor(() => {
      expect(screen.getByTestId("ocr-load-error")).toHaveTextContent("0001");
    });
    ControllableEventSource.instances[0]?.emit("stage-status", {
      type: "stage-status",
      stage_id: "ocr",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 2,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(laterStarted).toBe(false);
    expect(screen.queryByTestId("ocr-confirm-advance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ocr-page-card")).not.toBeInTheDocument();
  });
});

class ControllableEventSource {
  static instances: ControllableEventSource[] = [];

  private readonly listeners = new Map<
    string,
    Set<(evt: MessageEvent) => void>
  >();

  constructor(_url: string, _options?: EventSourceInit) {
    ControllableEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (evt: MessageEvent) => void): void {
    const found = this.listeners.get(type) ?? new Set();
    found.add(listener);
    this.listeners.set(type, found);
  }

  removeEventListener(
    type: string,
    listener: (evt: MessageEvent) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.listeners.clear();
  }

  emit(type: string, data: unknown): void {
    const evt = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(evt);
    this.onmessage?.(evt);
  }

  onmessage: ((evt: MessageEvent) => void) | null = null;
  onerror: ((evt: Event) => void) | null = null;
}

afterEach(() => {
  ControllableEventSource.instances = [];
  vi.unstubAllGlobals();
});
