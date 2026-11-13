/**
 * ArchiveTool — React surface for the Archive stage tool (terminal pipeline stage).
 *
 * Drives `archiveToolMachine`. Two tabs:
 * - **Overview** — Gate + keep/drop manifest + "Archive now" + result stats
 * - **Settings** — Destination, keep toggles, retention
 *
 * This is the PIPELINE archive stage (cold-storage handoff), distinct from
 * the project-level archive in manage-actions (reversible hide-from-Active).
 *
 * @see src/machines/tools/archiveTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/archive/archive.jsx
 */

import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  archiveToolMachine,
  type ArchiveItem,
  type ArchiveToolServices,
} from "@/machines/tools/archiveTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { buildRealArchiveToolServices } from "@/services/tools/archiveTool";
import { subscribeProject } from "@/services/sse";

function itemSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ItemRow({
  item,
  onToggle,
  disabled,
}: {
  item: ArchiveItem;
  onToggle: () => void;
  disabled: boolean;
}) {
  const color = item.keep ? "var(--exact)" : "var(--ink-4)";
  return (
    <div
      data-testid={`archive-item-${itemSlug(item.name)}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderTop: "1px solid var(--border-1)",
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          background: `color-mix(in oklab, ${color} 15%, var(--bg-surface))`,
          border: `1px solid color-mix(in oklab, ${color} 40%, var(--border-1))`,
          color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {item.keep ? "↓" : "×"}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: item.keep ? "var(--ink-1)" : "var(--ink-3)",
          fontWeight: item.keep ? 500 : 400,
        }}
      >
        {item.name}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          fontFamily: "var(--mono-font, monospace)",
        }}
      >
        {item.meta}
      </span>
      <span
        style={{
          width: 44,
          textAlign: "right",
          fontSize: 10,
          fontWeight: 700,
          color,
          textTransform: "uppercase",
          fontFamily: "var(--mono-font, monospace)",
        }}
      >
        {item.keep ? "keep" : "drop"}
      </span>
      <Button
        data-testid={`toggle-keep-${itemSlug(item.name)}`}
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onToggle}
        style={{ minWidth: 50 }}
      >
        {item.keep ? "Drop" : "Keep"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ArchiveTool(
  props: ToolSlotProps & { _testServices?: ArchiveToolServices },
): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  return (
    <ArchiveToolForProject key={projectId} projectId={projectId} {...props} />
  );
}

function ArchiveToolForProject({
  stageId,
  runnerRef: _runnerRef,
  _testServices,
  projectId,
}: ToolSlotProps & {
  _testServices?: ArchiveToolServices;
  projectId: string;
}): ReactNode {
  const [services] = useState(
    () => _testServices ?? buildRealArchiveToolServices(),
  );

  const [snapshot, send] = useActor(archiveToolMachine, {
    input: {
      projectId,
      stageIndex: 23,
      services,
      settings: { destination: "glacier", retention: "10yr" },
    },
  });

  const [tab, setTab] = useState("overview");

  // Rehydrate the terminal state from the persisted stage status.
  //
  // `archive` is terminal and server-side `clean` survives a reload, but the
  // machine always starts at `reviewing`. Without this the surface shows the
  // pre-archive keep/drop list forever on any fresh load of an already-archived
  // project, and the `gate-archived` sentinel never appears.
  //
  // The project channel carries both halves: a `project-snapshot` frame on
  // connect (the reload case) and later `project-stage-status` frames (a run
  // completing in another tab). Handle both — same pattern as ZipTool's SSE
  // wiring, which listens for the incremental frames.
  useEffect(() => {
    let cancelled = false;
    services
      .listItems(projectId)
      .then((items) => {
        if (!cancelled) send({ type: "ITEMS_LOADED", items });
      })
      .catch(() => {
        if (!cancelled) send({ type: "ITEMS_FAILED" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, send, services]);

  useEffect(() => {
    const unsubscribe = subscribeProject(projectId, (event) => {
      if (event.type === "project-snapshot") {
        const row = event.project_stages.find((s) => s.stage_id === "archive");
        if (row?.status === "clean") send({ type: "ARCHIVE_RESTORED" });
        return;
      }
      if (event.type !== "project-stage-status") return;
      if (event.stage_id !== "archive") return;
      if (event.status === "clean") send({ type: "ARCHIVE_RESTORED" });
    });
    return unsubscribe;
  }, [projectId, send]);

  const ctx = snapshot.context;
  const isReviewing = snapshot.matches("reviewing");
  const isArchiving = snapshot.matches("archiving");
  const isArchived = snapshot.matches("archived");

  const keepItems = ctx.items.filter((it) => it.keep);
  const dropItems = ctx.items.filter((it) => !it.keep);

  return (
    <div data-testid="archive-tool" data-stage-id={stageId} style={{ flex: 1 }}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="settings">Step Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div
            style={{
              padding: "20px 28px 28px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Gate card — shown whenever the stage is archived.
                Not gated on ctx.result: a state restored from the persisted
                stage status has no kept/dropped byte stats (those are only
                known from a live run), but the gate itself still holds. The
                stats block below stays gated on result. */}
            {isArchived && (
              <div
                data-testid="gate-archived"
                style={{
                  borderRadius: 10,
                  border:
                    "1px solid color-mix(in oklab, var(--exact) 40%, var(--border-1))",
                  background:
                    "color-mix(in oklab, var(--exact) 7%, var(--bg-surface))",
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 7,
                    background:
                      "color-mix(in oklab, var(--exact) 18%, var(--bg-surface))",
                    color: "var(--exact)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  ✓
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                    }}
                  >
                    Archived to cold storage · {projectId}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 12,
                      color: "var(--ink-3)",
                    }}
                  >
                    Stage files marked keep stay in the archive. Files marked
                    drop stay out of it.
                  </div>
                </div>
              </div>
            )}

            {isArchiving && (
              <div
                data-testid="archiving-in-progress"
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  padding: "4px 0",
                }}
              >
                Archiving to cold storage…
              </div>
            )}

            {/* Result stats */}
            {isArchived && ctx.result && (
              <div style={{ display: "flex", gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color: "var(--ocr)",
                      fontFamily: "var(--mono-font, monospace)",
                    }}
                  >
                    {ctx.destination}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      marginTop: 4,
                    }}
                  >
                    destination
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--ink-4)",
                      fontFamily: "var(--mono-font, monospace)",
                      marginTop: 2,
                    }}
                  >
                    cold storage
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    data-testid="kept-stat"
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color: "var(--exact)",
                      fontFamily: "var(--mono-font, monospace)",
                    }}
                  >
                    {ctx.result.kept}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      marginTop: 4,
                    }}
                  >
                    kept
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    data-testid="dropped-stat"
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      fontFamily: "var(--mono-font, monospace)",
                    }}
                  >
                    {ctx.result.dropped}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      marginTop: 4,
                    }}
                  >
                    dropped
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--ink-4)",
                      fontFamily: "var(--mono-font, monospace)",
                      marginTop: 2,
                    }}
                  >
                    intermediates
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      fontFamily: "var(--mono-font, monospace)",
                    }}
                  >
                    {ctx.retention}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      marginTop: 4,
                    }}
                  >
                    retention
                  </div>
                </div>
              </div>
            )}

            {/* Dry stats — pre-archive */}
            {!isArchived && (
              <div style={{ display: "flex", gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color: "var(--exact)",
                      fontFamily: "var(--mono-font, monospace)",
                    }}
                  >
                    {keepItems.length}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      marginTop: 4,
                    }}
                  >
                    to keep
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      fontFamily: "var(--mono-font, monospace)",
                    }}
                  >
                    {dropItems.length}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      marginTop: 4,
                    }}
                  >
                    to drop
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color: "var(--ocr)",
                      fontFamily: "var(--mono-font, monospace)",
                    }}
                  >
                    {ctx.destination}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      marginTop: 4,
                    }}
                  >
                    destination
                  </div>
                </div>
              </div>
            )}

            {/* Keep/drop manifest */}
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--border-1)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                    }}
                  >
                    What gets archived
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Long-term storage handoff — keep what's irreplaceable, drop
                    what's re-derivable
                  </div>
                </div>
                {isReviewing && (
                  <Button
                    data-testid="archive-now-btn"
                    variant="primary"
                    size="sm"
                    disabled={!ctx.itemsReady}
                    onClick={() => send({ type: "ARCHIVE_NOW" })}
                  >
                    Archive now
                  </Button>
                )}
                {isArchived && (
                  <Button
                    data-testid="re-archive-btn"
                    variant="default"
                    size="sm"
                    onClick={() => send({ type: "RE_ARCHIVE" })}
                  >
                    Re-archive
                  </Button>
                )}
              </div>
              {!ctx.itemsReady && ctx.error && (
                <div
                  data-testid="archive-list-error"
                  style={{ fontSize: 12, color: "var(--ink-3)" }}
                >
                  {ctx.error.message}
                </div>
              )}
              <div data-testid="archive-manifest" style={{ padding: "0 16px" }}>
                {ctx.items.map((item) => (
                  <ItemRow
                    key={item.name}
                    item={item}
                    disabled={!isReviewing}
                    onToggle={() =>
                      send({ type: "TOGGLE_KEEP", name: item.name })
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div
            data-testid="archive-settings"
            style={{
              padding: "20px 28px 28px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div>
              <h2
                style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}
              >
                Stage settings · Archive
              </h2>
              <div
                style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}
              >
                Destination, retention and what to keep.
              </div>
            </div>
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "13px 16px",
                  display: "grid",
                  gridTemplateColumns: "260px 1fr",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                    Destination
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Cold-storage target
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono-font, monospace)",
                    fontSize: 12,
                    color: "var(--ink-2)",
                  }}
                >
                  {ctx.destination}
                </span>
              </div>
              <div
                style={{
                  padding: "13px 16px",
                  borderTop: "1px solid var(--border-1)",
                  display: "grid",
                  gridTemplateColumns: "260px 1fr",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                    Retention
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Minimum storage period
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono-font, monospace)",
                    fontSize: 12,
                    color: "var(--ink-2)",
                  }}
                >
                  {ctx.retention}
                </span>
              </div>
              <div
                style={{
                  padding: "13px 16px",
                  borderTop: "1px solid var(--border-1)",
                }}
              >
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  Full settings editing (destination, keep-original toggles,
                  retention period) at I1.
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
