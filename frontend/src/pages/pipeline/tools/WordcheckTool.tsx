/**
 * WordcheckTool.tsx — React surface for the Wordcheck / Scannocheck stage tool.
 *
 * Registered in TOOL_REGISTRY as `wordcheck` and `scannocheck`.
 * Two parallel regions (suspects + listBuilder) visualised in two tabs:
 *  - Overview  — suspect totals + list totals derived from machine context
 *  - Settings  — requirePreviewToCommit placeholder (F5; wired at I1)
 *
 * F5 mock-only: SCAN_DONE is simulated on mount; services are no-ops.
 * I1: real SSE actor feeds SCAN_PROGRESS/SCAN_DONE; backend wired.
 *
 * @see src/machines/tools/wordcheckTool.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-wordcheck.yaml
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo, useEffect, useState } from "react";
import type { ToolSlotProps } from "../toolSlot";
import {
  wordcheckToolMachine,
  type WordcheckToolServices,
  type Suspect,
} from "@/machines/tools/wordcheckTool";

// ---------------------------------------------------------------------------
// Mock services (F5 — replaced at I1)
// ---------------------------------------------------------------------------

function createMockWordcheckServices(): WordcheckToolServices {
  return {
    async acceptDictionaryFixes(_pid) {
      return { fixedIds: [] };
    },
    async acceptHighConfidence(_pid) {
      return { acceptedIds: [] };
    },
    async promoteToLibrary(_pid) {
      return {
        good: 0,
        bad: 0,
        bookGood: 0,
        bookBad: 0,
        libraryGood: 0,
        libraryBad: 0,
      };
    },
    async confirmStage(_pid) {
      return { ok: true };
    },
  };
}

const MOCK_SUSPECTS: Suspect[] = [
  {
    id: "sw1",
    word: "tbe",
    fix: "the",
    ctxL: "…saw ",
    ctxR: " light…",
    type: "dictFail",
    page: "p0002",
    line: 14,
    rule: "dict",
    score: 0.62,
  },
  {
    id: "sw2",
    word: "ligbt",
    fix: "light",
    ctxL: "…tbe ",
    ctxR: " and…",
    type: "dictFail",
    page: "p0002",
    line: 14,
    rule: "dict",
    score: 0.68,
  },
  {
    id: "sw3",
    word: "ond",
    fix: "and",
    ctxL: "…light ",
    ctxR: " the…",
    type: "dictFail",
    page: "p0003",
    line: 7,
    rule: "dict",
    score: 0.71,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreTone(score: number): string {
  if (score >= 0.8) return "var(--ocr)";
  if (score >= 0.65) return "var(--fuzzy)";
  return "var(--mismatch)";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SuspectRow({
  suspect,
  onFix,
  onKeep,
  onViewOnPage,
}: {
  suspect: Suspect;
  onFix: () => void;
  onKeep: () => void;
  onViewOnPage: () => void;
}): ReactNode {
  return (
    <div
      data-testid={`suspect-row-${suspect.id}`}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 80px 80px 60px 110px",
        gap: 8,
        padding: "8px 12px",
        borderTop: "1px solid var(--border-1)",
        alignItems: "center",
        fontSize: 12.5,
      }}
    >
      <div>
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 14,
            color: "var(--mismatch)",
            fontWeight: 600,
          }}
        >
          {suspect.word}
        </span>
        {suspect.fix ? (
          <>
            <span
              style={{ margin: "0 4px", color: "var(--ink-4)", fontSize: 11 }}
            >
              →
            </span>
            <span
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 14,
                color: "var(--exact)",
                fontWeight: 500,
              }}
            >
              {suspect.fix}
            </span>
          </>
        ) : null}
        <span
          style={{
            marginLeft: 8,
            fontFamily: "var(--mono-font)",
            fontSize: 10.5,
            color: "var(--ink-4)",
          }}
        >
          {suspect.ctxL}
          <strong style={{ color: "var(--mismatch)" }}>{suspect.word}</strong>
          {suspect.ctxR}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--mono-font)",
          fontSize: 11,
          color: "var(--ink-4)",
        }}
      >
        {suspect.page}:{suspect.line}
      </span>
      <span
        style={{
          fontFamily: "var(--mono-font)",
          fontSize: 10.5,
          color: "var(--ink-3)",
        }}
      >
        {suspect.rule}
      </span>
      <span
        style={{
          fontFamily: "var(--mono-font)",
          fontSize: 11,
          fontWeight: 600,
          color: scoreTone(suspect.score),
        }}
      >
        {Math.round(suspect.score * 100)}
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          data-testid={`fix-suspect-${suspect.id}`}
          onClick={onFix}
          style={{
            flex: 1,
            padding: "3px 6px",
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
          Fix
        </button>
        <button
          data-testid={`keep-suspect-${suspect.id}`}
          onClick={onKeep}
          style={{
            flex: 1,
            padding: "3px 6px",
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
        <button
          data-testid={`view-on-page-suspect-${suspect.id}`}
          onClick={onViewOnPage}
          title="View on page"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            color: "var(--ink-4)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
          }}
        >
          ⊙
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function WordcheckOverviewTab({
  suspects,
  totals,
  listTotals,
}: {
  suspects: number;
  totals: {
    total: number;
    done: number;
    stealth: number;
    reviewed: number;
  } | null;
  listTotals: {
    good: number;
    bad: number;
    bookGood: number;
    bookBad: number;
    libraryGood: number;
    libraryBad: number;
  } | null;
}): ReactNode {
  const t = totals ?? {
    total: 0,
    done: 0,
    stealth: 0,
    reviewed: 0,
  };

  const stats = [
    {
      label: "suspects",
      value: suspects,
      tone: suspects > 0 ? "var(--fuzzy)" : "var(--exact)",
    },
    { label: "total pages", value: t.total, tone: "var(--ink-1)" },
    {
      label: "scanned",
      value: `${t.done}/${t.total}`,
      tone: t.done < t.total ? "var(--ocr)" : "var(--exact)",
    },
    {
      label: "stealth",
      value: t.stealth,
      tone: t.stealth > 0 ? "var(--fuzzy)" : "var(--ink-2)",
    },
    { label: "reviewed", value: t.reviewed, tone: "var(--ink-1)" },
  ];

  return (
    <div
      data-testid="wordcheck-overview-tab"
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
          gridTemplateColumns: "repeat(5, 1fr)",
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
            data-testid={`wordcheck-stat-${s.label.replace(" ", "-")}`}
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

      {listTotals ? (
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
            Word lists
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
              fontSize: 12,
            }}
          >
            {[
              { label: "Good (project)", value: listTotals.good },
              { label: "Bad (project)", value: listTotals.bad },
              { label: "Book good", value: listTotals.bookGood },
              { label: "Book bad", value: listTotals.bookBad },
              { label: "Library good", value: listTotals.libraryGood },
              { label: "Library bad", value: listTotals.libraryBad },
            ].map((item) => (
              <div
                key={item.label}
                data-testid={`wordcheck-list-${item.label.toLowerCase().replace(/[^a-z]/g, "-")}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  background: "var(--bg-raised)",
                  borderRadius: 5,
                  border: "1px solid var(--border-1)",
                }}
              >
                <span style={{ color: "var(--ink-3)" }}>{item.label}</span>
                <span
                  style={{
                    fontFamily: "var(--mono-font)",
                    fontWeight: 600,
                    color: "var(--ink-1)",
                  }}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
        Word-score distribution chart, top flagged terms, and cross-project list
        comparison wired at I1.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab (minimal F5)
// ---------------------------------------------------------------------------

function WordcheckSettingsTab(): ReactNode {
  return (
    <div
      data-testid="wordcheck-settings-tab"
      style={{
        flex: 1,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>
          Stage settings · Wordcheck
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
          Suspicion threshold, stealth-word rules, list promotion targets, and
          dictionary sources. (Full panel wired at I1.)
        </div>
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
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

type WordcheckTab = "overview" | "suspects" | "settings";

function WordcheckTabBar({
  active,
  onChange,
  suspectCount,
}: {
  active: WordcheckTab;
  onChange: (tab: WordcheckTab) => void;
  suspectCount: number;
}): ReactNode {
  const labels: Record<WordcheckTab, string> = {
    overview: "Overview",
    suspects: `Suspects${suspectCount > 0 ? ` (${suspectCount})` : ""}`,
    settings: "Settings",
  };

  return (
    <div
      data-testid="wordcheck-tab-bar"
      style={{
        display: "flex",
        gap: 2,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-raised)",
      }}
    >
      {(["overview", "suspects", "settings"] as const).map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            data-testid={`wordcheck-tab-${tab}`}
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
// Main WordcheckTool
// ---------------------------------------------------------------------------

export function WordcheckTool({
  stageId,
  runnerRef,
}: ToolSlotProps): ReactNode {
  void runnerRef; // wired at I1

  const projectId = "mock-project";
  const services = useMemo(() => createMockWordcheckServices(), []);

  const [snapshot, send] = useActor(wordcheckToolMachine, {
    input: { projectId, stageIndex: 8, services },
  });

  const { suspects, totals, listTotals } = snapshot.context;

  const [activeTab, setActiveTab] = useState<WordcheckTab>("suspects");
  const [suspectFilter, setSuspectFilter] = useState<string>("all");

  // Simulate mock scan on mount
  useEffect(() => {
    const timeout = setTimeout(() => {
      send({
        type: "SCAN_DONE",
        suspects: MOCK_SUSPECTS,
        totals: {
          total: 4,
          done: 4,
          suspects: MOCK_SUSPECTS.length,
          stealth: 0,
          flagged: 0,
          reviewed: 0,
          clean: 1,
        },
      });
    }, 200);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isScanning = snapshot.matches({ suspects: "scanning" });
  const isSettled = snapshot.matches({ suspects: "settled" });
  const isConfirming = snapshot.matches({ suspects: "confirming" });

  const filteredSuspects = suspects.filter((s) => {
    if (suspectFilter === "dictFail") return s.type === "dictFail";
    if (suspectFilter === "stealth") return s.type === "stealth";
    return true;
  });

  if (isSettled) {
    return (
      <div
        data-testid="wordcheck-tool-settled"
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
        Wordcheck complete. All suspects reviewed.
      </div>
    );
  }

  if (isConfirming) {
    return (
      <div
        data-testid="wordcheck-tool-confirming"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Confirming wordcheck stage…
      </div>
    );
  }

  return (
    <div
      data-testid="wordcheck-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <WordcheckTabBar
        active={activeTab}
        onChange={setActiveTab}
        suspectCount={suspects.length}
      />

      {activeTab === "overview" ? (
        <WordcheckOverviewTab
          suspects={suspects.length}
          totals={totals}
          listTotals={listTotals}
        />
      ) : null}

      {activeTab === "settings" ? <WordcheckSettingsTab /> : null}

      {activeTab === "suspects" ? (
        <div
          data-testid="wordcheck-suspects-tab"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "12px 16px",
            gap: 12,
          }}
        >
          {/* Banner */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid color-mix(in oklab, ${suspects.length > 0 ? "var(--fuzzy)" : "var(--exact)"} 35%, var(--border-1))`,
              background: `color-mix(in oklab, ${suspects.length > 0 ? "var(--fuzzy)" : "var(--exact)"} 6%, var(--bg-surface))`,
            }}
          >
            {isScanning ? (
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                Scanning wordcheck…
              </span>
            ) : (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                }}
              >
                {suspects.length === 0
                  ? "No suspects — text is clean."
                  : `${suspects.length} suspect${suspects.length === 1 ? "" : "s"} need review.`}
              </span>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                data-testid="wordcheck-send-cleared"
                onClick={() => send({ type: "SEND_CLEARED" })}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-ink, #fff)",
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                Send cleared to Text review
              </button>
              <button
                data-testid="wordcheck-accept-dict-fixes"
                onClick={() => send({ type: "ACCEPT_DICT_FIXES" })}
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
                Accept dict fixes
              </button>
              <button
                data-testid="wordcheck-accept-high-conf"
                onClick={() => send({ type: "ACCEPT_HIGH_CONFIDENCE" })}
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
                Accept high-conf
              </button>
              <button
                data-testid="wordcheck-confirm-advance"
                disabled={suspects.length > 0}
                onClick={() => send({ type: "CONFIRM_ADVANCE" })}
                style={{
                  padding: "4px 12px",
                  borderRadius: 5,
                  border: "none",
                  background:
                    suspects.length === 0
                      ? "var(--accent)"
                      : "var(--bg-raised)",
                  color:
                    suspects.length === 0
                      ? "var(--accent-ink, #fff)"
                      : "var(--ink-4)",
                  cursor: suspects.length === 0 ? "pointer" : "not-allowed",
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                Confirm and advance
              </button>
            </div>
          </div>

          {/* Filter chips */}
          <div
            style={{
              display: "flex",
              gap: 3,
              padding: 3,
              background: "var(--bg-raised)",
              borderRadius: 7,
              border: "1px solid var(--border-1)",
              alignSelf: "flex-start",
            }}
          >
            {(
              [
                { id: "all", label: "All", count: suspects.length },
                {
                  id: "dictFail",
                  label: "Dict fail",
                  count: suspects.filter((s) => s.type === "dictFail").length,
                },
                {
                  id: "stealth",
                  label: "Stealth",
                  count: suspects.filter((s) => s.type === "stealth").length,
                },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id}
                data-testid={`wordcheck-filter-${chip.id}`}
                onClick={() => setSuspectFilter(chip.id)}
                style={{
                  padding: "4px 9px",
                  borderRadius: 5,
                  border: "none",
                  background:
                    suspectFilter === chip.id
                      ? "var(--bg-surface)"
                      : "transparent",
                  boxShadow:
                    suspectFilter === chip.id
                      ? "0 0 0 1px var(--border-1)"
                      : "none",
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: suspectFilter === chip.id ? 600 : 500,
                  color:
                    suspectFilter === chip.id ? "var(--ink-1)" : "var(--ink-3)",
                }}
              >
                {chip.label}{" "}
                <span
                  style={{
                    fontFamily: "var(--mono-font)",
                    fontSize: 10,
                    color: "var(--ink-4)",
                  }}
                >
                  {chip.count}
                </span>
              </button>
            ))}
          </div>

          {/* Suspect list */}
          <div
            data-testid="wordcheck-suspect-list"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 80px 60px 80px",
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
              <span>Word / Context</span>
              <span>Page</span>
              <span>Rule</span>
              <span>Score</span>
              <span>Action</span>
            </div>

            {filteredSuspects.length === 0 ? (
              <div
                style={{
                  padding: "16px 12px",
                  fontSize: 12,
                  color: "var(--ink-4)",
                  textAlign: "center",
                }}
              >
                {isScanning ? "Scanning…" : "No suspects in this filter."}
              </div>
            ) : (
              filteredSuspects.map((s) => (
                <SuspectRow
                  key={s.id}
                  suspect={s}
                  onFix={() => send({ type: "FIX", suspectId: s.id })}
                  onKeep={() => send({ type: "KEEP", suspectId: s.id })}
                  onViewOnPage={() =>
                    send({ type: "VIEW_ON_PAGE", suspectId: s.id })
                  }
                />
              ))
            )}
          </div>

          {/* List builder section */}
          <div
            data-testid="wordcheck-list-builder"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <div
                style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}
              >
                Word list builder
              </div>
              <button
                data-testid="wordcheck-promote-to-library"
                onClick={() => send({ type: "PROMOTE_TO_LIBRARY" })}
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
                Promote to library
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
              Candidate words for good/bad list promotion (I1: populated from
              decision log; cross-project write requires library access).
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
