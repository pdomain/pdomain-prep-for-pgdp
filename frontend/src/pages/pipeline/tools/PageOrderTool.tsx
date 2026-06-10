/**
 * PageOrderTool — stage tool surface for the Page order stage.
 *
 * Renders the unified Order & Numbering workspace:
 *   - Banner: state indicator (reading folios / workspace / confirming / settled)
 *   - Ribbon: scan-level role colour bar (always visible)
 *   - Ledger: table or grid view of leaves with folio reconciliation chips
 *   - Run spine: editable run list (left rail in workspace)
 *   - Inspector: per-leaf workbench (right rail, opens on SELECT_LEAF)
 *   - Naming: output naming scheme controls (bottom bar in workspace)
 *   - Confirm gate: advance guarded by sequenceClean
 *
 * DCArtboard reference:
 *   docs/plans/design_handoff_pgdp_app/final/page_order/page-order-unified.jsx
 *
 * @see src/machines/tools/pageOrderTool.ts
 * @see src/pages/pipeline/toolSlot.tsx — F5.4 registration
 */

import { useMemo } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  pageOrderToolMachine,
  type PageOrderToolServices,
  type Leaf,
  type Run,
  type LeafRole,
  type LensKind,
} from "@/machines/tools/pageOrderTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Mock service adapter (replaced at I1)
// ---------------------------------------------------------------------------

function makePageOrderServices(_projectId: string): PageOrderToolServices {
  const mockLeaves: Leaf[] = Array.from({ length: 8 }, (_, i) => ({
    scan: i + 1,
    role: i === 3 ? "plate" : i === 5 ? "blank" : "text",
    runId: i === 3 || i === 5 ? null : i < 4 ? "front" : "body",
    ocrFolio: i === 3 || i === 5 ? null : String(i + 1),
    folioLabel: null,
    flags: i === 1 ? ["outOfSequence"] : i === 6 ? ["gap"] : [],
    ...(i === 3 ? { plateTag: "Plate I" } : {}),
  }));

  const mockRuns: Run[] = [
    {
      id: "front",
      label: "Front matter",
      style: "roman",
      start: { mode: "set", value: 1 },
      step: 1,
      span: [1, 3],
    },
    {
      id: "body",
      label: "Body",
      style: "arabic",
      start: { mode: "set", value: 1 },
      step: 1,
      span: [4, 8],
    },
  ];

  return {
    persistLeaf: () => Promise.resolve(),
    persistOrder: () => Promise.resolve(),
    persistRuns: () => Promise.resolve(),
    persistNaming: () => Promise.resolve(),
    confirmStage: () => Promise.resolve({ ok: true }),
    // expose fixtures for the mock FOLIOS_DONE initializer
    _mockLeaves: mockLeaves,
    _mockRuns: mockRuns,
  } as unknown as PageOrderToolServices;
}

// ---------------------------------------------------------------------------
// Leaf flag chip
// ---------------------------------------------------------------------------

const FLAG_DEFS: Record<string, { label: string; tone: string }> = {
  outOfSequence: { label: "out-of-seq", tone: "var(--mismatch)" },
  gap: { label: "gap", tone: "var(--ocr)" },
  duplicate: { label: "duplicate", tone: "var(--mismatch)" },
  misread: { label: "misread", tone: "var(--fuzzy)" },
  missingNumber: { label: "no-folio", tone: "var(--fuzzy)" },
  unnumbered: { label: "unnumbered", tone: "var(--fuzzy)" },
  marker: { label: "[blank]", tone: "var(--ink-3)" },
  countedBlank: { label: "blank·counted", tone: "var(--ocr)" },
  renumber: { label: "renumber", tone: "var(--accent)" },
  continues: { label: "continues", tone: "var(--exact)" },
};

const ROLE_TONE: Record<LeafRole, string> = {
  text: "var(--exact)",
  plate: "var(--ocr)",
  blank: "var(--ink-3)",
  skip: "var(--ink-4)",
  cover: "var(--fuzzy)",
};

function FlagChip({ kind }: { kind: string }) {
  const def = FLAG_DEFS[kind] ?? { label: kind, tone: "var(--fuzzy)" };
  return (
    <span
      data-testid={`po-flag-chip-${kind}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: 15,
        padding: "0 5px",
        borderRadius: 99,
        fontSize: 9,
        fontWeight: 600,
        fontFamily: "var(--mono-font, monospace)",
        background: `color-mix(in oklab, ${def.tone} 16%, rgba(12,12,16,0.78))`,
        color: def.tone,
        border: `1px solid color-mix(in oklab, ${def.tone} 45%, transparent)`,
      }}
    >
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 99,
          background: def.tone,
        }}
      />
      {def.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ribbon — colour bar showing roles
// ---------------------------------------------------------------------------

function Ribbon({ leaves }: { leaves: Leaf[] }) {
  return (
    <div
      data-testid="po-ribbon"
      style={{
        display: "flex",
        height: 8,
        borderRadius: 4,
        overflow: "hidden",
        gap: 1,
        background: "var(--bg-sunk)",
      }}
    >
      {leaves.map((leaf) => (
        <div
          key={leaf.scan}
          data-testid={`po-ribbon-scan-${leaf.scan}`}
          title={`scan ${leaf.scan} · ${leaf.role}`}
          style={{
            flex: 1,
            background: ROLE_TONE[leaf.role],
            opacity: leaf.flags.length > 0 ? 1 : 0.55,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaf row in table view
// ---------------------------------------------------------------------------

function LeafRow({
  leaf,
  run,
  selected,
  onClick,
}: {
  leaf: Leaf;
  run: Run | null;
  selected: boolean;
  onClick: () => void;
}) {
  const roleTone = ROLE_TONE[leaf.role];
  return (
    <div
      data-testid={`po-leaf-row-${leaf.scan}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 60px 1fr 80px 1fr 1fr",
        gap: 8,
        padding: "6px 10px",
        alignItems: "center",
        borderBottom: "1px solid var(--border-1)",
        background: selected
          ? "color-mix(in oklab, var(--accent) 7%, var(--bg-surface))"
          : "transparent",
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      {/* Scan number */}
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 10.5,
          color: "var(--ink-4)",
        }}
      >
        {leaf.scan}
      </span>
      {/* Role chip */}
      <span
        data-testid={`po-role-chip-${leaf.scan}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          height: 18,
          padding: "0 6px",
          borderRadius: 5,
          fontSize: 10,
          fontWeight: 600,
          background: `color-mix(in oklab, ${roleTone} 13%, transparent)`,
          color: roleTone,
          border: `1px solid color-mix(in oklab, ${roleTone} 35%, transparent)`,
        }}
      >
        {leaf.role}
      </span>
      {/* OCR folio */}
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          color: leaf.ocrFolio ? "var(--ink-2)" : "var(--ink-4)",
        }}
      >
        {leaf.ocrFolio ?? "—"}
      </span>
      {/* Computed label */}
      <span
        data-testid={`po-computed-${leaf.scan}`}
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          color: "var(--ink-1)",
          fontWeight: 600,
        }}
      >
        {leaf.folioLabel ?? "—"}
      </span>
      {/* Run */}
      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
        {run?.label ?? "—"}
      </span>
      {/* Flags */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {leaf.flags.map((f) => (
          <FlagChip key={f} kind={f} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------

function LeafInspector({
  leaf,
  run,
  onClose,
}: {
  leaf: Leaf;
  run: Run | null;
  onClose: () => void;
}) {
  return (
    <div
      data-testid={`po-inspector-${leaf.scan}`}
      style={{
        padding: "12px 14px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}
        >
          Scan {leaf.scan}
        </span>
        <button
          data-testid="po-inspector-close"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--ink-3)",
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "80px 1fr",
          gap: 6,
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--ink-4)" }}>Role</span>
        <span
          style={{
            color: ROLE_TONE[leaf.role],
            fontWeight: 600,
          }}
        >
          {leaf.role}
        </span>
        <span style={{ color: "var(--ink-4)" }}>Run</span>
        <span style={{ color: "var(--ink-2)" }}>{run?.label ?? "—"}</span>
        <span style={{ color: "var(--ink-4)" }}>OCR folio</span>
        <span style={{ fontFamily: "monospace", color: "var(--ink-1)" }}>
          {leaf.ocrFolio ?? "—"}
        </span>
        <span style={{ color: "var(--ink-4)" }}>Computed</span>
        <span
          style={{
            fontFamily: "monospace",
            fontWeight: 600,
            color: "var(--ink-1)",
          }}
        >
          {leaf.folioLabel ?? "—"}
        </span>
        {leaf.plateTag && (
          <>
            <span style={{ color: "var(--ink-4)" }}>Plate tag</span>
            <span style={{ fontFamily: "monospace", color: "var(--ocr)" }}>
              {leaf.plateTag}
            </span>
          </>
        )}
      </div>
      {leaf.flags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {leaf.flags.map((f) => (
            <FlagChip key={f} kind={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lens filter bar
// ---------------------------------------------------------------------------

const LENS_OPTIONS: { id: LensKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "outOfSequence", label: "Out-of-seq" },
  { id: "gap", label: "Gap" },
  { id: "duplicate", label: "Duplicate" },
  { id: "misread", label: "Misread" },
];

function LensBar({
  lens,
  onSetLens,
}: {
  lens: LensKind;
  onSetLens: (v: LensKind) => void;
}) {
  return (
    <div
      data-testid="po-lens-bar"
      style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
    >
      {LENS_OPTIONS.map((opt) => {
        const active = lens === opt.id;
        return (
          <button
            key={opt.id}
            data-testid={`po-lens-${opt.id}`}
            onClick={() => onSetLens(opt.id)}
            style={{
              padding: "3px 10px",
              height: 24,
              borderRadius: 6,
              border: active
                ? "1px solid color-mix(in oklab, var(--accent) 50%, var(--border-1))"
                : "1px solid var(--border-1)",
              background: active
                ? "color-mix(in oklab, var(--accent) 12%, transparent)"
                : "transparent",
              color: active ? "var(--accent)" : "var(--ink-2)",
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * PageOrderTool — the unified Order & Numbering workspace.
 *
 * Artboard DCArtboard states:
 *   - readingFolios: loading banner
 *   - workspace: full ledger + run spine + inspector
 *   - confirming: advance in progress
 *   - settled: locked, downstream stages consuming the order
 *
 * @see docs/plans/design_handoff_pgdp_app/final/page_order/page-order-unified.jsx
 */
export function PageOrderTool({
  stageId: _stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps) {
  const { projectId = "mock-project" } = useParams();

  const services = useMemo(() => makePageOrderServices(projectId), [projectId]);

  const [snapshot, send] = useActor(pageOrderToolMachine, {
    input: {
      projectId,
      stageIndex: 9,
      services,
    },
  });

  const ctx = snapshot.context;
  const isReadingFolios = snapshot.matches("readingFolios");
  const isWorkspace = snapshot.matches("workspace");
  const isConfirming = snapshot.matches("confirming");
  const isSettled = snapshot.matches("settled");
  const isInspectorOpen = snapshot.matches({
    workspace: { inspector: "open" },
  });

  // Auto-send FOLIOS_DONE from mock on mount (simulates the folio-reading phase)
  const hasLeaves = ctx.leaves.length > 0;

  // In mock mode: if we're still in readingFolios and have no leaves,
  // trigger the initial FOLIOS_DONE with mock data
  if (isReadingFolios && !hasLeaves) {
    const svcWithFixtures = services as unknown as {
      _mockLeaves?: typeof ctx.leaves;
      _mockRuns?: typeof ctx.runs;
    };
    const mockLeaves = svcWithFixtures._mockLeaves;
    const mockRuns = svcWithFixtures._mockRuns;
    if (mockLeaves && mockRuns) {
      // We use a setTimeout to avoid calling send during render
      setTimeout(() => {
        send({
          type: "FOLIOS_DONE",
          leaves: mockLeaves,
          runs: mockRuns,
          totals: {
            total: mockLeaves.length,
            scanned: mockLeaves.filter((l) => l.ocrFolio !== null).length,
            outOfSeq: 1,
            gaps: 1,
            duplicates: 0,
          },
        });
      }, 0);
    }
  }

  // Build run lookup
  const runById = useMemo(
    () => new Map<string, Run>(ctx.runs.map((r) => [r.id, r])),
    [ctx.runs],
  );

  // Filter leaves by lens
  const visibleLeaves = useMemo(() => {
    if (ctx.lens === "all") return ctx.leaves;
    return ctx.leaves.filter((l) => l.flags.includes(ctx.lens));
  }, [ctx.leaves, ctx.lens]);

  // Inspector leaf
  const inspectorLeaf =
    ctx.selectedLeaf !== null
      ? (ctx.leaves.find((l) => l.scan === ctx.selectedLeaf) ?? null)
      : null;

  // Totals summary
  const hasFlaggedLeaves =
    (ctx.totals?.outOfSeq ?? 0) > 0 || (ctx.totals?.duplicates ?? 0) > 0;

  return (
    <div
      data-testid={`page-order-tool`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Banner */}
      {isReadingFolios && (
        <div
          data-testid="po-banner-reading"
          style={{
            padding: "10px 16px",
            background: "color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          Reading folios… extracting printed numbers from each leaf.
        </div>
      )}

      {isConfirming && (
        <div
          data-testid="po-banner-confirming"
          style={{
            padding: "10px 16px",
            background: "color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))",
            borderRadius: 8,
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          Confirming page order…
        </div>
      )}

      {isSettled && (
        <div
          data-testid="po-banner-settled"
          style={{
            padding: "10px 16px",
            background:
              "color-mix(in oklab, var(--exact) 8%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--exact) 30%, var(--border-1))",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "var(--exact)" }}
          >
            Page order confirmed · {ctx.leaves.length} leaves locked
          </span>
        </div>
      )}

      {/* Error display */}
      {ctx.error && (
        <div
          data-testid="po-error"
          style={{
            padding: "8px 12px",
            background:
              "color-mix(in oklab, var(--mismatch) 8%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--mismatch) 30%, var(--border-1))",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--mismatch)",
          }}
        >
          {ctx.error.message}
        </div>
      )}

      {isWorkspace && (
        <>
          {/* Workspace status bar */}
          <div
            data-testid="po-workspace-banner"
            style={{
              padding: "10px 16px",
              background: hasFlaggedLeaves
                ? "color-mix(in oklab, var(--fuzzy) 8%, var(--bg-surface))"
                : "color-mix(in oklab, var(--exact) 8%, var(--bg-surface))",
              border: hasFlaggedLeaves
                ? "1px solid color-mix(in oklab, var(--fuzzy) 30%, var(--border-1))"
                : "1px solid color-mix(in oklab, var(--exact) 30%, var(--border-1))",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}
            >
              {ctx.leaves.length} leaves
              {ctx.totals && ctx.totals.outOfSeq > 0 && (
                <span style={{ color: "var(--mismatch)", marginLeft: 8 }}>
                  · {ctx.totals.outOfSeq} out-of-sequence
                </span>
              )}
              {ctx.totals && ctx.totals.duplicates > 0 && (
                <span style={{ color: "var(--mismatch)", marginLeft: 8 }}>
                  · {ctx.totals.duplicates} duplicate
                </span>
              )}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => send({ type: "CONFIRM_ADVANCE" })}
              disabled={hasFlaggedLeaves}
              data-testid="po-confirm-advance-btn"
            >
              Confirm & advance
            </Button>
          </div>

          {/* Ribbon */}
          <Ribbon leaves={ctx.leaves} />

          {/* Lens + view toolbar */}
          <div
            data-testid="po-toolbar"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <LensBar
              lens={ctx.lens}
              onSetLens={(v) => send({ type: "SET_LENS", value: v })}
            />
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: "inline-flex",
                padding: 2,
                gap: 2,
                background: "var(--bg-page)",
                border: "1px solid var(--border-1)",
                borderRadius: 6,
              }}
            >
              {(["table", "grid"] as const).map((v) => (
                <button
                  key={v}
                  data-testid={`po-view-${v}`}
                  onClick={() => send({ type: "SET_VIEW", value: v })}
                  style={{
                    padding: "3px 9px",
                    borderRadius: 4,
                    border:
                      ctx.view === v
                        ? "1px solid var(--border-2)"
                        : "1px solid transparent",
                    background:
                      ctx.view === v ? "var(--bg-surface)" : "transparent",
                    color: ctx.view === v ? "var(--ink-1)" : "var(--ink-3)",
                    fontSize: 11,
                    fontWeight: ctx.view === v ? 600 : 500,
                    cursor: "pointer",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Main layout: ledger + (inspector if open) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isInspectorOpen ? "1fr 280px" : "1fr",
              gap: 12,
              flex: 1,
              minHeight: 0,
            }}
          >
            {/* Ledger */}
            <div
              data-testid="po-ledger"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                overflow: "auto",
                flex: 1,
                minHeight: 200,
              }}
            >
              {/* Table header */}
              {ctx.view === "table" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px 60px 1fr 80px 1fr 1fr",
                    gap: 8,
                    padding: "6px 10px",
                    borderBottom: "1px solid var(--border-1)",
                    background: "var(--bg-page)",
                  }}
                >
                  {["#", "Role", "OCR folio", "Computed", "Run", "Flags"].map(
                    (h) => (
                      <span
                        key={h}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--ink-4)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {h}
                      </span>
                    ),
                  )}
                </div>
              )}

              {/* Rows */}
              {ctx.view === "table" ? (
                visibleLeaves.map((leaf) => (
                  <LeafRow
                    key={leaf.scan}
                    leaf={leaf}
                    run={leaf.runId ? (runById.get(leaf.runId) ?? null) : null}
                    selected={ctx.selectedLeaf === leaf.scan}
                    onClick={() =>
                      send({ type: "SELECT_LEAF", scan: leaf.scan })
                    }
                  />
                ))
              ) : (
                // Grid view
                <div
                  data-testid="po-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(8, 1fr)",
                    gap: 6,
                    padding: 10,
                  }}
                >
                  {visibleLeaves.map((leaf) => (
                    <div
                      key={leaf.scan}
                      data-testid={`po-grid-cell-${leaf.scan}`}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        send({ type: "SELECT_LEAF", scan: leaf.scan })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          send({ type: "SELECT_LEAF", scan: leaf.scan });
                        }
                      }}
                      style={{
                        aspectRatio: "3 / 4",
                        background: `color-mix(in oklab, ${ROLE_TONE[leaf.role]} 13%, var(--bg-raised))`,
                        border: `1.5px solid ${leaf.flags.length > 0 ? "var(--mismatch)" : "var(--border-1)"}`,
                        borderRadius: 4,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        gap: 2,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: 9,
                          color: "var(--ink-3)",
                        }}
                      >
                        {leaf.scan}
                      </span>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--ink-1)",
                        }}
                      >
                        {leaf.folioLabel ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inspector */}
            {isInspectorOpen && inspectorLeaf && (
              <LeafInspector
                leaf={inspectorLeaf}
                run={
                  inspectorLeaf.runId
                    ? (runById.get(inspectorLeaf.runId) ?? null)
                    : null
                }
                onClose={() => send({ type: "CLOSE_INSPECTOR" })}
              />
            )}
          </div>

          {/* Run spine summary */}
          <div
            data-testid="po-run-spine"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              padding: "10px 14px",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--ink-3)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginRight: 4,
              }}
            >
              Runs
            </span>
            {ctx.runs.map((run) => (
              <button
                key={run.id}
                data-testid={`po-run-chip-${run.id}`}
                onClick={() => send({ type: "EDIT_RUN", runId: run.id })}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 24,
                  padding: "0 8px",
                  borderRadius: 6,
                  border:
                    ctx.runEdit === run.id
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border-2)",
                  background:
                    ctx.runEdit === run.id
                      ? "color-mix(in oklab, var(--accent) 10%, transparent)"
                      : "var(--bg-raised)",
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: "var(--ink-3)",
                  }}
                >
                  {run.style}
                </span>
                {run.label}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => send({ type: "ADD_RUN" })}
              data-testid="po-add-run-btn"
            >
              + Add run
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
