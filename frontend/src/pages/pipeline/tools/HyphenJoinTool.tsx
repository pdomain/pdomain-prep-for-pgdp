/**
 * HyphenJoinTool.tsx — React surface for the Hyphen join stage tool.
 *
 * Registered in TOOL_REGISTRY as `hyphen_join`.
 * Tabs:
 *  - Overview      — totals summary
 *  - Queue         — undecided / flagged cases awaiting ACCEPT_JOIN / KEEP_HYPHEN
 *  - Joined        — auto-joined cases awaiting VALIDATE_JOIN
 *  - Mismatch      — corpus-mismatch cases awaiting FIX_MISMATCH
 *  - Page workbench — per-page case list + before/after viewer
 *  - Settings      — minimal F5 placeholder
 *
 * F5 mock-only: scanHyphenation is a no-op returning mock data on mount.
 * I1: real backend POST /api/.../hyphen_join/scan.
 *
 * Surface controls wired (F5.5 fix round):
 *  - OPEN_GLOBAL_LIBRARY — "Edit global library" button visible in every tab subhead
 *  - Page workbench tab — OPEN_PAGE / CLOSE_PAGE / PREV_PAGE / NEXT_PAGE / APPLY_CONTINUE
 *
 * @see src/machines/tools/hyphenJoin.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-hyphen-join.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/hyphen_join/hyphen.jsx — canvas authority
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { ToolSlotProps } from "../toolSlot";
import {
  hyphenJoinMachine,
  type HyphenCase,
  type HyphenMode,
  type HyphenJoinEvent,
  type HyphenJoinServices,
} from "@/machines/tools/hyphenJoin";
import { buildRealHyphenJoinServices } from "@/services/tools/hyphenJoin";

// ---------------------------------------------------------------------------
// Mock page-workbench data (UI state seed — not from API at I1)
// ---------------------------------------------------------------------------

const MOCK_PAGE_CASES: HyphenCase[] = [
  {
    caseId: "hp1",
    kind: "auto",
    head: "some",
    tail: "thing",
    line: 3,
    page: "p0004",
    status: "joined",
    validated: false,
    conf: 0.9,
    book: { inBody: true, joinedElsewhere: true, mismatch: false },
  },
  {
    caseId: "hp2",
    kind: "auto",
    head: "every",
    tail: "body",
    line: 11,
    page: "p0004",
    status: "undecided",
    validated: false,
    conf: 0.71,
    book: { inBody: false, joinedElsewhere: false, mismatch: false },
  },
  {
    caseId: "hp3",
    kind: "crosspage",
    head: "after",
    tail: "noon",
    line: 38,
    page: "p0004",
    status: "crosspage",
    validated: false,
    conf: 0.85,
    book: { inBody: true, joinedElsewhere: false, mismatch: false },
  },
];

// ---------------------------------------------------------------------------
// Case row sub-components
// ---------------------------------------------------------------------------

function CaseActionButtons({
  c,
  send,
}: {
  c: HyphenCase;
  send: (event: HyphenJoinEvent) => void;
}): ReactNode {
  if (c.status === "undecided" || c.status === "flagged") {
    return (
      <div style={{ display: "flex", gap: 4 }}>
        <button
          data-testid={`accept-join-${c.caseId}`}
          onClick={() => send({ type: "ACCEPT_JOIN", caseId: c.caseId })}
          style={{
            padding: "3px 8px",
            borderRadius: 4,
            border: "1px solid var(--exact)",
            background:
              "color-mix(in oklab, var(--exact) 10%, var(--bg-surface))",
            cursor: "pointer",
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--exact)",
          }}
        >
          Join
        </button>
        <button
          data-testid={`keep-hyphen-${c.caseId}`}
          onClick={() => send({ type: "KEEP_HYPHEN", caseId: c.caseId })}
          style={{
            padding: "3px 8px",
            borderRadius: 4,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 10.5,
            color: "var(--ink-3)",
          }}
        >
          Keep
        </button>
      </div>
    );
  }

  if ((c.status === "joined" || c.status === "crosspage") && !c.validated) {
    return (
      <button
        data-testid={`validate-join-${c.caseId}`}
        onClick={() => send({ type: "VALIDATE_JOIN", caseId: c.caseId })}
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid var(--ocr)",
          background: "color-mix(in oklab, var(--ocr) 10%, var(--bg-surface))",
          cursor: "pointer",
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--ocr)",
        }}
      >
        Validate
      </button>
    );
  }

  if (c.status === "mismatch") {
    return (
      <button
        data-testid={`fix-mismatch-${c.caseId}`}
        onClick={() => send({ type: "FIX_MISMATCH", caseId: c.caseId })}
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid var(--fuzzy)",
          background:
            "color-mix(in oklab, var(--fuzzy) 10%, var(--bg-surface))",
          cursor: "pointer",
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--fuzzy)",
        }}
      >
        Fix
      </button>
    );
  }

  if (c.validated) {
    return (
      <span style={{ fontSize: 11, color: "var(--exact)", fontWeight: 600 }}>
        Validated
      </span>
    );
  }

  return null;
}

function HyphenCaseRow({
  c,
  isSelected,
  send,
}: {
  c: HyphenCase;
  isSelected: boolean;
  send: (event: HyphenJoinEvent) => void;
}): ReactNode {
  const statusTone: Record<HyphenCase["status"], string> = {
    undecided: "var(--fuzzy)",
    flagged: "var(--mismatch)",
    joined: "var(--ocr)",
    crosspage: "var(--ocr)",
    validated: "var(--exact)",
    mismatch: "var(--fuzzy)",
  };

  return (
    <div
      data-testid={`hyphen-case-row-${c.caseId}`}
      role="button"
      tabIndex={0}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 60px 80px 60px 100px",
        gap: 8,
        padding: "8px 12px",
        borderTop: "1px solid var(--border-1)",
        alignItems: "center",
        background: isSelected
          ? "color-mix(in oklab, var(--accent) 5%, var(--bg-surface))"
          : "transparent",
        cursor: "pointer",
      }}
      onClick={() => send({ type: "NEXT_CASE" })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") send({ type: "NEXT_CASE" });
      }}
    >
      <div>
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 14,
            color: "var(--ink-1)",
            fontWeight: 500,
          }}
        >
          {c.head}
          <span style={{ color: "var(--ink-4)", margin: "0 1px" }}>-</span>
          {c.tail}
        </span>
        <span
          style={{
            marginLeft: 8,
            fontFamily: "Georgia, serif",
            fontSize: 13,
            color: statusTone[c.status],
            fontStyle: "italic",
          }}
        >
          {c.head + c.tail}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--mono-font)",
          fontSize: 11,
          color: "var(--ink-4)",
        }}
      >
        {c.page}:{c.line}
      </span>
      <span
        style={{
          fontSize: 10.5,
          padding: "2px 6px",
          borderRadius: 3,
          background: `color-mix(in oklab, ${statusTone[c.status]} 14%, var(--bg-raised))`,
          color: statusTone[c.status],
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {c.status}
      </span>
      <span
        style={{
          fontFamily: "var(--mono-font)",
          fontSize: 11,
          color:
            c.conf >= 0.85
              ? "var(--exact)"
              : c.conf >= 0.7
                ? "var(--ocr)"
                : "var(--fuzzy)",
          fontWeight: 600,
        }}
      >
        {Math.round(c.conf * 100)}%
      </span>
      <CaseActionButtons c={c} send={send} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page workbench panel
// ---------------------------------------------------------------------------

/**
 * HyphenPageWorkbenchPanel — per-page case list + before/after viewer.
 *
 * Wired events: OPEN_PAGE, CLOSE_PAGE, PREV_PAGE, NEXT_PAGE, APPLY_CONTINUE.
 * Canvas reference: hyphen.jsx HyphenPageWorkbench (lines 1059–1193).
 *
 * The panel receives `pageId` from machine context (set by OPEN_PAGE).
 * When no page is open the panel prompts the user to open one from a case row.
 */
function HyphenPageWorkbenchPanel({
  pageId,
  cases,
  send,
}: {
  pageId: string | null;
  cases: HyphenCase[];
  send: (event: HyphenJoinEvent) => void;
}): ReactNode {
  // Use mock page cases when no real backend yet (F5). I1 will filter by pageId.
  const pageCases = pageId ? MOCK_PAGE_CASES : ([] as HyphenCase[]);

  const pageCounts = {
    crosspage: pageCases.filter((c) => c.kind === "crosspage").length,
    validated: pageCases.filter((c) => c.validated).length,
    joined: pageCases.filter((c) => c.status === "joined" && !c.validated)
      .length,
    undecided: pageCases.filter((c) => c.status === "undecided").length,
    flagged: pageCases.filter((c) => c.status === "flagged").length,
  };

  void cases; // will filter by pageId at I1

  if (!pageId) {
    return (
      <div
        data-testid="hyphen-workbench-no-page"
        style={{
          flex: 1,
          padding: "32px 18px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          color: "var(--ink-3)",
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink-2)" }}>
          No page open
        </div>
        <div
          style={{ fontSize: 12, color: "var(--ink-4)", textAlign: "center" }}
        >
          Open a page from any case row in the Queue or Joined tab.
        </div>
        <button
          data-testid="hyphen-workbench-open-mock"
          onClick={() => send({ type: "OPEN_PAGE", pageId: "p0004" })}
          style={{
            marginTop: 6,
            padding: "5px 14px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 11.5,
            color: "var(--ink-2)",
          }}
        >
          Open p0004 (demo)
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="hyphen-workbench-panel"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Workbench header */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-1)",
          background: "var(--bg-raised)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
          >
            Page workbench
            <span
              style={{
                marginLeft: 8,
                fontFamily: "var(--mono-font)",
                fontSize: 11,
                color: "var(--ink-3)",
                fontWeight: 400,
              }}
            >
              {pageId}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>
            {pageCounts.crosspage} cross-page · {pageCounts.validated} validated
            · {pageCounts.joined} auto-joined · {pageCounts.undecided} undecided
            · {pageCounts.flagged} flagged
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            data-testid="hyphen-workbench-prev-page"
            onClick={() => send({ type: "PREV_PAGE" })}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: "1px solid var(--border-2)",
              background: "var(--bg-surface)",
              cursor: "pointer",
              fontSize: 11.5,
              color: "var(--ink-2)",
            }}
          >
            Prev page
          </button>
          <button
            data-testid="hyphen-workbench-next-page"
            onClick={() => send({ type: "NEXT_PAGE" })}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: "1px solid var(--border-2)",
              background: "var(--bg-surface)",
              cursor: "pointer",
              fontSize: 11.5,
              color: "var(--ink-2)",
            }}
          >
            Next page
          </button>
          <div
            style={{
              width: 1,
              height: 20,
              background: "var(--border-2)",
              margin: "0 2px",
            }}
          />
          <button
            data-testid="hyphen-workbench-apply-continue"
            onClick={() => send({ type: "APPLY_CONTINUE" })}
            style={{
              padding: "4px 12px",
              borderRadius: 5,
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-ink, #fff)",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            Apply &amp; Continue
          </button>
          <button
            data-testid="hyphen-workbench-close"
            onClick={() => send({ type: "CLOSE_PAGE" })}
            style={{
              padding: "4px 10px",
              borderRadius: 5,
              border: "1px solid var(--border-2)",
              background: "var(--bg-surface)",
              cursor: "pointer",
              fontSize: 11.5,
              color: "var(--ink-3)",
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Content: left case list + right before/after placeholder */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          gap: 12,
          padding: "12px 16px",
        }}
      >
        {/* Left: cases on this page */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid var(--border-1)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
            }}
          >
            Cases on {pageId} · {pageCases.length} hyphens
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {pageCases.map((c) => {
              const statusTone: Record<HyphenCase["status"], string> = {
                undecided: "var(--fuzzy)",
                flagged: "var(--mismatch)",
                joined: "var(--ocr)",
                crosspage: "var(--ocr)",
                validated: "var(--exact)",
                mismatch: "var(--fuzzy)",
              };
              return (
                <div
                  key={c.caseId}
                  data-testid={`workbench-case-row-${c.caseId}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderRadius: 5,
                    background: "var(--bg-raised)",
                    border: `1px solid color-mix(in oklab, ${statusTone[c.status]} 30%, var(--border-1))`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "Georgia, serif",
                      fontSize: 12.5,
                      color: "var(--ink-1)",
                    }}
                  >
                    {c.head}-{c.tail}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono-font)",
                      fontSize: 10,
                      color: "var(--ink-4)",
                    }}
                  >
                    :{c.line}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      padding: "1px 5px",
                      borderRadius: 3,
                      background: `color-mix(in oklab, ${statusTone[c.status]} 14%, var(--bg-surface))`,
                      color: statusTone[c.status],
                      fontWeight: 600,
                    }}
                  >
                    {c.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: before/after viewer placeholder (wired at I1) */}
        <div
          data-testid="hyphen-workbench-viewer"
          style={{
            display: "grid",
            gridTemplateRows: "1fr",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              flex: 1,
            }}
          >
            <div
              data-testid="hyphen-workbench-before"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--border-1)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                }}
              >
                Before
              </div>
              <div
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  fontSize: 12,
                  color: "var(--ink-3)",
                  fontStyle: "italic",
                }}
              >
                Page text before join decisions. Wired at I1.
              </div>
            </div>
            <div
              data-testid="hyphen-workbench-after"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--border-1)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                }}
              >
                After
              </div>
              <div
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  fontSize: 12,
                  color: "var(--ink-3)",
                  fontStyle: "italic",
                }}
              >
                Page text after join decisions. Wired at I1.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function HyphenOverviewTab({
  totals,
}: {
  totals: {
    total: number;
    joined: number;
    validated: number;
    undecided: number;
    flagged: number;
    mismatch: number;
    unvalidated: number;
  } | null;
}): ReactNode {
  const t = totals ?? {
    total: 0,
    joined: 0,
    validated: 0,
    undecided: 0,
    flagged: 0,
    mismatch: 0,
    unvalidated: 0,
  };

  const stats = [
    { label: "total", value: t.total, tone: "var(--ink-1)" },
    {
      label: "undecided",
      value: t.undecided,
      tone: t.undecided > 0 ? "var(--fuzzy)" : "var(--ink-2)",
    },
    { label: "joined", value: t.joined, tone: "var(--ocr)" },
    { label: "validated", value: t.validated, tone: "var(--exact)" },
    {
      label: "mismatch",
      value: t.mismatch,
      tone: t.mismatch > 0 ? "var(--mismatch)" : "var(--ink-2)",
    },
    {
      label: "unvalidated",
      value: t.unvalidated,
      tone: t.unvalidated > 0 ? "var(--fuzzy)" : "var(--ink-2)",
    },
  ];

  return (
    <div
      data-testid="hyphen-overview-tab"
      style={{
        flex: 1,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 1,
          background: "var(--border-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            data-testid={`hyphen-stat-${s.label}`}
            style={{
              background: "var(--bg-surface)",
              padding: "14px 12px 12px",
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 18,
                fontWeight: 600,
                color: s.tone,
                fontFamily: "var(--mono-font, monospace)",
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px dashed var(--border-2)",
          background: "var(--bg-raised)",
          fontSize: 11.5,
          color: "var(--ink-4)",
        }}
      >
        Word-frequency chart and corpus comparison wired at I1.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

type HyphenTab =
  | "overview"
  | "queue"
  | "joined"
  | "mismatch"
  | "workbench"
  | "settings";

function HyphenTabBar({
  active,
  onChange,
  counts,
}: {
  active: HyphenTab;
  onChange: (tab: HyphenTab) => void;
  counts: { queue: number; joined: number; mismatch: number };
}): ReactNode {
  const labels: Record<HyphenTab, string> = {
    overview: "Overview",
    queue: `Queue (${counts.queue})`,
    joined: `Joined (${counts.joined})`,
    mismatch: `Mismatch (${counts.mismatch})`,
    workbench: "Page workbench",
    settings: "Settings",
  };

  return (
    <div
      data-testid="hyphen-tab-bar"
      style={{
        display: "flex",
        gap: 2,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-raised)",
      }}
    >
      {(
        [
          "overview",
          "queue",
          "joined",
          "mismatch",
          "workbench",
          "settings",
        ] as const
      ).map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            data-testid={`hyphen-tab-${tab}`}
            onClick={() => onChange(tab)}
            style={{
              padding: "9px 14px",
              border: "none",
              borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              background: "transparent",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--ink-1)" : "var(--ink-3)",
            }}
          >
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case list panel (queue / joined / mismatch)
// ---------------------------------------------------------------------------

const MODE_MAP: Record<"queue" | "joined" | "mismatch", HyphenMode> = {
  queue: "queue",
  joined: "joined",
  mismatch: "mismatch",
};

function HyphenCaseList({
  cases,
  mode,
  cursor,
  send,
}: {
  cases: HyphenCase[];
  mode: HyphenMode;
  cursor: number;
  send: (event: HyphenJoinEvent) => void;
}): ReactNode {
  const filtered = cases.filter((c) => {
    if (mode === "queue")
      return c.status === "undecided" || c.status === "flagged";
    if (mode === "joined")
      return c.status === "joined" || c.status === "crosspage";
    return c.status === "mismatch";
  });

  return (
    <div
      data-testid={`hyphen-case-list-${mode}`}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 60px 80px 60px 100px",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-1)",
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--ink-4)",
        }}
      >
        <span>Word pair</span>
        <span>Page</span>
        <span>Status</span>
        <span>Conf</span>
        <span>Action</span>
      </div>
      {filtered.length === 0 ? (
        <div
          style={{
            padding: "16px 12px",
            fontSize: 12,
            color: "var(--ink-4)",
            textAlign: "center",
          }}
        >
          No cases in this view.
        </div>
      ) : (
        filtered.map((c, i) => (
          <HyphenCaseRow
            key={c.caseId}
            c={c}
            isSelected={i === cursor}
            send={send}
          />
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main HyphenJoinTool
// ---------------------------------------------------------------------------

export function HyphenJoinTool({
  stageId,
  runnerRef,
  _testServices,
}: ToolSlotProps & { _testServices?: HyphenJoinServices }): ReactNode {
  void runnerRef; // wired at I1

  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = useMemo(
    () => _testServices ?? buildRealHyphenJoinServices(),
    [_testServices],
  );

  const [snapshot, send] = useActor(hyphenJoinMachine, {
    input: { projectId, stageIndex: 6, services },
  });

  const { cases, totals, mode, cursor } = snapshot.context;
  const [activeTab, setActiveTab] = useState<HyphenTab>("queue");

  const isScanning = snapshot.matches("scanning");
  const isFailed = snapshot.matches("failed");
  const isSettled = snapshot.matches("settled");
  const isReviewing = snapshot.matches("reviewing");

  // Sync tab to mode when machine mode changes
  const tabForMode: Record<HyphenMode, HyphenTab> = {
    queue: "queue",
    joined: "joined",
    mismatch: "mismatch",
  };

  const counts = {
    queue: cases.filter(
      (c) => c.status === "undecided" || c.status === "flagged",
    ).length,
    joined: cases.filter(
      (c) => c.status === "joined" || c.status === "crosspage",
    ).length,
    mismatch: cases.filter((c) => c.status === "mismatch").length,
  };

  const handleTabChange = (tab: HyphenTab) => {
    setActiveTab(tab);
    const modeTab = tab as keyof typeof MODE_MAP;
    if (modeTab in MODE_MAP) {
      send({ type: "SET_MODE", mode: MODE_MAP[modeTab] });
    }
  };

  void tabForMode;

  if (isScanning) {
    return (
      <div
        data-testid="hyphen-tool-scanning"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Scanning hyphenation patterns…
      </div>
    );
  }

  if (isFailed) {
    return (
      <div
        data-testid="hyphen-tool-failed"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <div style={{ color: "var(--mismatch)", fontSize: 13 }}>
          Scan failed. {snapshot.context.error?.message}
        </div>
        <button
          data-testid="hyphen-retry"
          onClick={() => send({ type: "RETRY" })}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-ink, #fff)",
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (isSettled) {
    return (
      <div
        data-testid="hyphen-tool-settled"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--exact)",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Hyphenation review complete.
      </div>
    );
  }

  return (
    <div
      data-testid="hyphen-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <HyphenTabBar
        active={activeTab}
        onChange={handleTabChange}
        counts={counts}
      />

      {activeTab === "overview" ? <HyphenOverviewTab totals={totals} /> : null}

      {activeTab === "workbench" ? (
        <HyphenPageWorkbenchPanel
          pageId={snapshot.context.pageId}
          cases={cases}
          send={send}
        />
      ) : null}

      {activeTab === "settings" ? (
        <div
          data-testid="hyphen-settings-tab"
          style={{
            flex: 1,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}
              >
                Stage settings · Hyphen join
              </div>
              <div
                style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}
              >
                Join threshold, per-word overrides, cross-page handling. (I1)
              </div>
            </div>
            <button
              data-testid="hyphen-open-global-library"
              onClick={() => send({ type: "OPEN_GLOBAL_LIBRARY" })}
              style={{
                padding: "5px 12px",
                borderRadius: 5,
                border: "1px solid var(--border-2)",
                background: "var(--bg-surface)",
                cursor: "pointer",
                fontSize: 11.5,
                color: "var(--ink-2)",
                whiteSpace: "nowrap",
              }}
            >
              Edit global library
            </button>
          </div>
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px dashed var(--border-2)",
              background: "var(--bg-raised)",
              fontSize: 11.5,
              color: "var(--ink-4)",
            }}
          >
            Settings panel wired at I1 via stageSettings machine pattern.
          </div>
        </div>
      ) : null}

      {isReviewing &&
      (activeTab === "queue" ||
        activeTab === "joined" ||
        activeTab === "mismatch") ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "12px 16px",
            gap: 12,
          }}
        >
          {/* Status banner with global-library button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 8,
              border:
                "1px solid color-mix(in oklab, var(--ocr) 35%, var(--border-1))",
              background:
                "color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))",
            }}
          >
            <span
              style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}
            >
              {counts.queue + counts.mismatch} case
              {counts.queue + counts.mismatch === 1 ? "" : "s"} need decisions ·{" "}
              {counts.joined} unvalidated join
              {counts.joined === 1 ? "" : "s"}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                data-testid="hyphen-open-global-library"
                onClick={() => send({ type: "OPEN_GLOBAL_LIBRARY" })}
                style={{
                  padding: "3px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--border-2)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                Edit global library
              </button>
              <button
                data-testid="hyphen-nav-prev"
                onClick={() => send({ type: "PREV_CASE" })}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border-2)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                Prev
              </button>
              <span
                style={{
                  fontFamily: "var(--mono-font)",
                  fontSize: 11,
                  color: "var(--ink-4)",
                  alignSelf: "center",
                }}
              >
                {cursor + 1}
              </span>
              <button
                data-testid="hyphen-nav-next"
                onClick={() => send({ type: "NEXT_CASE" })}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--border-2)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                  fontSize: 11,
                  color: "var(--ink-3)",
                }}
              >
                Next
              </button>
            </div>
          </div>

          <HyphenCaseList
            cases={cases}
            mode={mode}
            cursor={cursor}
            send={send}
          />
        </div>
      ) : null}
    </div>
  );
}
