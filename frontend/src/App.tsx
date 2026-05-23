// App.tsx — SPA root: router, QueryClient provider, and route table.
//
// Phase 2.4: replaced local AppShell wrapper with pd-ui AppShell (#266).
// Phase 2.7b: wired real pd-ocr-ops suite routes (#329). GAP-2/GAP-3/GAP-4
//              resolved; /api/suite/* is now mounted by bootstrap.py via
//              pd_ocr_ops.mount_routes(). UIPrefsConfig load/persist uses
//              GET/PUT /api/suite/prefs with localStorage fallback.
// Phase 2.7c: searchOpen moved from uiPrefs store to local React state (#330).
//              SearchModal now accepts explicit open/onOpenChange props.
//
// Slot mapping vs former local layout (components/shell/AppShell.tsx):
//   header   ← TopNav (was header slot of custom AppShell)
//   main     ← Routes block + banners + SearchModal + HotkeyHelpModal
//   footer   — pd-ui AppShell has no footer zone (GAP-1); ServerInfoFooter
//              is kept app-local inside the main slot using flex-col layout.
//
// GAP-1: pd-ui AppShell has no footer zone. ServerInfoFooter (formerly in
//         the 32px footer grid row of components/shell/AppShell.tsx) is
//         kept app-local: rendered as a flex-col sibling of the routes div
//         inside the `main` slot. Resolve if pd-ui adds a footer zone.
//
// GAP-5 (from uiPrefs.ts): pd-ui's UIPrefs.theme is 'dark' | 'light' (no
//         'system'). The local store supports 'system'; when theme is 'system'
//         the pd-ui AppShell receives the resolved effective value.
//         Resolve when pd-ui's UIPrefs gains 'system' theme support.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Route,
  Routes,
  Link,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import {
  AppShell,
  SuiteSiblingsProvider,
  type UIPrefsConfig,
  type InstalledApp,
  type LaunchResult,
} from "@concavetrillion/pd-ui/shell";
import { api, getAuthToken } from "./api/client";
import type { components } from "./api/types.gen";
import { AwaitingReviewBanner } from "./components/AwaitingReviewBanner";
import { ServerInfoFooter } from "./components/ServerInfoFooter";
import { TooltipProvider } from "./components/ui/Tooltip";
import { HotkeyHelpModal } from "./components/shell/HotkeyHelpModal";
import { SearchModal } from "./components/shell/SearchModal";
import { TopNav } from "./components/shell/TopNav";
import { UserMenu } from "./components/shell/UserMenu";
import { THEME_STORAGE_KEY } from "./stores/uiPrefs";

type ReviewStatusResponse = components["schemas"]["ReviewStatusResponse"];
import { JobsPage } from "./pages/JobsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectListPage } from "./pages/ProjectListPage";
import { ProjectConfigurePage } from "./pages/ProjectConfigurePage";
import { PageWorkbenchPage } from "./pages/PageWorkbenchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProjectReviewQueuePage } from "./pages/ProjectReviewQueuePage";
import { TextReviewPage } from "./pages/TextReviewPage";
import { CropsGridPage } from "./pages/CropsGridPage";

// ── Phase 2.7b: UIPrefsConfig — real pd-ocr-ops wiring (resolves GAP-2/GAP-3) ─
//
// pd-ocr-ops mounts GET /api/suite/prefs and PUT /api/suite/prefs/common.
// load() calls the backend first; falls back to localStorage on error.
// persistCommon() writes to the backend and mirrors theme to localStorage
// so the local uiPrefs.ts store stays in sync.
//
// GAP-5 (from uiPrefs.ts, remaining after Phase 2.7c): pd-ui's UIPrefs.theme
// is 'dark' | 'light' (no 'system'). The local store supports 'system'; when
// theme is 'system' the pd-ui AppShell receives the resolved effective value.

/** Resolve 'system' theme preference to an effective 'dark' | 'light' value. */
function resolveTheme(): "dark" | "light" {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

const UI_PREFS_CONFIG: UIPrefsConfig = {
  load: async () => {
    // Try real backend first (pd-ocr-ops GET /api/suite/prefs).
    try {
      const res = await fetch("/api/suite/prefs");
      if (res.ok) {
        // pd-ocr-ops returns: {"common": {"theme": "dark", "density": "normal",
        //   "font_scale": 1.0, ...}, "apps": {...}}
        const body = (await res.json()) as {
          common?: { theme?: string; density?: string; font_scale?: number };
        };
        const common = body.common ?? {};
        const rawTheme = common.theme;
        const theme: "dark" | "light" =
          rawTheme === "dark" || rawTheme === "light" ? rawTheme : "light";
        const rawDensity = common.density;
        const density: "compact" | "normal" | "comfortable" =
          rawDensity === "compact" || rawDensity === "comfortable"
            ? rawDensity
            : "normal";
        return {
          theme,
          density,
          fontScale: common.font_scale ?? 1.0,
        };
      }
    } catch {
      // Network error or backend unavailable — fall through to localStorage.
    }
    // Fallback: seed from localStorage bare string (Phase 2.5 format).
    let theme: "dark" | "light" = "light";
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === "dark") theme = "dark";
      else if (raw === "light") theme = "light";
      else if (raw === "system") theme = resolveTheme();
    } catch {
      // localStorage unavailable or unexpected error
    }
    return { theme, density: "normal", fontScale: 1.0 };
  },
  persistCommon: async (prefs) => {
    // Write to backend (pd-ocr-ops PUT /api/suite/prefs/common).
    try {
      await fetch("/api/suite/prefs/common", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // pd-ocr-ops CommonUIPrefs uses snake_case: font_scale.
        body: JSON.stringify({
          theme: prefs.theme,
          density: prefs.density,
          font_scale: prefs.fontScale,
        }),
      });
    } catch {
      // Backend unreachable — fall through to localStorage mirror.
    }
    // Mirror theme to localStorage so the local uiPrefs.ts store stays in sync.
    try {
      const current = localStorage.getItem(THEME_STORAGE_KEY);
      // Don't overwrite 'system' with its resolved value — let the local store own that.
      if (current !== "system") {
        localStorage.setItem(THEME_STORAGE_KEY, prefs.theme);
      }
    } catch {
      // ignore
    }
  },
  persistApp: async (appPrefs) => {
    // Write app-specific prefs to backend (pd-ocr-ops PUT /api/suite/prefs/apps/{id}).
    try {
      await fetch("/api/suite/prefs/apps/pd-prep-for-pgdp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appPrefs),
      });
    } catch {
      // Backend unreachable — no localStorage mirror for app prefs.
    }
  },
};

// ── Phase 2.7b: SuiteSiblings — real pd-ocr-ops wiring (resolves GAP-4) ──────
//
// pd-ocr-ops mounts GET /api/suite/installed and POST /api/suite/launch.
// Adapter maps pd-ocr-ops InstalledApp shape (snake_case) to pd-ui shape.
//
// pd-ocr-ops shape:  { app_id, display_name, default_port, icon, enabled, ... }
// pd-ui shape:       { id, displayName, launchUrl, iconUrl?, url?, pid? }
//
// launchUrl: http://localhost:{default_port} (local mode).
// iconUrl: /api/icons/32?app_id={app_id} (served by pd-ocr-ops icons router).

interface OcrOpsInstalledApp {
  app_id: string;
  display_name: string;
  default_port: number;
  icon: string;
  enabled: boolean;
}

function adaptInstalledApp(raw: OcrOpsInstalledApp): InstalledApp {
  return {
    id: raw.app_id,
    displayName: raw.display_name,
    launchUrl: `http://localhost:${raw.default_port.toString()}`,
    iconUrl: `/api/icons/32?app_id=${encodeURIComponent(raw.app_id)}`,
  };
}

async function fetchInstalled(): Promise<InstalledApp[]> {
  try {
    const res = await fetch("/api/suite/installed");
    if (!res.ok) return [];
    const apps = (await res.json()) as OcrOpsInstalledApp[];
    return apps.filter((a) => a.enabled).map(adaptInstalledApp);
  } catch {
    return [];
  }
}

async function postLaunch(id: string): Promise<LaunchResult> {
  try {
    const res = await fetch(
      `/api/suite/launch?app_id=${encodeURIComponent(id)}`,
      {
        method: "POST",
      },
    );
    if (!res.ok) return { kind: "requires-host-config", siblingId: id };
    return (await res.json()) as LaunchResult;
  } catch {
    return { kind: "requires-host-config", siblingId: id };
  }
}

export default function App() {
  // Phase 2.7c (#330): searchOpen moved from uiPrefs store to local React
  // state. SearchModal now accepts explicit open/onOpenChange props.
  const [searchOpen, setSearchOpen] = useState(false);
  const projectMatch = useMatch("/projects/:projectId/*");
  const [hotkeyHelpOpen, setHotkeyHelpOpen] = useState(false);

  useHotkeys("?", () => setHotkeyHelpOpen(true), { preventDefault: true });

  return (
    <TooltipProvider>
      {/*
       * Phase 2.4: SuiteSiblingsProvider supplies the launcher context
       * that pd-ui AppShell's LauncherSlot reads via useSuiteSiblingsContext().
       * fetchInstalled / postLaunch are shims (GAP-4) until pd-ocr-ops
       * mounts /api/suite/* in the FastAPI app.
       */}
      <SuiteSiblingsProvider value={{ fetchInstalled, postLaunch }}>
        {/*
         * Outer wrapper preserves data-testid="app-shell" for any integration
         * tests or Playwright selectors that anchor on the shell root.
         */}
        <div data-testid="app-shell" className="h-screen w-full">
          <AppShell
            appId="pd-prep-for-pgdp"
            appDisplayName="pgdp-prep"
            appIconUrl="/static/icon.svg"
            launcherSlot="header"
            deployMode="local"
            uiPrefsConfig={UI_PREFS_CONFIG}
            header={
              <TopNav
                centerSlot={
                  <button
                    onClick={() => setSearchOpen(true)}
                    className="flex w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-300 transition-colors"
                    aria-label="Search (⌘K)"
                  >
                    <span className="flex-1 text-left">Search projects…</span>
                    <kbd className="ml-auto text-xs text-slate-500 font-mono">
                      ⌘K
                    </kbd>
                  </button>
                }
                rightSlot={
                  <>
                    <OpenTasksBell />
                    <UserMenu />
                  </>
                }
              />
            }
            main={
              /*
               * GAP-1: pd-ui AppShell has no footer zone. ServerInfoFooter
               * is kept app-local as a flex-col sibling of the routes div,
               * pinned to the bottom of the main zone via flex layout.
               */
              <div className="flex flex-col h-full overflow-hidden">
                <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
                <HotkeyHelpModal
                  open={hotkeyHelpOpen}
                  onClose={() => setHotkeyHelpOpen(false)}
                />
                <AuthGuard />
                {/* Global banner slot — rendered above all page content */}
                <div className="banner-slot mx-auto max-w-7xl px-4 pt-4 space-y-2">
                  {projectMatch && <AwaitingReviewBanner />}
                </div>
                <div className="flex-1 overflow-auto mx-auto max-w-7xl p-4 w-full">
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/" element={<ProjectListPage />} />
                    <Route path="/jobs" element={<JobsPage />} />
                    <Route
                      path="/projects/:projectId"
                      element={<ProjectConfigurePage />}
                    />
                    <Route
                      path="/projects/:projectId/pages/:idx0"
                      element={<PageWorkbenchPage />}
                    />
                    <Route
                      path="/projects/:projectId/pages/:idx0/review"
                      element={<TextReviewPage />}
                    />
                    <Route
                      path="/projects/:projectId/crops"
                      element={<CropsGridPage />}
                    />
                    <Route
                      path="/projects/:projectId/review"
                      element={<ProjectReviewQueuePage />}
                    />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </div>
                {/* GAP-1: ServerInfoFooter pinned at bottom of main zone */}
                <ServerInfoFooter />
              </div>
            }
          />
        </div>
      </SuiteSiblingsProvider>
    </TooltipProvider>
  );
}

/**
 * Bell icon in the navbar showing unreviewed-page count for the active project.
 * Only renders when the user is on a project route and there are pages
 * awaiting review with a parked build_package job.
 */
function OpenTasksBell() {
  const match = useMatch("/projects/:projectId/*");
  const projectId = match?.params?.projectId ?? null;

  const status = useQuery({
    queryKey: ["review-status", projectId],
    queryFn: () =>
      api.get<ReviewStatusResponse>(
        `/api/data/projects/${projectId}/review-status`,
      ),
    refetchInterval: 1000,
    enabled: projectId !== null,
  });

  const count = status.data?.awaiting_review_job_id
    ? status.data.unreviewed_count
    : 0;

  if (!projectId || count === 0) return null;

  return (
    <Link
      to={`/projects/${projectId}/review`}
      className="relative flex items-center text-slate-600 hover:text-slate-900"
      title={`${count} page${count === 1 ? "" : "s"} awaiting review`}
      aria-label={`Open tasks: ${count} page${count === 1 ? "" : "s"} awaiting review`}
    >
      <span className="text-base">🔔</span>
      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
        {count}
      </span>
    </Link>
  );
}

/** In JWT mode: redirect to /login if no token, OR on any 401. */
function AuthGuard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  // Eager redirect: direct nav to a protected route with no token.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- __ENV__ is an untyped runtime injection from env.js
    const env = (window as any).__ENV__ ?? {};
    if (env.AUTH_MODE !== "jwt") return;
    if (location.pathname === "/login") return;
    if (!getAuthToken()) void navigate("/login", { replace: true });
  }, [navigate, location.pathname]);

  // Reactive redirect: any cached query that 401s.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- __ENV__ is an untyped runtime injection from env.js
    const env = (window as any).__ENV__ ?? {};
    if (env.AUTH_MODE !== "jwt") return;
    if (location.pathname === "/login") return;

    const cache = queryClient.getQueryCache();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- QueryCacheNotifyEvent type not exported from @tanstack/react-query
    const unsub = cache.subscribe((event: any) => {
      const status = event?.query?.state?.error?.status;
      if (status === 401) void navigate("/login", { replace: true });
    });
    return () => unsub();
  }, [queryClient, navigate, location.pathname]);
  return null;
}
