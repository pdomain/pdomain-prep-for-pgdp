/**
 * TextZonesCanvas.test.tsx — W2.4: the zone and split editors draw on the
 * real page image instead of the schematic placeholders.
 *
 * react-konva is mocked to plain DOM so the overlays can be asserted. Image
 * loading does not happen in jsdom, so the tests check which URL the canvas
 * asks for, not the decoded pixels; the Playwright test covers real pixels.
 */

import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TextZonesTool } from "./TextZonesTool";
import type {
  TextZonesToolServices,
  ZonePageRow,
} from "@/machines/tools/textZonesTool";
import { stubStageSettingsServices } from "@/machines/tools/stageSettings";

vi.mock("react-konva", () => ({
  Stage: ({ children }: { children?: ReactNode }) => (
    <div data-testid="konva-stage">{children}</div>
  ),
  Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Image: () => <div data-testid="konva-image" />,
  Text: ({ text }: { text?: string }) => <span>{text}</span>,
  Line: ({ name }: { name?: string }) => (
    <div data-testid="konva-line" data-name={name} />
  ),
  Rect: ({ name, id }: { name?: string; id?: string }) => (
    <div data-testid="konva-rect" data-name={name} data-id={id} />
  ),
}));

const ROWS: ZonePageRow[] = [
  {
    idx: "0002",
    idx0: 2,
    prefix: "p003",
    state: "reviewed",
    zones: 2,
    _zones: [
      { id: "z1", type: "body", x: 0.1, y: 0.1, w: 0.8, h: 0.3, order: 1 },
      { id: "z2", type: "body", x: 0.1, y: 0.5, w: 0.8, h: 0.3, order: 2 },
    ],
  },
];

function makeServices(
  overrides?: Partial<TextZonesToolServices>,
): TextZonesToolServices {
  return {
    ...stubStageSettingsServices(),
    fetchZonePages: () =>
      Promise.resolve({
        rows: ROWS,
        totals: {
          total: 1,
          done: 1,
          clean: 0,
          flagged: 0,
          reviewed: 1,
          splits: 0,
        },
      }),
    applySplit: vi.fn(() =>
      Promise.resolve({
        parentRow: { idx: "0002", prefix: "0002", state: "split" as const },
        childRows: [
          { idx: "0010", prefix: "p003a", state: "clean" as const },
          { idx: "0011", prefix: "p003b", state: "clean" as const },
        ] as [ZonePageRow, ZonePageRow],
      }),
    ),
    redetectLayout: () => Promise.resolve({ zones: [] }),
    persistLayout: vi.fn(() => Promise.resolve({ ok: true })),
    confirmStage: () => Promise.resolve({ ok: true }),
    ...overrides,
  };
}

function renderTool(services: TextZonesToolServices) {
  return render(
    <MemoryRouter initialEntries={["/projects/proj1/text_zones"]}>
      <Routes>
        <Route
          path="/projects/:projectId/text_zones"
          element={
            <TextZonesTool
              stageId="text_zones"
              runnerRef={{} as never}
              _testServices={services}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function openZoneEditor() {
  await waitFor(() => {
    expect(screen.getAllByTestId("zone-page-card").length).toBe(1);
  });
  fireEvent.click(screen.getAllByTestId("zone-page-card")[0]!);
  await waitFor(() => {
    expect(screen.getByTestId("zone-editor-panel")).toBeInTheDocument();
  });
}

describe("TextZonesTool — page imagery (W2.4)", () => {
  it("page cards show the page's ingest thumbnail", async () => {
    renderTool(makeServices());
    await waitFor(() => {
      expect(screen.getByTestId("zone-card-image")).toHaveAttribute(
        "src",
        "/api/data/projects/proj1/pages/2/thumbnail",
      );
    });
  });

  it("the zone editor draws stored zones over the deskewed page image", async () => {
    renderTool(makeServices());
    await openZoneEditor();

    const canvas = screen.getByTestId("zone-canvas");
    expect(canvas).toHaveAttribute(
      "data-image-src",
      "/api/data/projects/proj1/pages/2/stages/post_transform_crop/artifact",
    );
    expect(screen.queryByText(/I1: Konva/)).toBeNull();
    const zoneRects = screen
      .getAllByTestId("konva-rect")
      .filter((r) => r.getAttribute("data-name") === "zone");
    expect(zoneRects.map((r) => r.getAttribute("data-id"))).toEqual([
      "z1",
      "z2",
    ]);
    expect(canvas).toHaveAttribute("data-zone-count", "2");
  });

  it("deleting a zone from the list removes it from the canvas", async () => {
    renderTool(makeServices());
    await openZoneEditor();

    fireEvent.click(screen.getByTestId("zone-delete-z1"));

    expect(screen.getByTestId("zone-canvas")).toHaveAttribute(
      "data-zone-count",
      "1",
    );
    expect(screen.queryByTestId("zone-list-item-z1")).toBeNull();
    expect(screen.getByTestId("zone-list-item-z2")).toBeInTheDocument();
  });

  it("Save layout sends the edited zones to the server", async () => {
    const services = makeServices();
    renderTool(services);
    await openZoneEditor();

    fireEvent.click(screen.getByTestId("zone-delete-z1"));
    fireEvent.click(screen.getByTestId("zone-editor-save"));

    await waitFor(() => {
      expect(screen.queryByTestId("zone-editor-panel")).toBeNull();
    });
    expect(services.persistLayout).toHaveBeenCalledWith("proj1", "0002", {
      zones: [
        { id: "z2", type: "body", x: 0.1, y: 0.5, w: 0.8, h: 0.3, order: 2 },
      ],
    });
  });
});

describe("TextZonesTool — split editor on the page image (W2.4)", () => {
  async function openSplitEditor() {
    await openZoneEditor();
    fireEvent.click(screen.getByTestId("zone-editor-split"));
    await waitFor(() => {
      expect(screen.getByTestId("split-editor-panel")).toBeInTheDocument();
    });
  }

  it("the zone editor opens the split editor for the same page", async () => {
    renderTool(makeServices());
    await openSplitEditor();

    const preview = screen.getByTestId("split-preview-canvas");
    expect(preview).toHaveAttribute(
      "data-image-src",
      "/api/data/projects/proj1/pages/2/thumbnail",
    );
    expect(preview).toHaveAttribute("data-axis", "col");
    expect(preview).toHaveAttribute("data-gutter", "0.5");
    expect(screen.queryByText(/I1: Konva/)).toBeNull();
    expect(
      screen
        .getAllByTestId("konva-line")
        .some((l) => l.getAttribute("data-name") === "gutter"),
    ).toBe(true);
  });

  it("the gutter slider and axis buttons move the split", async () => {
    renderTool(makeServices());
    await openSplitEditor();

    fireEvent.change(screen.getByTestId("split-gutter-slider"), {
      target: { value: "38" },
    });
    fireEvent.click(screen.getByTestId("split-axis-row"));

    const preview = screen.getByTestId("split-preview-canvas");
    expect(preview).toHaveAttribute("data-gutter", "0.38");
    expect(preview).toHaveAttribute("data-axis", "row");
    expect(screen.getByTestId("split-child-a")).toHaveTextContent("p003a");
    expect(screen.getByTestId("split-child-b")).toHaveTextContent("p003b");
  });

  it("Apply split sends the tuned gutter", async () => {
    const services = makeServices();
    renderTool(services);
    await openSplitEditor();

    fireEvent.change(screen.getByTestId("split-gutter-slider"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByTestId("split-editor-apply"));

    await waitFor(() => {
      expect(services.applySplit).toHaveBeenCalledWith(
        "proj1",
        "0002",
        expect.objectContaining({ axis: "col", gutter: 0.42 }),
      );
    });
    // The parent keeps its display name; the children follow it.
    await waitFor(() => {
      expect(screen.getAllByTestId("zone-page-card")).toHaveLength(3);
    });
    expect(
      screen.getAllByTestId("zone-page-card").map((c) => c.textContent),
    ).toEqual([
      expect.stringContaining("p003"),
      expect.stringContaining("p003a"),
      expect.stringContaining("p003b"),
    ]);
    expect(screen.getAllByTestId("zone-page-card")[0]).toHaveAttribute(
      "data-state",
      "split",
    );
  });
});
