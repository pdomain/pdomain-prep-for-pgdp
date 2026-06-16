/**
 * PipelinePage — F4 pipeline shell surface.
 *
 * Route: `/projects/:projectId/pipeline` (+ optional `?stage=<stageId>`)
 *
 * DCArtboard states covered (fixture tests in PipelinePage.test.tsx):
 *   - booting          — fetchPipeline in flight, spinner
 *   - loadError        — fetchPipeline failed, retry button
 *   - pipeline/stages  — stage strip + tabs + tool slot
 *   - pipeline/settings — ProjectSettings panel swap
 *
 * ## Machine wiring
 * `pipelineShellMachine` is the orchestrator. Its runners array holds the 23
 * stageRunner actor refs. The StageStrip renders dots as projections of runner
 * snapshots — no per-dot machine. See DIVERGENCES.md F4-3.
 *
 * ## Tool slot
 * F5 fills the tool slot. The slot interface is defined in `toolSlot.tsx`.
 * Until F5 ships, the placeholder panel is rendered.
 *
 * ## Settings panel
 * F4-1 divergence: projectSettings machine is mounted in the component layer
 * (same as F3-4/F3-6 for projectDetail). The panel is shown/hidden by local
 * React state synced with the machine's mode.settings region.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/pipeline-shell.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/pipeline/pipeline-template.jsx
 * @see src/machines/pipelineShell.ts
 * @see src/pages/pipeline/toolSlot.tsx
 * @see src/machines/DIVERGENCES.md §F4-1 §F4-2 §F4-3
 */

import { useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useActor } from "@xstate/react";
import { useActiveBatchJob } from "@/hooks/useActiveBatchJob";
import {
  buildRealPipelineShellServices,
  buildRealStageRunnerServices,
  buildRealProjectSettingsServices,
} from "@/services/pipeline";
import { subscribeProject } from "@/services/sse";
import {
  pipelineShellMachine,
  STAGE_DEFS,
  RUNNER_STAGE_DEFS,
  tabsForStage,
  type PipelineShellServices,
  type AutomationToggles,
} from "@/machines/pipelineShell";
import { mapProjectEvent } from "@/machines/lib/sseActor";
import {
  projectSettingsMachine,
  type ProjectSettingsServices,
} from "@/machines/projectSettings";
import { Button } from "@/components/ui/Button";
import { resolveToolSlot } from "./toolSlot";

// ---------------------------------------------------------------------------
// Status colors for StageStrip dots
// ---------------------------------------------------------------------------

type RunnerStateValue =
  | "notrun"
  | "queued"
  | "running"
  | "clean"
  | "flagged"
  | "stale"
  | "error";

function dotColor(state: RunnerStateValue): string {
  switch (state) {
    case "clean":
      return "var(--exact, #22c55e)";
    case "running":
    case "queued":
      return "var(--ocr, #6366f1)";
    case "flagged":
      return "var(--fuzzy, #f59e0b)";
    case "error":
      return "var(--mismatch, #ef4444)";
    case "stale":
      return "var(--ink-3, #888)";
    case "notrun":
    default:
      return "var(--ink-4, #aaa)";
  }
}

// ---------------------------------------------------------------------------
// StageStrip — dots are PROJECTIONS of runner snapshots, no per-dot machine
// ---------------------------------------------------------------------------

interface RunnerLike {
  getSnapshot(): {
    value: string;
    context: { stageId: string; progress: number };
  };
}

function StageStrip({
  runners,
  currentStageId,
  currentIndex,
  onSelectStage,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  runners: RunnerLike[];
  currentStageId: string;
  currentIndex: number;
  onSelectStage: (stageId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  return (
    <div
      data-testid="stage-strip"
      style={{
        padding: "10px 28px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-1)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        overflow: "hidden",
      }}
    >
      {/* Stage chip — current stage label + dropdown */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: "0 0 auto",
        }}
      >
        <div
          className="label"
          style={{
            color: "var(--ink-3)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Stage
        </div>
        <button
          data-testid="stage-chip"
          onClick={() => {
            // dropdown placeholder — F5 wires a real dropdown
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px",
            borderRadius: 7,
            border:
              "1px solid color-mix(in oklab, var(--accent) 40%, var(--border-1))",
            background:
              "color-mix(in oklab, var(--accent) 8%, var(--bg-surface))",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: "var(--accent)",
            }}
          />
          <span
            data-testid="stage-chip-label"
            style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}
          >
            {currentStageId}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              fontFamily: "monospace",
            }}
          >
            {currentIndex + 1}/{STAGE_DEFS.length}
          </span>
        </button>
      </div>

      {/* Dots — projections of runner snapshots */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 3,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {/* Source stage (index 0) — no runner; always "clean" since project exists */}
        <button
          key="source"
          data-testid="stage-dot-source"
          title="1. source"
          onClick={() => onSelectStage("source")}
          style={{
            width: currentStageId === "source" ? 18 : 14,
            height: 22,
            borderRadius: 4,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            background:
              currentStageId === "source"
                ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                : "transparent",
            border:
              currentStageId === "source"
                ? "1px solid color-mix(in oklab, var(--accent) 60%, var(--border-1))"
                : "none",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: dotColor("clean"),
            }}
          />
        </button>
        <span style={{ width: 2, height: 1, background: "var(--border-2)" }} />

        {/* Runner stages (indices 1–23) */}
        {RUNNER_STAGE_DEFS.map((def, i) => {
          const runnerRef = runners[i];
          const snap = runnerRef?.getSnapshot();
          const state = (snap?.value ?? "notrun") as RunnerStateValue;
          const isCur = def.id === currentStageId;
          const stageIdx = i + 2; // 1-based display index (source=1, grayscale=2...)

          return (
            <span
              key={def.id}
              style={{ display: "flex", alignItems: "center" }}
            >
              <button
                data-testid={`stage-dot-${def.id}`}
                title={`${stageIdx}. ${def.id}`}
                onClick={() => onSelectStage(def.id)}
                style={{
                  width: isCur ? 18 : 14,
                  height: 22,
                  borderRadius: 4,
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  background: isCur
                    ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                    : "transparent",
                  border: isCur
                    ? "1px solid color-mix(in oklab, var(--accent) 60%, var(--border-1))"
                    : "none",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: dotColor(state),
                    opacity: isCur ? 1 : state === "clean" ? 1 : 0.55,
                  }}
                />
              </button>
              {i < RUNNER_STAGE_DEFS.length - 1 && (
                <span
                  style={{ width: 2, height: 1, background: "var(--border-2)" }}
                />
              )}
            </span>
          );
        })}
      </div>

      {/* Prev / Next */}
      <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
        <Button
          data-testid="stage-prev-btn"
          variant="outline"
          size="sm"
          disabled={!hasPrev}
          onClick={onPrev}
        >
          ← Prev
        </Button>
        <Button
          data-testid="stage-next-btn"
          variant="primary"
          size="sm"
          disabled={!hasNext}
          onClick={onNext}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IngestBanner — shown while unzip / thumbnails job is running or queued
// ---------------------------------------------------------------------------

/** Job types that represent "ingest in flight" (same as the retired ProjectConfigurePage). */
const INGEST_KINDS = ["unzip", "thumbnails"];

/**
 * Shows when the current project has a live (running/queued/scheduled)
 * unzip or thumbnails job. Auto-hides when no such job is active.
 * Links to /jobs?project_id=<id> for full job status.
 */
function IngestBanner({ projectId }: { projectId: string }) {
  const ingestBatch = useActiveBatchJob(projectId || null, INGEST_KINDS);
  const liveJob = useMemo(
    () => ingestBatch.jobs.find((j) => j.id === ingestBatch.jobId) ?? null,
    [ingestBatch.jobs, ingestBatch.jobId],
  );

  if (!liveJob) return null;

  const label =
    liveJob.type === "unzip"
      ? "Unzipping source archive…"
      : "Creating thumbnails…";
  const { current, total, message } = liveJob.progress;

  return (
    <div
      data-testid="ingest-banner"
      style={{
        borderBottom: "1px solid var(--border-1)",
        background: "color-mix(in oklab, #0ea5e9 6%, var(--bg-page))",
        borderTop:
          "1px solid color-mix(in oklab, #0ea5e9 25%, var(--border-1))",
        padding: "10px 28px",
      }}
    >
      <p
        data-testid="ingest-banner-label"
        style={{ fontWeight: 500, fontSize: 13, color: "var(--ink-1)" }}
      >
        {label}
      </p>
      {total > 0 && (
        <p style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}>
          {current}/{total}
          {message && ` · ${message}`}
        </p>
      )}
      <p style={{ marginTop: 4, fontSize: 11.5 }}>
        <Link
          to={`/jobs?project_id=${encodeURIComponent(projectId)}`}
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          Open jobs page →
        </Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectInfoBand — cover + title + stat tiles + Run all stale + Settings toggle
// ---------------------------------------------------------------------------

function ProjectInfoBand({
  projectId,
  projectName,
  pageCount,
  inSettings,
  onOpenSettings,
  onCloseSettings,
  onRunAllStale,
}: {
  projectId: string;
  /** Human-readable project display name from PipelineSnapshot.project.title. Falls back to projectId when empty. */
  projectName: string;
  /** Total page count sourced from pipelineShell context (PipelineSnapshot.project.page_count). */
  pageCount: number;
  inSettings: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onRunAllStale: () => void;
}) {
  return (
    <div
      data-testid="project-info-band"
      style={{
        padding: "16px 28px",
        background: "var(--bg-page)",
        borderBottom: "1px solid var(--border-1)",
      }}
    >
      {/* Title row */}
      <div
        style={{
          display: "flex",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            data-testid="pipeline-project-title"
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              color: "var(--ink-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {projectName || projectId}
          </h1>
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: "var(--ink-3)",
              fontFamily: "monospace",
            }}
          >
            {projectId}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flex: "0 0 auto",
            alignItems: "center",
          }}
        >
          <Button
            data-testid="settings-toggle-btn"
            variant={inSettings ? "primary" : "outline"}
            size="sm"
            onClick={inSettings ? onCloseSettings : onOpenSettings}
          >
            {inSettings ? "Close settings" : "Project settings"}
          </Button>

          {!inSettings && (
            <Button
              data-testid="run-all-stale-btn"
              variant="primary"
              size="sm"
              onClick={onRunAllStale}
            >
              Run all stale →
            </Button>
          )}
        </div>
      </div>

      {/* Stat tiles */}
      <div
        data-testid="pipeline-stat-tiles"
        style={{
          marginTop: 12,
          display: "flex",
          gap: 12,
        }}
      >
        <StatBadge
          label="Total pages"
          value={pageCount}
          testId="stat-total-pages"
        />
        <StatBadge label="Done" value={0} testId="stat-done" />
        <StatBadge
          label="Awaiting review"
          value={0}
          testId="stat-awaiting-review"
        />
      </div>
    </div>
  );
}

/** Small inline stat badge for the project info band. */
function StatBadge({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border-1)",
        background: "var(--bg-surface)",
      }}
    >
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink-1)",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TabsBand — per-stage tabs strip
// ---------------------------------------------------------------------------

function TabsBand({
  stageId,
  currentTab,
  onSetTab,
}: {
  stageId: string;
  currentTab: string;
  onSetTab: (tab: string) => void;
}) {
  const tabs = tabsForStage(stageId);
  return (
    <div
      data-testid="tabs-band"
      style={{
        padding: "0 28px",
        background: "var(--bg-page)",
        borderBottom: "1px solid var(--border-1)",
        display: "flex",
        alignItems: "flex-end",
        gap: 0,
      }}
    >
      {tabs.map((t) => {
        const active = currentTab === t.id;
        return (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => onSetTab(t.id)}
            style={{
              padding: "12px 14px",
              marginBottom: -1,
              color: active ? "var(--ink-1)" : "var(--ink-3)",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              background: "none",
              border: "none",
              borderBottom: active
                ? "2px solid var(--accent)"
                : "2px solid transparent",
            }}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectSettingsPanel — inline settings panel (F4-1 divergence)
// ---------------------------------------------------------------------------

function ProjectSettingsPanel({
  projectId,
  settingsServices,
  onClose,
}: {
  projectId: string;
  settingsServices: ProjectSettingsServices;
  onClose: (automation: AutomationToggles) => void;
}) {
  const [snap, send] = useActor(projectSettingsMachine, {
    input: { projectId, services: settingsServices },
  });

  const ctx = snap.context;

  const GROUPS: { id: NonNullable<typeof ctx.group>; name: string }[] = [
    { id: "general", name: "General" },
    { id: "bib", name: "Bibliographic" },
    { id: "pgdp", name: "PGDP submission" },
    { id: "format", name: "Format & content" },
    { id: "defaults", name: "Stage defaults" },
    { id: "members", name: "Members" },
    { id: "storage", name: "Storage & cleanup" },
    { id: "danger", name: "Danger zone" },
  ] as const;

  if (snap.matches("loading")) {
    return (
      <div
        data-testid="settings-loading"
        style={{ padding: 24, color: "var(--ink-3)" }}
      >
        Loading settings…
      </div>
    );
  }

  if (snap.matches("loadError")) {
    return (
      <div
        data-testid="settings-error"
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p style={{ color: "var(--mismatch)" }}>Failed to load settings.</p>
        <Button
          data-testid="settings-retry-btn"
          size="sm"
          onClick={() => send({ type: "RETRY" })}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="settings-panel"
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        minHeight: 0,
      }}
    >
      {/* Left rail */}
      <div
        data-testid="settings-group-rail"
        style={{
          borderRight: "1px solid var(--border-1)",
          background: "var(--bg-surface)",
          padding: "14px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            color: "var(--ink-3)",
            padding: "4px 8px 8px",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Project settings
        </div>
        {GROUPS.map((item) => {
          const active = ctx.group === item.id;
          const isDanger = item.id === "danger";
          return (
            <button
              key={item.id}
              data-testid={`settings-group-${item.id}`}
              onClick={() => send({ type: "SET_GROUP", group: item.id })}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                background: active ? "var(--bg-raised)" : "transparent",
                color: isDanger
                  ? "var(--mismatch)"
                  : active
                    ? "var(--ink-1)"
                    : "var(--ink-2)",
                fontSize: 12.5,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                textAlign: "left",
                border: "none",
                borderLeft: active
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              }}
            >
              {item.name}
            </button>
          );
        })}
      </div>

      {/* Right pane */}
      <div
        data-testid="settings-group-content"
        style={{ overflow: "auto", padding: "20px 28px" }}
      >
        {ctx.group === "general" && (
          <AutomationSection
            automation={ctx.automation}
            onToggle={(key, value) =>
              send({ type: "TOGGLE_AUTOMATION", key, value })
            }
          />
        )}
        {ctx.group === "danger" && (
          <DangerSection
            snap={snap}
            onRequestDestructive={(action) =>
              send({ type: "REQUEST_DESTRUCTIVE", action })
            }
            onAcknowledge={() => send({ type: "ACKNOWLEDGE" })}
            onConfirm={() => send({ type: "CONFIRM" })}
            onCancel={() => send({ type: "CANCEL" })}
          />
        )}
        {ctx.group !== "general" && ctx.group !== "danger" && (
          <div style={{ color: "var(--ink-3)", fontSize: 13, paddingTop: 8 }}>
            {ctx.group} settings — coming in I1.
          </div>
        )}

        {/* Close settings button */}
        <div style={{ marginTop: 24 }}>
          <Button
            data-testid="settings-close-btn"
            variant="primary"
            size="sm"
            onClick={() => onClose(ctx.automation)}
          >
            Close settings
          </Button>
        </div>
      </div>
    </div>
  );
}

function AutomationSection({
  automation,
  onToggle,
}: {
  automation: AutomationToggles;
  onToggle: (key: keyof AutomationToggles, value: boolean | number) => void;
}) {
  const rows: { key: keyof AutomationToggles; label: string; sub: string }[] = [
    {
      key: "autoRunAfterIngest",
      label: "Auto-run stages after ingest",
      sub: "Start the pipeline automatically when source images are ingested.",
    },
    {
      key: "rerunDownstreamOnStale",
      label: "Re-run downstream on stale bump",
      sub: "When you tweak a stage, automatically re-run everything after it.",
    },
    {
      key: "notifyOnError",
      label: "Notify on stage error",
      sub: "Surface failed pages in the header notifications.",
    },
  ];

  return (
    <div>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--ink-1)",
          marginBottom: 14,
        }}
      >
        Automation
      </h2>
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {rows.map((row, i) => {
          const on = automation[row.key] as boolean;
          return (
            <div
              key={row.key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 36px",
                gap: 12,
                padding: "12px 14px",
                alignItems: "center",
                borderTop: i === 0 ? "none" : "1px solid var(--border-1)",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "var(--ink-1)",
                  }}
                >
                  {row.label}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                  }}
                >
                  {row.sub}
                </div>
              </div>
              <button
                data-testid={`automation-toggle-${row.key}`}
                aria-pressed={on}
                onClick={() => onToggle(row.key, !on)}
                style={{
                  width: 30,
                  height: 18,
                  borderRadius: 99,
                  cursor: "pointer",
                  background: on
                    ? "var(--accent, #6366f1)"
                    : "var(--border-2, #ccc)",
                  border: "none",
                  position: "relative",
                  transition: "background .12s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: on ? 14 : 2,
                    width: 14,
                    height: 14,
                    borderRadius: 99,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,.15)",
                    transition: "left .12s",
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DangerSection({
  snap,
  onRequestDestructive,
  onAcknowledge,
  onConfirm,
  onCancel,
}: {
  snap: ReturnType<typeof useActor<typeof projectSettingsMachine>>[0];
  onRequestDestructive: (action: "reset" | "purge" | "delete") => void;
  onAcknowledge: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isConfirming = snap.matches({ ready: { danger: "confirming" } });
  const isArmed = snap.matches({ ready: { danger: "armed" } });
  const isExecuting = snap.matches({ ready: { danger: "executing" } });
  const pending = snap.context._pending;

  return (
    <div>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--mismatch, #ef4444)",
          marginBottom: 14,
        }}
      >
        Danger zone
      </h2>

      {!isConfirming && !isArmed && !isExecuting && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {(
            [
              {
                action: "reset" as const,
                label: "Reset pipeline",
                desc: "Clear all stage outputs. Project metadata is preserved.",
              },
              {
                action: "purge" as const,
                label: "Purge artifacts",
                desc: "Delete all on-disk artifacts. Cannot be undone.",
              },
              {
                action: "delete" as const,
                label: "Delete project",
                desc: "Permanently remove this project and all its data.",
              },
            ] as const
          ).map((row, i) => (
            <div
              key={row.action}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderTop: i === 0 ? "none" : "1px solid var(--border-1)",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--mismatch, #ef4444)",
                  }}
                >
                  {row.label}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                  }}
                >
                  {row.desc}
                </div>
              </div>
              <Button
                data-testid={`danger-action-btn-${row.action}`}
                variant="danger"
                size="sm"
                onClick={() => onRequestDestructive(row.action)}
              >
                {row.label}…
              </Button>
            </div>
          ))}
        </div>
      )}

      {(isConfirming || isArmed || isExecuting) && (
        <div
          data-testid="danger-confirm-panel"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <p style={{ color: "var(--ink-1)", fontSize: 13 }}>
            Are you sure you want to <strong>{pending}</strong> this project?
            This cannot be undone.
          </p>

          {isConfirming && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="danger-ack"
                type="checkbox"
                data-testid="danger-acknowledge-checkbox"
                checked={false}
                onChange={onAcknowledge}
              />
              <label htmlFor="danger-ack" style={{ fontSize: 13 }}>
                I understand this cannot be undone.
              </label>
            </div>
          )}

          {isArmed && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                data-testid="danger-confirm-btn"
                variant="danger"
                size="sm"
                onClick={onConfirm}
              >
                Confirm {pending}
              </Button>
              <Button
                data-testid="danger-cancel-btn"
                variant="outline"
                size="sm"
                onClick={onCancel}
              >
                Cancel
              </Button>
            </div>
          )}

          {!isArmed && !isExecuting && (
            <Button
              data-testid="danger-cancel-btn"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}

          {isExecuting && (
            <p style={{ color: "var(--ink-3)", fontSize: 12 }}>Executing…</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelinePage — main surface
// ---------------------------------------------------------------------------

export interface PipelinePageServices {
  shell: PipelineShellServices;
  settings: ProjectSettingsServices;
}

export function PipelinePage({
  services: injectedServices,
}: {
  services?: PipelinePageServices;
}) {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const initialStageId = searchParams.get("stage");
  const queryClient = useQueryClient();

  const resolvedServices = useMemo<PipelinePageServices>(() => {
    if (injectedServices) return injectedServices;

    // Production services — real v2 API (I1)
    const runnerSvcs = buildRealStageRunnerServices();
    const shell = buildRealPipelineShellServices(runnerSvcs);
    const settings = buildRealProjectSettingsServices();
    void queryClient; // available for cache invalidation at I2
    return { shell, settings };
  }, [injectedServices, queryClient]);

  const [snap, send] = useActor(pipelineShellMachine, {
    input: {
      projectId,
      services: resolvedServices.shell,
      initialStageId,
      onRunAllStale: (staleIndices) => {
        // F4-2 divergence: runAllStale coordination in component layer
        // For now, log — F5 will wire up the runAllStale machine
        console.log("[PipelinePage] Run all stale:", staleIndices);
      },
      onOpenSettings: () => {
        send({ type: "OPEN_SETTINGS" });
      },
      onCloseSettings: (automation) => {
        send({ type: "CLOSE_SETTINGS", automation });
      },
    },
  });

  const ctx = snap.context;
  const inSettings = snap.matches({ pipeline: { mode: "settings" } });

  // ── Project SSE channel (I1 wiring) ──────────────────────────────────────
  //
  // Subscribe to project-level SSE events and forward them to pipelineShell.
  // The machine handles STAGE_PUSH / PROGRESS_PUSH / STATUS_PUSH events from
  // this channel — specifically routing stage progress and status updates to
  // the matching stageRunner actor via routeStagePush.
  //
  // Divergence pattern: SSE subscription is in the component layer (same as
  // F4-1 projectSettings, F3-4/F3-6 projectDetail). The machine does not
  // spawn the sseActor itself — it receives events via send() here.
  //
  // The subscription is created once per (projectId, send) pair and cleaned
  // up when the component unmounts or projectId changes.
  useEffect(
    function subscribeProjectSse() {
      if (!projectId) return;
      const unsubscribe = subscribeProject(projectId, (event) => {
        const machineEvent = mapProjectEvent(event);
        // Forward all SseMachineEvent types to the machine.
        // SseMachineEvent = StatusPushEvent | StagePushEvent | ProgressPushEvent —
        // every value from mapProjectEvent is one of these, so send unconditionally.
        send(machineEvent);
      });
      return unsubscribe;
    },
    [projectId, send],
  );

  // ── Loading / error ──────────────────────────────────────────────────────

  if (snap.matches("booting")) {
    return (
      <section
        data-testid="pipeline-page"
        style={{ display: "flex", flexDirection: "column" }}
      >
        <div
          data-testid="pipeline-loading"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 48,
            color: "var(--ink-3)",
          }}
        >
          Loading pipeline…
        </div>
      </section>
    );
  }

  if (snap.matches("loadError")) {
    return (
      <section
        data-testid="pipeline-page"
        style={{ display: "flex", flexDirection: "column" }}
      >
        <div
          data-testid="pipeline-error"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 48,
          }}
        >
          <p style={{ color: "var(--mismatch)" }}>Failed to load pipeline.</p>
          <Button
            data-testid="pipeline-retry-btn"
            onClick={() => send({ type: "RETRY" })}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }

  // ── Pipeline view ────────────────────────────────────────────────────────

  const currentRunnerRef =
    ctx.runners[
      ctx.currentStageId === "source"
        ? -1
        : ctx.runners.findIndex((r) => {
            const s = r.getSnapshot();
            return s.context.stageId === ctx.currentStageId;
          })
    ] ?? null;

  const ToolComponent = resolveToolSlot(ctx.currentStageId);

  return (
    <section
      data-testid="pipeline-page"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Project info band */}
      <ProjectInfoBand
        projectId={projectId}
        projectName={ctx.projectName}
        pageCount={ctx.pageCount}
        inSettings={inSettings}
        onOpenSettings={() => send({ type: "OPEN_SETTINGS" })}
        onCloseSettings={() => send({ type: "CLOSE_SETTINGS" })}
        onRunAllStale={() => send({ type: "RUN_ALL_STALE" })}
      />

      {/* Ingest banner — shown while unzip / thumbnails job is live */}
      <IngestBanner projectId={projectId} />

      {inSettings ? (
        /* Settings mode — replaces stage body */
        <ProjectSettingsPanel
          projectId={projectId}
          settingsServices={resolvedServices.settings}
          onClose={(automation) => send({ type: "CLOSE_SETTINGS", automation })}
        />
      ) : (
        <>
          {/* Stage strip */}
          <StageStrip
            runners={ctx.runners}
            currentStageId={ctx.currentStageId}
            currentIndex={ctx.currentIndex}
            onSelectStage={(stageId) => send({ type: "SELECT_STAGE", stageId })}
            onPrev={() => send({ type: "PREV" })}
            onNext={() => send({ type: "NEXT" })}
            hasPrev={ctx.currentIndex > 0}
            hasNext={ctx.currentIndex < STAGE_DEFS.length - 1}
          />

          {/* Tabs band */}
          <TabsBand
            stageId={ctx.currentStageId}
            currentTab={ctx.currentTab}
            onSetTab={(tab) => send({ type: "SET_TAB", tab })}
          />

          {/* Tool slot — F5 fills this */}
          <div
            data-testid="tool-slot-area"
            style={{ flex: 1, display: "flex", padding: 24, minHeight: 0 }}
          >
            {currentRunnerRef || ctx.currentStageId === "source" ? (
              /* Source stage has no stageRunner but does have a tool (SourceTool).
               * Pass null as runnerRef — SourceTool accepts it (F5.1 contract:
               * the prop is retained for interface compatibility but not used).
               * ToolSlotProps.runnerRef is typed as StageRunnerRef | null
               * to accommodate this case. */
              <ToolComponent
                stageId={ctx.currentStageId}
                runnerRef={currentRunnerRef}
                shellSend={send}
                pageCount={ctx.pageCount}
              />
            ) : (
              /* Unreachable in normal use: every runner stage has a runner actor.
               * Kept as a safety net for unexpected state. */
              <div
                data-testid="tool-slot-placeholder"
                data-stage-id={ctx.currentStageId}
                style={{
                  flex: 1,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  border: "1px dashed var(--border-2)",
                  borderRadius: 10,
                }}
              >
                No runner for stage: {ctx.currentStageId}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
