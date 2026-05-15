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
import { api, getAuthToken } from "./api/client";
import type { components } from "./api/types.gen";
import { AwaitingReviewBanner } from "./components/AwaitingReviewBanner";
import { ServerInfoFooter } from "./components/ServerInfoFooter";
import { TooltipProvider } from "./components/ui/Tooltip";
import { AppShell } from "./components/shell/AppShell";
import { HotkeyHelpModal } from "./components/shell/HotkeyHelpModal";
import { SearchModal } from "./components/shell/SearchModal";
import { TopNav } from "./components/shell/TopNav";
import { UserMenu } from "./components/shell/UserMenu";
import { useUiPrefs } from "./stores/uiPrefs";

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

export default function App() {
  const { setSearchOpen } = useUiPrefs();
  const projectMatch = useMatch("/projects/:projectId/*");
  const [hotkeyHelpOpen, setHotkeyHelpOpen] = useState(false);

  useHotkeys("?", () => setHotkeyHelpOpen(true), { preventDefault: true });

  return (
    <TooltipProvider>
      <SearchModal />
      <HotkeyHelpModal
        open={hotkeyHelpOpen}
        onClose={() => setHotkeyHelpOpen(false)}
      />
      <AppShell
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
        footer={<ServerInfoFooter />}
      >
        <AuthGuard />
        {/* Global banner slot — rendered above all page content */}
        <div className="banner-slot mx-auto max-w-7xl px-4 pt-4 space-y-2">
          {projectMatch && <AwaitingReviewBanner />}
        </div>
        <div className="mx-auto max-w-7xl p-4">
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
      </AppShell>
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
    const env = (window as any).__ENV__ ?? {};
    if (env.AUTH_MODE !== "jwt") return;
    if (location.pathname === "/login") return;
    if (!getAuthToken()) navigate("/login", { replace: true });
  }, [navigate, location.pathname]);

  // Reactive redirect: any cached query that 401s.
  useEffect(() => {
    const env = (window as any).__ENV__ ?? {};
    if (env.AUTH_MODE !== "jwt") return;
    if (location.pathname === "/login") return;

    const cache = queryClient.getQueryCache();
    const unsub = cache.subscribe((event: any) => {
      const status = event?.query?.state?.error?.status;
      if (status === 401) navigate("/login", { replace: true });
    });
    return () => unsub();
  }, [queryClient, navigate, location.pathname]);
  return null;
}
