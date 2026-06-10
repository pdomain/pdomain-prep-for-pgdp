/**
 * ProofPackTool — React surface for the Proof Pack stage tool.
 *
 * Drives `proofPackToolMachine`. Two tabs:
 * - **Overview** — Gate card + stats + contents tree + completeness bar
 * - **Settings** — Include toggles, file naming, re-assemble
 *
 * @see src/machines/tools/proofPackTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/proof_pack/proof-pack.jsx
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  proofPackToolMachine,
  type ProofPackToolServices,
  type TreeRow,
} from "@/machines/tools/proofPackTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

const MOCK_TREE: TreeRow[] = [
  { name: "images/", dir: true, d: 0 },
  { name: "p0001.png", d: 1, meta: "1.1 MB" },
  { name: "p0002.png", d: 1, meta: "1.0 MB" },
  { name: "text/", dir: true, d: 0 },
  { name: "p0001.txt", d: 1, meta: "2.4 KB" },
  { name: "p0002.txt", d: 1, meta: "2.2 KB" },
  { name: "illustrations/", dir: true, d: 0 },
  { name: "ill_001.png", d: 1, meta: "450 KB" },
  { name: "metadata.json", d: 0, meta: "8.2 KB" },
];

function makeMockProofPackServices(_projectId: string): ProofPackToolServices {
  return {
    assemblePack: (_pid, _include) =>
      Promise.resolve({
        tree: MOCK_TREE,
        completeness: { complete: 387, total: 387 },
      }),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GateCard({
  label,
  sub,
  ok,
}: {
  label: string;
  sub: string;
  ok: boolean;
}) {
  const color = ok ? "var(--exact)" : "var(--fuzzy)";
  return (
    <div
      data-testid={ok ? "gate-assembled" : "gate-incomplete"}
      style={{
        borderRadius: 10,
        border: `1px solid color-mix(in oklab, ${color} 40%, var(--border-1))`,
        background: `color-mix(in oklab, ${color} 7%, var(--bg-surface))`,
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
          background: `color-mix(in oklab, ${color} 18%, var(--bg-surface))`,
          color,
          display: "grid",
          placeItems: "center",
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {ok ? "✓" : "!"}
      </div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}>
          {label}
        </div>
        <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-3)" }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "ink-1",
  sub,
}: {
  label: string;
  value: string | number;
  tone?: string;
  sub?: string;
}) {
  return (
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
          color: `var(--${tone})`,
          fontFamily: "var(--mono-font, monospace)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--ink-4)",
            fontFamily: "var(--mono-font, monospace)",
            marginTop: 2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function TreeView({ rows }: { rows: TreeRow[] }) {
  return (
    <div
      data-testid="proof-pack-tree"
      style={{
        fontFamily: "var(--mono-font, monospace)",
        fontSize: 11.5,
        lineHeight: 1.9,
        color: "var(--ink-2)",
      }}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: (row.d ?? 0) * 18,
          }}
        >
          <span style={{ color: row.dir ? "var(--accent)" : "var(--ink-4)" }}>
            {row.dir ? "▸" : "·"}
          </span>
          <span
            style={{
              color: row.dir ? "var(--ink-1)" : "var(--ink-2)",
              fontWeight: row.dir ? 600 : 400,
            }}
          >
            {row.name}
          </span>
          <span style={{ flex: 1 }} />
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

export function ProofPackTool({
  stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = makeMockProofPackServices(projectId);

  const [snapshot, send] = useActor(proofPackToolMachine, {
    input: { projectId, stageIndex: 18, services },
  });

  const [tab, setTab] = useState("overview");

  const ctx = snapshot.context;
  const isAssembling = snapshot.matches("assembling");
  const isAssembled = snapshot.matches("assembled");
  const isIncomplete = snapshot.matches("incomplete");
  const isFailed = snapshot.matches("failed");

  if (isAssembling) {
    return (
      <div
        data-testid="proof-pack-assembling"
        data-stage-id={stageId}
        style={{ padding: "20px 28px", color: "var(--ink-3)", fontSize: 13 }}
      >
        Assembling proof pack…
      </div>
    );
  }

  if (isFailed) {
    return (
      <div
        data-testid="proof-pack-failed"
        style={{
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--mismatch)" }}>
          {ctx.error?.message ?? "Assembly failed"}
        </div>
        <Button
          data-testid="proof-pack-retry-btn"
          variant="default"
          size="sm"
          onClick={() => send({ type: "RETRY" })}
        >
          Retry
        </Button>
      </div>
    );
  }

  const complete = ctx.completeness?.complete ?? 0;
  const total = ctx.completeness?.total ?? 0;
  const completenessPct = total > 0 ? (complete / total) * 100 : 0;

  return (
    <div
      data-testid="proof-pack-tool"
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
            <GateCard
              ok={isAssembled}
              label={
                isAssembled
                  ? `Proof pack assembled · ${total} pages`
                  : `Incomplete — ${complete} / ${total} pages have both files`
              }
              sub={
                isAssembled
                  ? "Page images + proofer text + illustrations + project metadata, bundled in the layout PGDP expects."
                  : "Some pages are missing an image or text file. Use Open missing to navigate to the stage that owes the file."
              }
            />

            <div style={{ display: "flex", gap: 12 }}>
              <StatTile label="pages" value={total} tone="exact" />
              <StatTile
                label="text files"
                value={
                  ctx.tree.filter((r) => !r.dir && r.name.endsWith(".txt"))
                    .length
                }
              />
              <StatTile
                label="illustrations"
                value={
                  ctx.tree.filter((r) => !r.dir && r.name.startsWith("ill"))
                    .length
                }
                tone="ocr"
              />
              <StatTile label="bundle size" value="1.4 GB" />
            </div>

            {isIncomplete && (
              <Button
                data-testid="open-missing-btn"
                variant="default"
                size="sm"
                onClick={() => send({ type: "OPEN_MISSING", pageId: "" })}
              >
                Open missing
              </Button>
            )}

            {/* Contents tree */}
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
                    Contents
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    What gets bundled into the proof pack
                  </div>
                </div>
                <Button
                  data-testid="preview-file-btn"
                  variant="default"
                  size="sm"
                  onClick={() => send({ type: "PREVIEW_FILE", fileId: "" })}
                >
                  Preview file
                </Button>
              </div>
              <div style={{ padding: "14px 16px" }}>
                <TreeView rows={ctx.tree} />
              </div>
            </div>

            {/* Completeness bar */}
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                  marginBottom: 10,
                }}
              >
                Per-page completeness
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  marginBottom: 10,
                }}
              >
                Every page must carry both an image and a text file
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 99,
                    background: "var(--bg-sunk)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    data-testid="completeness-bar"
                    style={{
                      width: `${completenessPct}%`,
                      height: "100%",
                      background: "var(--exact)",
                      transition: "width 0.3s",
                    }}
                  />
                </div>
                <span
                  data-testid="completeness-label"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--exact)",
                    fontFamily: "var(--mono-font, monospace)",
                  }}
                >
                  {complete} / {total}
                </span>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div
            data-testid="proof-pack-settings"
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
                Stage settings · Proof pack
              </h2>
              <div
                style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}
              >
                What to include and how files are named.
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
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border-1)",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  <input
                    data-testid="include-images-toggle"
                    type="checkbox"
                    checked={ctx.include.images}
                    onChange={() =>
                      send({
                        type: "SET_INCLUDE",
                        patch: { images: !ctx.include.images },
                      })
                    }
                  />
                  Include page images
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    Bilevel page PNGs
                  </span>
                </label>
              </div>
              <div
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border-1)",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  <input
                    data-testid="include-text-toggle"
                    type="checkbox"
                    checked={ctx.include.text}
                    onChange={() =>
                      send({
                        type: "SET_INCLUDE",
                        patch: { text: !ctx.include.text },
                      })
                    }
                  />
                  Include proofer text
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    Per-page UTF-8 with markup
                  </span>
                </label>
              </div>
              <div
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border-1)",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  <input
                    data-testid="include-illustrations-toggle"
                    type="checkbox"
                    checked={ctx.include.illustrations}
                    onChange={() =>
                      send({
                        type: "SET_INCLUDE",
                        patch: { illustrations: !ctx.include.illustrations },
                      })
                    }
                  />
                  Include illustration crops
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    Extracted at stage 17
                  </span>
                </label>
              </div>
              <div style={{ padding: "10px 16px" }}>
                <Button
                  data-testid="reassemble-btn"
                  variant="default"
                  size="sm"
                  onClick={() => send({ type: "REASSEMBLE" })}
                >
                  Re-assemble
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
