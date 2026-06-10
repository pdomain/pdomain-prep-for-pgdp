/**
 * BuildPackageTool — React surface for the Build Package stage tool.
 *
 * Drives `buildPackageToolMachine`. Two tabs:
 * - **Overview** — Preflight gate card + deliverable tree + manifest excerpt
 * - **Settings** — Checksum algorithm, provenance README, re-build
 *
 * Gate display: shows current preflight status from PREFLIGHT_PUSH.
 * BUILD button is disabled until preflight === 'passed'.
 *
 * @see src/machines/tools/buildPackageTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/build_package/build-package.jsx
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  buildPackageToolMachine,
  type BuildPackageToolServices,
  type PreflightStatus,
} from "@/machines/tools/buildPackageTool";
import type { TreeRow } from "@/machines/tools/proofPackTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

const MOCK_BP_TREE: TreeRow[] = [
  { name: "manifest.json", d: 0, meta: "4.2 KB" },
  { name: "belloc-survivals.zip", d: 0, meta: "1.38 GB" },
  { name: "provenance.md", d: 0, meta: "2.1 KB" },
  { name: "checksums.sha256", d: 0, meta: "38 KB" },
  { name: "metadata.json", d: 0, meta: "8.2 KB" },
];

function makeMockBuildServices(_projectId: string): BuildPackageToolServices {
  return {
    buildArtifacts: (_pid, _algo) =>
      Promise.resolve({
        deliverable: { files: MOCK_BP_TREE, count: 5 },
        manifest: {
          project: "belloc-survivals",
          pages: 387,
          canvas: "2480x3400",
          built: "2026-06-02T00:00:00Z",
          pipeline: "pd-prep v1.0",
          files: 1229,
          sha256: "a3f1…9c2",
        },
      }),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PreflightBadge({ status }: { status: PreflightStatus }) {
  const conf: Record<PreflightStatus, { color: string; label: string }> = {
    passed: { color: "var(--exact)", label: "passed" },
    blocked: { color: "var(--mismatch)", label: "blocked" },
    unknown: { color: "var(--ink-4)", label: "unknown" },
  };
  const { color, label } = conf[status];
  return (
    <span
      data-testid={`preflight-status-${status}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        height: 22,
        borderRadius: 99,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 35%, var(--border-1))`,
        color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--mono-font, monospace)",
      }}
    >
      pre-flight · {label}
    </span>
  );
}

function TreeView({ rows }: { rows: TreeRow[] }) {
  return (
    <div
      data-testid="deliverable-tree"
      style={{
        fontFamily: "var(--mono-font, monospace)",
        fontSize: 11.5,
        lineHeight: 1.9,
      }}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 8,
            paddingLeft: (row.d ?? 0) * 18,
            alignItems: "center",
          }}
        >
          <span style={{ color: "var(--ink-4)" }}>·</span>
          <span style={{ color: "var(--ink-2)", flex: 1 }}>{row.name}</span>
          {row.meta && (
            <span style={{ color: "var(--ink-4)", fontSize: 10.5 }}>
              {row.meta}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BuildPackageTool({
  stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = makeMockBuildServices(projectId);

  const [snapshot, send] = useActor(buildPackageToolMachine, {
    input: { projectId, stageIndex: 19, services },
  });

  const [tab, setTab] = useState("overview");

  // In a real app, pipelineShell fans PREFLIGHT_PUSH; here we simulate it.
  // The Build button will be disabled when preflight is not 'passed'.

  const ctx = snapshot.context;
  const isBuilding = snapshot.matches("building");
  const isBuilt = snapshot.matches("built");

  const preflightColor =
    ctx.preflight === "passed"
      ? "var(--exact)"
      : ctx.preflight === "blocked"
        ? "var(--mismatch)"
        : "var(--ink-4)";

  return (
    <div
      data-testid="build-package-tool"
      data-stage-id={stageId}
      style={{ flex: 1 }}
    >
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
            {/* Gate status */}
            <div
              data-testid={
                isBuilt
                  ? "gate-built"
                  : isBuilding
                    ? "gate-building"
                    : "gate-idle"
              }
              style={{
                borderRadius: 10,
                border: `1px solid color-mix(in oklab, ${isBuilt ? "var(--exact)" : "var(--border-1)"} 40%, var(--border-1))`,
                background: `color-mix(in oklab, ${isBuilt ? "var(--exact)" : "transparent"} 7%, var(--bg-surface))`,
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
                  background: `color-mix(in oklab, ${isBuilt ? "var(--exact)" : "var(--border-1)"} 18%, var(--bg-surface))`,
                  color: isBuilt ? "var(--exact)" : "var(--ink-3)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {isBuilt ? "✓" : isBuilding ? "…" : "○"}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "var(--ink-1)",
                  }}
                >
                  {isBuilt
                    ? "Package built · ready to submit"
                    : isBuilding
                      ? "Building package…"
                      : "No current build"}
                </div>
                <div
                  style={{ marginTop: 2, fontSize: 12, color: "var(--ink-3)" }}
                >
                  {isBuilt
                    ? "Manifest (per-file checksums), the deterministic archive, metadata and a provenance README."
                    : isBuilding
                      ? "Assembling manifest + checksums + provenance README…"
                      : "Build is gated on validation pre-flight. Run validation first."}
                </div>
              </div>
              <PreflightBadge status={ctx.preflight} />
            </div>

            {/* Stats */}
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
                    fontFamily: "var(--mono-font, monospace)",
                  }}
                >
                  {isBuilt ? "5 files" : "—"}
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
                  deliverable
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
                  {isBuilt ? "1,229" : "—"}
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
                  manifest entries
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
                    color: preflightColor,
                  }}
                >
                  {ctx.preflight}
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
                  pre-flight
                </div>
              </div>
            </div>

            {/* Action row */}
            <div style={{ display: "flex", gap: 10 }}>
              {!isBuilt && (
                <Button
                  data-testid="build-btn"
                  variant="primary"
                  size="sm"
                  disabled={ctx.preflight !== "passed" || isBuilding}
                  onClick={() => send({ type: "BUILD" })}
                >
                  {isBuilding ? "Building…" : "Build package"}
                </Button>
              )}
              {isBuilt && (
                <>
                  <Button
                    data-testid="rebuild-btn"
                    variant="default"
                    size="sm"
                    onClick={() => send({ type: "REBUILD" })}
                  >
                    Re-build
                  </Button>
                  <Button
                    data-testid="continue-to-submit-btn"
                    variant="primary"
                    size="sm"
                    onClick={() => send({ type: "CONTINUE_TO_SUBMIT" })}
                  >
                    Continue to Submit check
                  </Button>
                </>
              )}
            </div>

            {/* Deliverable tree + manifest */}
            {isBuilt && ctx.deliverable && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr",
                  gap: 14,
                }}
              >
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
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                    }}
                  >
                    Deliverable
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    <TreeView rows={ctx.deliverable.files} />
                  </div>
                </div>
                {ctx.manifest && (
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
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink-1)",
                        }}
                      >
                        manifest.json
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--ink-3)",
                          marginTop: 2,
                        }}
                      >
                        excerpt
                      </div>
                    </div>
                    <pre
                      data-testid="manifest-excerpt"
                      style={{
                        margin: 0,
                        padding: "14px 16px",
                        fontSize: 10.5,
                        lineHeight: 1.7,
                        color: "var(--ink-2)",
                        fontFamily: "var(--mono-font, monospace)",
                        whiteSpace: "pre-wrap",
                        overflowX: "auto",
                      }}
                    >
                      {JSON.stringify(
                        {
                          project: ctx.manifest.project,
                          pages: ctx.manifest.pages,
                          canvas: ctx.manifest.canvas,
                          built: ctx.manifest.built,
                          pipeline: ctx.manifest.pipeline,
                          files: ctx.manifest.files,
                          sha256: ctx.manifest.sha256,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div
            data-testid="build-package-settings"
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
                Stage settings · Build package
              </h2>
              <div
                style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}
              >
                What goes in the manifest and deliverable.
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
                  borderBottom: "1px solid var(--border-1)",
                  display: "grid",
                  gridTemplateColumns: "260px 1fr",
                  alignItems: "center",
                  gap: 12,
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
                    Checksum algorithm
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Per-file integrity
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--mono-font, monospace)",
                    fontSize: 12,
                    color: "var(--ink-2)",
                  }}
                >
                  {ctx.checksumAlgo}
                </div>
              </div>
              <div style={{ padding: "13px 16px" }}>
                {isBuilt && (
                  <Button
                    data-testid="build-settings-rebuild-btn"
                    variant="default"
                    size="sm"
                    onClick={() => send({ type: "REBUILD" })}
                  >
                    Re-build package
                  </Button>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
