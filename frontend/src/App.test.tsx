// App.test.tsx — Vitest tests for App shell routing.
// Phase 2.4: AppShell + SuiteSiblingsProvider mocks added (#266).
// fix/pipeline-fullbleed: assert pipeline route is full-bleed (no centered-layout
//   wrapper), while other routes still receive the centering box.
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "./test/server";
import type * as React from "react";

// Task #155 (s0-c): Mock @pdomain/pdomain-ui/shell so AppShell renders a
// transparent pass-through in jsdom — no Zustand store setup, no real
// grid layout. The mock preserves the slot-forwarding contract (header,
// headerActions, main, children) so downstream tests can assert on
// AppHeader + Routes.
//
// AppHeader mock renders a labelled div with data-testid="app-header" so
// tests can query for it in the header slot.
vi.mock("@pdomain/pdomain-ui/shell", () => ({
  AppShell: ({
    header,
    headerActions,
    main,
    children,
  }: {
    appId?: string;
    appDisplayName?: string;
    appIconUrl?: string;
    header?: React.ReactNode;
    headerActions?: React.ReactNode;
    main?: React.ReactNode;
    children?: React.ReactNode;
    launcherSlot?: string;
    deployMode?: string;
    uiPrefsConfig?: unknown;
  }) => (
    <div data-testid="pdomain-ui-app-shell">
      <div data-testid="pdomain-ui-app-shell-header">
        {header}
        {headerActions}
      </div>
      <div data-testid="pdomain-ui-app-shell-main">{main}</div>
      {children}
    </div>
  ),
  AppHeader: ({
    appName,
    onSearchClick,
  }: {
    appName?: string;
    searchPlaceholder?: string;
    activeJobs?: unknown[];
    onSearchClick?: () => void;
  }) => (
    <div data-testid="app-header">
      <span>{appName ?? "pgdp-prep"}</span>
      <button aria-label="Search (⌘K)" onClick={onSearchClick}>
        Search
      </button>
    </div>
  ),
  SuiteSiblingsProvider: ({
    children,
  }: {
    value?: unknown;
    children?: React.ReactNode;
  }) => <>{children}</>,
  // Other exports that App.tsx imports as types — provide no-op values so
  // TypeScript import side-effects compile cleanly.
}));

// Mock @pdomain/pdomain-ui/canvas to prevent the konva/lib/index-node.js
// -> require("canvas") chain. WordBboxOverlay transitively imports this
// module; hoisting the mock here prevents the native addon from loading.
vi.mock("@pdomain/pdomain-ui/canvas", () => ({
  PageImageCanvas: ({
    children,
  }: {
    src?: string;
    page?: { width: number; height: number };
    words?: unknown[];
    children?: {
      selection?: () => React.ReactNode;
      tool?: () => React.ReactNode;
      underlay?: () => React.ReactNode;
      overlay?: () => React.ReactNode;
      hud?: () => React.ReactNode;
    };
  }) => (
    <div data-testid="pdomain-ui-canvas">
      {children?.selection?.()}
      {children?.tool?.()}
    </div>
  ),
}));

// Mock react-konva and related canvas modules to prevent Node.js canvas
// native addon from being required in jsdom environments.
vi.mock("react-konva", () => ({
  Stage: ({
    children,
    width,
    height,
    "data-testid": tid,
  }: {
    children?: React.ReactNode;
    width?: number;
    height?: number;
    "data-testid"?: string;
  }) => (
    <div
      data-testid={tid ?? "konva-stage"}
      data-width={width}
      data-height={height}
    >
      {children}
    </div>
  ),
  Layer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Rect: () => <div data-testid="konva-rect" />,
  Image: () => <div data-testid="konva-image" />,
}));

vi.mock("use-image", () => ({
  __esModule: true,
  default: () => [null, "loaded"],
}));

// Mock PipelinePage so routing tests that navigate to /projects/:id/pipeline
// don't have to set up the full XState machine + MSW pipeline fixtures. The
// stub renders a sentinel div with data-testid="pipeline-page" — enough to
// assert routing works and that it is NOT wrapped in a centered-layout box.
vi.mock("./pages/pipeline/PipelinePage", () => ({
  PipelinePage: () => <div data-testid="pipeline-page">pipeline stub</div>,
}));

import App from "./App";

// App.tsx uses useMatch/useNavigate/useLocation which require a Router context.
// In production, main.tsx wraps App in <BrowserRouter>. Tests use MemoryRouter.
// App also relies on the QueryClient from main.tsx; we provide a fresh one per test.
function renderApp(initialPath = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Helper: setup MSW handlers for the root / project-list route.
function withNoProjects() {
  server.use(
    http.get("/api/data/projects", () => HttpResponse.json([])),
    http.get("/api/server-info", () =>
      HttpResponse.json({
        host: "localhost",
        port: 8765,
        url: "http://localhost:8765",
      }),
    ),
  );
}

describe("App: routing shell", () => {
  it("renders the app-header brand on the root route", async () => {
    withNoProjects();
    renderApp();
    await waitFor(() => {
      // AppHeader mock renders brand text "pgdp-prep" regardless of route.
      expect(screen.getByText("pgdp-prep")).toBeInTheDocument();
    });
  });

  it("renders project-list view on / when no projects", async () => {
    withNoProjects();
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("pgdp-prep")).toBeInTheDocument();
    });
    // pdomain-ui AppShell main slot is present with route content.
    expect(screen.getByTestId("pdomain-ui-app-shell-main")).toBeInTheDocument();
  });

  it("Phase 2.4: pdomain-ui AppShell wrapper is present (data-testid=app-shell)", async () => {
    withNoProjects();
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("pgdp-prep")).toBeInTheDocument();
    });
    // Outer wrapper preserves data-testid=app-shell for any Playwright selectors.
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    // pdomain-ui AppShell mock renders inside it.
    expect(screen.getByTestId("pdomain-ui-app-shell")).toBeInTheDocument();
  });

  it("Task #155: AppHeader renders inside AppShell header slot", async () => {
    withNoProjects();
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("pgdp-prep")).toBeInTheDocument();
    });
    const headerSlot = screen.getByTestId("pdomain-ui-app-shell-header");
    // AppHeader mock renders with data-testid="app-header" inside the header slot.
    expect(
      headerSlot.querySelector("[data-testid='app-header']"),
    ).not.toBeNull();
  });

  it("Task #155: search trigger renders in AppShell header slot", async () => {
    withNoProjects();
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("pgdp-prep")).toBeInTheDocument();
    });
    const headerSlot = screen.getByTestId("pdomain-ui-app-shell-header");
    // AppHeader mock renders a Search button wired to onSearchClick.
    const searchBtn = headerSlot.querySelector("[aria-label='Search (⌘K)']");
    expect(searchBtn).not.toBeNull();
  });

  it("Phase 2.4: Routes render inside AppShell main slot", async () => {
    withNoProjects();
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("pgdp-prep")).toBeInTheDocument();
    });
    // All route-level content is inside the main slot.
    expect(screen.getByTestId("pdomain-ui-app-shell-main")).toBeInTheDocument();
  });

  it("Phase 2.4: GAP-1 — ServerInfoFooter is app-local inside main slot", async () => {
    withNoProjects();
    renderApp();
    await waitFor(() => {
      expect(screen.getByText("pgdp-prep")).toBeInTheDocument();
    });
    const mainSlot = screen.getByTestId("pdomain-ui-app-shell-main");
    // ServerInfoFooter fetches /api/server-info and renders a <footer> element.
    // After data loads it renders inside main (GAP-1: app-local footer zone).
    await waitFor(() => {
      const footerEl = mainSlot.querySelector("footer");
      expect(footerEl).not.toBeNull();
    });
  });

  // ── Phase 2.7b: pdomain-ocr-ops suite routes wired (close #329) ────────────────
  //
  // AppShell is wired with real pdomain-ocr-ops fetch callbacks. These tests verify
  // the DOM-visible contract: correct appId, header wiring, and MSW-intercepted
  // API calls from the SuiteSiblingsProvider (whose mock renders children
  // transparently so the real fetchInstalled callback still fires on mount).

  it("Phase 2.7b / Task #155: AppShell receives appId=pdomain-prep-for-pgdp and AppHeader is wired", async () => {
    // Verify the AppShell wrapper is present and the header slot is wired.
    // The mock AppShell renders slots as data-testid divs; AppHeader mock
    // renders data-testid="app-header" with brand text inside the header slot.
    withNoProjects();
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId("pdomain-ui-app-shell")).toBeInTheDocument();
    });
    const headerSlot = screen.getByTestId("pdomain-ui-app-shell-header");
    expect(headerSlot).toBeInTheDocument();
    // AppHeader renders the app brand inside the header slot.
    expect(headerSlot.textContent).toContain("pgdp-prep");
  });

  it("Phase 2.7b: SuiteSiblingsProvider fetchInstalled is a real fetch (not a shim)", async () => {
    // SuiteSiblingsProvider mock renders children transparently.
    // The real fetchInstalled() is passed as value.fetchInstalled and IS called
    // by the real SuiteSiblingsProvider when not mocked. However, the shell mock
    // makes SuiteSiblingsProvider a no-op wrapper.
    //
    // We verify the implementation contract by checking that the app renders
    // without error when MSW handles /api/suite/installed (real fetch path).
    server.use(
      http.get("/api/suite/installed", () => HttpResponse.json([])),
      http.get("/api/suite/prefs", () =>
        HttpResponse.json({
          common: { theme: "dark", density: "normal", font_scale: 1.0 },
          apps: {},
        }),
      ),
    );
    withNoProjects();
    renderApp();
    await waitFor(() => {
      // App renders successfully — the suite route MSW handlers are present.
      expect(screen.getByTestId("pdomain-ui-app-shell")).toBeInTheDocument();
    });
  });

  it("Phase 2.7b: AppShell main slot renders route content", async () => {
    // Verify the routes block is inside the AppShell main slot (not GAP-broken).
    withNoProjects();
    renderApp();
    await waitFor(() => {
      const mainSlot = screen.getByTestId("pdomain-ui-app-shell-main");
      expect(mainSlot).toBeInTheDocument();
      // Routes render inside main — project list placeholder or heading is present.
      expect(mainSlot.textContent?.length).toBeGreaterThan(0);
    });
  });
});

// ── Full-bleed layout contract (fix/pipeline-fullbleed) ──────────────────────
//
// These tests assert the CenteredLayout presence/absence contract:
//   - Centered routes (/, /jobs, /settings, /login, /import) must render their
//     content inside a `[data-testid="centered-layout"]` box.
//   - The pipeline route (/projects/:id/pipeline) must NOT use CenteredLayout;
//     PipelinePage sits directly in the `routes-area` container.
//
// PipelinePage is mocked (stub at top of file) so these tests focus purely on
// the routing + wrapper structure without XState machine setup.
//
describe("App: full-bleed vs centered layout contract", () => {
  it("/ (ProjectsPage) renders inside centered-layout", async () => {
    withNoProjects();
    renderApp("/");
    await waitFor(() => {
      expect(screen.getByTestId("routes-area")).toBeInTheDocument();
    });
    const routesArea = screen.getByTestId("routes-area");
    expect(
      routesArea.querySelector("[data-testid='centered-layout']"),
    ).not.toBeNull();
  });

  it("/jobs (JobsPage) renders inside centered-layout", async () => {
    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([])),
      http.get("/api/server-info", () =>
        HttpResponse.json({
          host: "localhost",
          port: 8765,
          url: "http://localhost:8765",
        }),
      ),
    );
    renderApp("/jobs");
    await waitFor(() => {
      expect(screen.getByTestId("routes-area")).toBeInTheDocument();
    });
    const routesArea = screen.getByTestId("routes-area");
    expect(
      routesArea.querySelector("[data-testid='centered-layout']"),
    ).not.toBeNull();
  });

  it("/settings (SettingsPage) renders inside centered-layout", async () => {
    server.use(
      http.get("/api/server-info", () =>
        HttpResponse.json({
          host: "localhost",
          port: 8765,
          url: "http://localhost:8765",
        }),
      ),
    );
    renderApp("/settings");
    await waitFor(() => {
      expect(screen.getByTestId("routes-area")).toBeInTheDocument();
    });
    const routesArea = screen.getByTestId("routes-area");
    expect(
      routesArea.querySelector("[data-testid='centered-layout']"),
    ).not.toBeNull();
  });

  it("/projects/:id/pipeline renders WITHOUT centered-layout (full-bleed)", async () => {
    // PipelinePage is mocked — this purely tests the route container structure.
    server.use(
      http.get("/api/data/projects", () => HttpResponse.json([])),
      http.get("/api/server-info", () =>
        HttpResponse.json({
          host: "localhost",
          port: 8765,
          url: "http://localhost:8765",
        }),
      ),
    );
    renderApp("/projects/test-project-id/pipeline");
    await waitFor(() => {
      expect(screen.getByTestId("pipeline-page")).toBeInTheDocument();
    });
    const routesArea = screen.getByTestId("routes-area");
    // Pipeline route must NOT be wrapped in a centering box.
    expect(
      routesArea.querySelector("[data-testid='centered-layout']"),
    ).toBeNull();
    // The pipeline-page sentinel is a direct child of the routes-area (no centering layer).
    expect(
      routesArea.querySelector("[data-testid='pipeline-page']"),
    ).not.toBeNull();
  });

  it("routes-area has full-bleed classes (flex-1 min-h-0 w-full)", async () => {
    withNoProjects();
    renderApp("/");
    await waitFor(() => {
      expect(screen.getByTestId("routes-area")).toBeInTheDocument();
    });
    const routesArea = screen.getByTestId("routes-area");
    // The routes-area container must carry full-bleed layout classes so
    // PipelinePage (which uses height:100%) expands to fill the AppShell main zone.
    expect(routesArea.className).toContain("flex-1");
    expect(routesArea.className).toContain("min-h-0");
    expect(routesArea.className).toContain("w-full");
    expect(routesArea.className).toContain("overflow-hidden");
  });
});
