/**
 * PostImportPage — post-import flow surface.
 *
 * Two scenarios driven by postImport machine:
 *   Pa (redirected): index was fast → user is redirected to the new project's
 *      pipeline view while thumbnails generate. "Back to Projects" returns to Pb.
 *   Pb (anchored): index was slow → user stays on projects list with a
 *      JobsDrawer overlay tracking import progress.
 *
 * DCArtboard states (fixture tests in PostImportPage.test.tsx):
 *   - Pa-thumbs     — redirected, thumbnails phase
 *   - Pa-ingest     — redirected, ingest phase
 *   - Pa-done       — redirected, done toast
 *   - Pb-thumbs     — anchored, drawer expanded, thumbs
 *   - Pb-ingest     — anchored, drawer expanded, ingest
 *   - Pb-done       — anchored, drawer done toast
 *   - Pb-collapsed  — anchored, drawer collapsed
 *   - Pb-cancelled  — anchored, job cancelled
 */
import { useNavigate, useParams } from "react-router-dom";
import { useActor } from "@xstate/react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/shell/PageHeader";
import type { ImportJob } from "@/types/pipeline";
import {
  postImportMachine,
  type PostImportInput,
} from "@/machines/projects/postImport";

// ---------------------------------------------------------------------------
// PostImportPage — entry point
// ---------------------------------------------------------------------------

export function PostImportPage({
  overrideInput,
}: {
  /** Injected in tests/Storybook; undefined in production where we use route params + SSE. */
  overrideInput?: PostImportInput;
}) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Stub initial job for production mount (replaced by SSE events immediately).
  const stubJob: ImportJob = {
    id: `job-import-${projectId ?? "unknown"}`,
    project: projectId ?? "unknown",
    projectId: projectId ?? "unknown",
    state: "running",
    phase: "thumbnails",
    pct: 0,
    cancelable: true,
  };

  const input: PostImportInput = overrideInput ?? {
    projectId: projectId ?? "unknown",
    initialJob: stubJob,
    indexWasFast: false,
    onProjectMutated: () => {
      // Reload the projects list in TanStack Query cache
      void navigate("/");
    },
    onNavigateToProject: (pid) => {
      void navigate(`/projects/${pid}`);
    },
  };

  const [snap, send] = useActor(postImportMachine, { input });

  const sv = snap.value as Record<string, unknown>;
  const placement =
    typeof sv["placement"] === "string"
      ? sv["placement"]
      : typeof sv["placement"] === "object"
        ? (Object.keys(sv["placement"] as Record<string, unknown>)[0] ?? "")
        : "";

  if (placement === "redirected") {
    return (
      <PostImportRedirected
        snap={snap}
        send={send}
        projectId={snap.context.projectId}
        job={snap.context.job}
      />
    );
  }

  return (
    <PostImportAnchored
      snap={snap}
      send={send}
      projectId={snap.context.projectId}
      job={snap.context.job}
      anchorId={snap.context.anchorId}
    />
  );
}

// ---------------------------------------------------------------------------
// Pa — Redirected view (project pipeline shell while importing)
// ---------------------------------------------------------------------------

function PostImportRedirected({
  snap,
  send,
  projectId,
  job,
}: {
  snap: ReturnType<typeof useActor<typeof postImportMachine>>[0];
  send: ReturnType<typeof useActor<typeof postImportMachine>>[1];
  projectId: string;
  job: ImportJob;
}) {
  const sv = snap.value as Record<string, unknown>;
  const jobState =
    typeof sv["importJob"] === "string"
      ? sv["importJob"]
      : typeof sv["importJob"] === "object"
        ? (Object.keys(sv["importJob"] as Record<string, unknown>)[0] ?? "")
        : "";

  return (
    <section
      className="flex flex-col"
      data-testid="post-import-page"
      data-screen-label="PostImport-Pa"
    >
      <PageHeader
        title={projectId}
        actions={
          <Button
            variant="ghost"
            size="sm"
            data-testid="back-to-projects-btn"
            onClick={() => send({ type: "BACK_TO_PROJECTS" })}
          >
            ← Projects
          </Button>
        }
      />

      <div
        className="flex-1 p-8"
        data-testid="redirected-pane"
        data-comment-anchor="post-import-pa"
      >
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-ink-1">
                {job.project}
              </h1>
              <Badge status="running" data-testid="import-status-badge">
                importing
              </Badge>
            </div>
            <p className="mt-1 font-mono text-[13px] text-ink-3">{projectId}</p>
          </div>
          <Button variant="primary" disabled data-testid="open-project-btn">
            Open project
          </Button>
        </div>

        {/* Import progress */}
        <div
          className="mt-6 rounded-lg border border-border-1 bg-bg-surface p-4"
          data-testid="import-progress"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11.5px] text-ink-3">
              {job.phase}
            </span>
            <span className="font-mono text-[11.5px] text-ink-2">
              {job.pct}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full bg-status-running transition-[width]"
              style={{ width: `${job.pct}%` }}
              data-testid="import-progress-bar"
            />
          </div>

          {jobState === "done" && (
            <div
              className="mt-3 rounded border border-border-1 bg-bg-raised px-3 py-2 text-xs text-ink-2"
              data-testid="import-done-notice"
            >
              Import complete — project is ready.
            </div>
          )}
        </div>

        {/* Explanation notice */}
        <div
          className="mt-4 rounded-lg border border-border-1 bg-bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-ink-2"
          data-testid="redirect-notice"
        >
          The folder index finished quickly, so we redirected you here.{" "}
          <strong className="text-ink-1">Thumbnails</strong> are being generated
          as the source stage.
        </div>

        {/* Toasts */}
        {snap.context.toasts.length > 0 && (
          <div className="mt-4 space-y-2" data-testid="import-toasts">
            {snap.context.toasts.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-border-1 bg-bg-surface px-4 py-3"
                data-testid={`toast-${t.id}`}
              >
                <span className="text-sm text-ink-1">
                  Import complete · {t.project}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`dismiss-toast-${t.id}`}
                  onClick={() => send({ type: "DISMISS_TOAST", toastId: t.id })}
                >
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pb — Anchored view (projects list + drawer overlay)
// ---------------------------------------------------------------------------

function PostImportAnchored({
  snap,
  send,
  projectId,
  job,
  anchorId,
}: {
  snap: ReturnType<typeof useActor<typeof postImportMachine>>[0];
  send: ReturnType<typeof useActor<typeof postImportMachine>>[1];
  projectId: string;
  job: ImportJob;
  anchorId: string | null;
}) {
  const sv = snap.value as Record<string, unknown>;
  const jobState =
    typeof sv["importJob"] === "string"
      ? sv["importJob"]
      : typeof sv["importJob"] === "object"
        ? (Object.keys(sv["importJob"] as Record<string, unknown>)[0] ?? "")
        : "";
  const drawerState =
    typeof sv["jobsDrawer"] === "string" ? sv["jobsDrawer"] : "expanded";

  return (
    <section
      className="flex flex-col"
      data-testid="post-import-page"
      data-screen-label="PostImport-Pb"
    >
      <PageHeader title="Projects" />

      <div
        className="relative flex-1"
        data-testid="anchored-pane"
        data-comment-anchor="post-import-pb"
      >
        {/* Anchor project preview */}
        <div className="p-8">
          {anchorId ? (
            <div
              className="rounded-lg border border-border-1 bg-bg-surface px-4 py-3 text-xs text-ink-3"
              data-testid="anchor-project-preview"
            >
              Anchored on:{" "}
              <span className="font-mono text-ink-2">{anchorId}</span>
            </div>
          ) : (
            <div className="text-xs text-ink-4" data-testid="anchor-no-project">
              No project selected.
            </div>
          )}
        </div>

        {/* Jobs drawer — bottom-right overlay */}
        <div
          className={`absolute bottom-4 right-4 w-80 overflow-hidden rounded-xl border border-border-2 bg-bg-surface shadow-lg ${
            drawerState === "collapsed" ? "" : ""
          }`}
          data-testid="jobs-drawer"
        >
          <div
            className="flex cursor-pointer items-center justify-between px-4 py-2.5"
            data-testid="jobs-drawer-header"
          >
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-1">
              <span
                className="h-2 w-2 rounded-full bg-status-running"
                aria-hidden
              />
              Jobs
            </span>
            <button
              data-testid="drawer-collapse-btn"
              onClick={() =>
                drawerState === "expanded"
                  ? send({ type: "COLLAPSE_DRAWER" })
                  : send({ type: "EXPAND_DRAWER" })
              }
              className="text-ink-3 hover:text-ink-1"
            >
              {drawerState === "expanded" ? "⌃" : "⌄"}
            </button>
          </div>

          {drawerState === "expanded" && (
            <div data-testid="jobs-drawer-body">
              {/* Active import job row */}
              {jobState !== "cancelled" && jobState !== "settled" && (
                <div
                  className="border-t border-border-1 px-4 py-3"
                  data-testid="import-job-row"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-[12.5px] font-medium text-ink-1">
                      {job.project}
                    </span>
                    {job.cancelable && jobState !== "done" && (
                      <button
                        data-testid="cancel-job-btn"
                        className="text-[11px] text-ink-3 hover:text-status-error"
                        onClick={() =>
                          send({ type: "CANCEL_JOB", jobId: job.id })
                        }
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-ink-3">
                    {job.phase}
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bg-raised">
                    <div
                      className="h-full rounded-full bg-status-running transition-[width]"
                      style={{ width: `${job.pct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Cancelled state */}
              {jobState === "cancelled" && (
                <div
                  className="border-t border-border-1 px-4 py-3"
                  data-testid="import-cancelled-row"
                >
                  <div className="flex items-center gap-2">
                    <Badge status="cancelled">cancelled</Badge>
                    <span className="text-[12px] text-ink-3">
                      {job.project}
                    </span>
                  </div>
                </div>
              )}

              {/* Toasts */}
              {snap.context.toasts.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between border-t border-border-1 px-4 py-2.5"
                  data-testid={`drawer-toast-${t.id}`}
                >
                  <span className="text-[12px] text-ink-1">
                    Import complete · {t.project}
                  </span>
                  <button
                    data-testid={`dismiss-drawer-toast-${t.id}`}
                    className="text-[11px] text-ink-3 hover:text-ink-1"
                    onClick={() =>
                      send({ type: "DISMISS_TOAST", toastId: t.id })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}

              {/* Open importing project */}
              {jobState !== "cancelled" && (
                <div className="flex items-center justify-between border-t border-border-1 px-4 py-2.5">
                  <button
                    data-testid="open-importing-row-btn"
                    className="text-[11.5px] text-ink-3 hover:text-ink-1"
                    onClick={() => send({ type: "OPEN_IMPORTING_ROW" })}
                  >
                    {projectId}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
