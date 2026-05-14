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
import { api, getAuthToken, setAuthToken } from "./api/client";
import type { components } from "./api/types.gen";
import { ProfileDropdown } from "./components/ProfileDropdown";
import { ServerInfoFooter } from "./components/ServerInfoFooter";

type ReviewStatusResponse = components["schemas"]["ReviewStatusResponse"];
import { JobsPage } from "./pages/JobsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectListPage } from "./pages/ProjectListPage";
import { ProjectConfigurePage } from "./pages/ProjectConfigurePage";
import { PageWorkbenchPage } from "./pages/PageWorkbenchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProjectReviewQueuePage } from "./pages/ProjectReviewQueuePage";
import { TextReviewPage } from "./pages/TextReviewPage";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AuthGuard />
      <header className="border-b bg-white">
        <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 text-sm">
          <Link to="/" className="font-semibold">
            pgdp-prep
          </Link>
          <Link to="/" className="text-slate-600 hover:text-slate-900">
            Projects
          </Link>
          <Link to="/jobs" className="text-slate-600 hover:text-slate-900">
            Jobs
          </Link>
          <Link to="/settings" className="text-slate-600 hover:text-slate-900">
            Settings
          </Link>
          <OpenTasksBell />
          <AuthBadge />
        </nav>
      </header>

      <main className="mx-auto max-w-7xl p-4">
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
            path="/projects/:projectId/review"
            element={<ProjectReviewQueuePage />}
          />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <ServerInfoFooter />
    </div>
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
      className="relative ml-auto flex items-center text-slate-600 hover:text-slate-900"
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

/** Right-side nav widget: shows JWT user identity + sign-out, or apikey label. */
function AuthBadge() {
  const env = (window as any).__ENV__ ?? {};
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(getAuthToken());

  // Refresh on storage events (e.g. after the LoginPage stores a token).
  useEffect(() => {
    const handler = () => setToken(getAuthToken());
    window.addEventListener("storage", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("focus", handler);
    };
  }, []);

  // Pull identity from /api/auth/me — works across all auth modes.
  const me = useQuery({
    queryKey: ["me", token],
    queryFn: () => api.get<{ user_id: string }>("/api/auth/me"),
    retry: false,
    enabled: env.AUTH_MODE !== "none",
  });

  if (env.AUTH_MODE === "none") return null;
  if (env.AUTH_MODE === "apikey") {
    if (!me.data) {
      return (
        <span className="ml-auto text-xs text-slate-400">apikey mode</span>
      );
    }
    return (
      <span className="ml-auto flex items-center gap-2 text-xs text-slate-600">
        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono">
          {me.data.user_id}
        </span>
      </span>
    );
  }
  if (env.AUTH_MODE === "jwt") {
    if (!token) {
      return (
        <Link
          to="/login"
          className="ml-auto text-xs text-slate-600 hover:underline"
        >
          Sign in
        </Link>
      );
    }
    return (
      <ProfileDropdown
        token={token}
        onSignOut={() => {
          setAuthToken(null);
          setToken(null);
          queryClient.clear();
          navigate("/login");
        }}
      />
    );
  }
  return null;
}
