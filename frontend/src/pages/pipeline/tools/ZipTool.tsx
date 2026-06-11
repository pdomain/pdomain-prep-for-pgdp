/**
 * ZipTool — React surface for the Zip stage tool.
 *
 * Drives `zipToolMachine`. Two tabs:
 * - **Overview** — Compressing progress / built gate + sha256 + contents tree
 * - **Settings** — Format, deterministic toggle, compression, sidecar
 *
 * SHA-256 display: the cross-check used by submit_check's dry run.
 *
 * @see src/machines/tools/zipTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/zip/zip.jsx
 */

import type { ReactNode } from "react";
import { useState, useMemo } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import { zipToolMachine, type ZipArchive } from "@/machines/tools/zipTool";
import type { TreeRow } from "@/machines/tools/proofPackTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { buildRealZipToolServices } from "@/services/tools/zipTool";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CompressingBanner({
  entries,
  total,
  pct,
}: {
  entries: number;
  total: number;
  pct: number;
}) {
  return (
    <div
      data-testid="compressing-banner"
      style={{
        borderRadius: 10,
        border:
          "1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))",
        background: "color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))",
          color: "var(--ocr)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 99,
            border:
              "2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)",
            borderTopColor: "var(--ocr)",
            animation: "spin 1.1s linear infinite",
          }}
        />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}>
          Compressing…{" "}
          <span
            style={{
              fontSize: 11.5,
              color: "var(--ink-3)",
              fontFamily: "var(--mono-font, monospace)",
            }}
          >
            {entries} / {total} entries · deterministic
          </span>
        </div>
        <div
          style={{
            marginTop: 8,
            height: 4,
            borderRadius: 99,
            background: "color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))",
            overflow: "hidden",
          }}
        >
          <div
            data-testid="compression-progress-bar"
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--ocr)",
              transition: "width 0.3s",
            }}
          />
        </div>
      </div>
      <span
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--ocr)",
          fontFamily: "var(--mono-font, monospace)",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

function BuiltGate({ archive }: { archive: ZipArchive }) {
  return (
    <div
      data-testid="gate-built"
      style={{
        borderRadius: 10,
        border:
          "1px solid color-mix(in oklab, var(--exact) 40%, var(--border-1))",
        background: "color-mix(in oklab, var(--exact) 7%, var(--bg-surface))",
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
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}>
          Archive built · {archive.name}
        </div>
        <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-3)" }}>
          Deterministic build — identical inputs produce a byte-identical
          archive (sorted entries, fixed timestamps, no extra metadata).
        </div>
      </div>
    </div>
  );
}

function TreeView({ rows }: { rows: TreeRow[] }) {
  return (
    <div
      data-testid="zip-tree"
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
          <span style={{ color: row.dir ? "var(--accent)" : "var(--ink-4)" }}>
            {row.dir ? "▸" : "·"}
          </span>
          <span
            style={{
              color: row.dir ? "var(--ink-1)" : "var(--ink-2)",
              fontWeight: row.dir ? 600 : 400,
              flex: 1,
            }}
          >
            {row.name}
          </span>
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

export function ZipTool({
  stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = useMemo(() => buildRealZipToolServices(), []);

  const [snapshot, send] = useActor(zipToolMachine, {
    input: { projectId, stageIndex: 20, services },
  });

  const [tab, setTab] = useState("overview");

  const ctx = snapshot.context;
  const isCompressing = snapshot.matches("compressing");
  const isBuilt = snapshot.matches("built");
  const isFailed = snapshot.matches("failed");

  return (
    <div data-testid="zip-tool" data-stage-id={stageId} style={{ flex: 1 }}>
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
            {isFailed && (
              <div style={{ fontSize: 13, color: "var(--mismatch)" }}>
                {ctx.error?.message ?? "Compression failed"}
                <Button
                  data-testid="zip-retry-btn"
                  variant="default"
                  size="sm"
                  style={{ marginLeft: 12 }}
                  onClick={() => send({ type: "RETRY" })}
                >
                  Retry
                </Button>
              </div>
            )}

            {isCompressing && ctx.progress && (
              <CompressingBanner
                entries={ctx.progress.entries}
                total={ctx.progress.total}
                pct={ctx.progress.pct}
              />
            )}

            {isCompressing && !ctx.progress && (
              <div
                data-testid="compressing-starting"
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  padding: "4px 0",
                }}
              >
                Starting compression…
              </div>
            )}

            {isBuilt && ctx.archive && <BuiltGate archive={ctx.archive} />}

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
                  {isBuilt
                    ? (ctx.archive?.entries.toLocaleString() ?? "—")
                    : (ctx.progress?.total.toLocaleString() ?? "—")}
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
                  entries
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
                  {isBuilt ? "1.38 GB" : "—"}
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
                  size
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
                  data-testid="sha256-stat"
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--ocr)",
                    fontFamily: "var(--mono-font, monospace)",
                    letterSpacing: ".02em",
                  }}
                >
                  {isBuilt ? (ctx.archive?.sha256 ?? "—") : "—"}
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
                  sha-256
                </div>
                {isBuilt && (
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--ink-4)",
                      fontFamily: "var(--mono-font, monospace)",
                      marginTop: 2,
                    }}
                  >
                    deterministic
                  </div>
                )}
              </div>
            </div>

            {/* Contents + download */}
            {isBuilt && (
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
                  <div
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                    }}
                  >
                    Archive contents
                  </div>
                  <Button
                    data-testid="download-zip-btn"
                    variant="default"
                    size="sm"
                    onClick={() => send({ type: "DOWNLOAD" })}
                  >
                    Download .zip
                  </Button>
                </div>
                <div style={{ padding: "14px 16px" }}>
                  <TreeView rows={ctx.tree} />
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div
            data-testid="zip-settings"
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
                Stage settings · Zip
              </h2>
              <div
                style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}
              >
                Archive format and reproducibility.
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
                    Deterministic build
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Sorted entries · fixed mtime · stripped metadata
                  </div>
                </div>
                <div>
                  <span
                    style={{
                      fontFamily: "var(--mono-font, monospace)",
                      fontSize: 11,
                      color: ctx.settings.deterministic
                        ? "var(--exact)"
                        : "var(--ink-4)",
                    }}
                  >
                    {ctx.settings.deterministic ? "on" : "off"}
                  </span>
                </div>
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
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>Format</div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Archive container
                  </div>
                </div>
                <div>
                  <span
                    style={{
                      fontFamily: "var(--mono-font, monospace)",
                      fontSize: 12,
                      color: "var(--ink-2)",
                    }}
                  >
                    {ctx.settings.format}
                  </span>
                </div>
              </div>
              <div
                style={{
                  padding: "13px 16px",
                  borderTop: "1px solid var(--border-1)",
                }}
              >
                {isBuilt && (
                  <Button
                    data-testid="zip-rebuild-btn"
                    variant="default"
                    size="sm"
                    onClick={() => send({ type: "REBUILD" })}
                  >
                    Re-build
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
