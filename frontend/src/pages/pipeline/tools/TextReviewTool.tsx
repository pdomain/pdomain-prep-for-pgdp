/**
 * TextReviewTool.tsx — React surface for the Text review stage tool.
 *
 * Registered in TOOL_REGISTRY as `text_review`. Lives inside the pipeline
 * shell tool slot — distinct from the legacy routed TextReviewPage (Task I1
 * handles the routed page; do NOT delete it here).
 *
 * ## DISCUSSIONS-GATE invariant
 * The "Confirm and advance" button is DISABLED whenever:
 *   - any queue item is in 'discuss' status (totals.discuss > 0), OR
 *   - requireCommentsResolved=true AND any thread is still open.
 * This mirrors the machine's `gateOpen` guard exactly.
 *
 * Tabs:
 *  - Overview  — queue/thread totals
 *  - Review    — item list with approve/comment actions
 *  - Settings  — requireCommentsResolved toggle (F5 minimal)
 *
 * F5 mock-only: QUEUE_READY is sent on mount with mock data.
 * I1: real SSE actor feeds QUEUE_PUSH/QUEUE_READY; backend wired.
 *
 * @see src/machines/tools/textReviewTool.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-text-review.yaml
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo, useEffect, useState } from "react";
import type { ToolSlotProps } from "../toolSlot";
import {
  textReviewToolMachine,
  type QueueItem,
  type Thread,
  type TextReviewToolServices,
} from "@/machines/tools/textReviewTool";

// ---------------------------------------------------------------------------
// Mock services (F5 — replaced at I1)
// ---------------------------------------------------------------------------

function createMockTextReviewServices(): TextReviewToolServices {
  return {
    async approveLowRisk(_pid) {
      return { approvedIds: [] };
    },
    async confirmStage(_pid) {
      return { ok: true };
    },
  };
}

const MOCK_ITEMS: QueueItem[] = [
  {
    id: "qi1",
    word: "tbe",
    ctxL: "…saw ",
    ctxR: " light…",
    suggest: "the",
    reason: "dict-fail",
    page: "p0002",
    line: 14,
    reviewer: "auto",
    comments: 0,
    status: "pending",
  },
  {
    id: "qi2",
    word: "ligbt",
    ctxL: "…tbe ",
    ctxR: " and…",
    reason: "dict-fail",
    page: "p0002",
    line: 14,
    reviewer: "auto",
    comments: 0,
    status: "pending",
  },
  {
    id: "qi3",
    word: "ond",
    ctxL: "…light ",
    ctxR: " the…",
    suggest: "and",
    reason: "dict-fail",
    page: "p0003",
    line: 7,
    reviewer: "auto",
    comments: 0,
    status: "pending",
  },
];

const MOCK_THREADS: Thread[] = [];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QueueItemRow({
  item,
  onApprove,
  onComment,
}: {
  item: QueueItem;
  onApprove: () => void;
  onComment: () => void;
}): ReactNode {
  const isDiscuss = item.status === "discuss";

  return (
    <div
      data-testid={`queue-item-row-${item.id}`}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 80px 80px 120px",
        gap: 8,
        padding: "8px 12px",
        borderTop: "1px solid var(--border-1)",
        alignItems: "center",
        background: isDiscuss
          ? "color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))"
          : "transparent",
      }}
    >
      <div>
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 14,
            color: isDiscuss ? "var(--fuzzy)" : "var(--mismatch)",
            fontWeight: 600,
          }}
        >
          {item.word}
        </span>
        {item.suggest ? (
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
              {item.suggest}
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
          {item.ctxL}
          <strong style={{ color: "var(--mismatch)" }}>{item.word}</strong>
          {item.ctxR}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--mono-font)",
          fontSize: 11,
          color: "var(--ink-4)",
        }}
      >
        {item.page}:{item.line}
      </span>
      <span
        style={{
          fontSize: 10.5,
          padding: "2px 6px",
          borderRadius: 3,
          background: isDiscuss
            ? "color-mix(in oklab, var(--fuzzy) 14%, var(--bg-raised))"
            : "var(--bg-raised)",
          color: isDiscuss ? "var(--fuzzy)" : "var(--ink-3)",
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {item.status}
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        {!isDiscuss ? (
          <button
            data-testid={`approve-item-${item.id}`}
            onClick={onApprove}
            style={{
              flex: 1,
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
            Approve
          </button>
        ) : null}
        <button
          data-testid={`comment-item-${item.id}`}
          onClick={onComment}
          style={{
            flex: 1,
            padding: "3px 8px",
            borderRadius: 4,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 10.5,
            color: "var(--ink-3)",
          }}
        >
          Comment
        </button>
      </div>
    </div>
  );
}

function ThreadRow({ thread }: { thread: Thread }): ReactNode {
  return (
    <div
      data-testid={`thread-row-${thread.id}`}
      style={{
        display: "flex",
        gap: 10,
        padding: "8px 12px",
        borderTop: "1px solid var(--border-1)",
        fontSize: 12,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 99,
          background: "var(--bg-raised)",
          border: "1px solid var(--border-1)",
          display: "grid",
          placeItems: "center",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--ink-3)",
          flexShrink: 0,
        }}
      >
        {thread.author.slice(0, 2).toUpperCase()}
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 3,
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--ink-1)" }}>
            {thread.author}
          </span>
          <span
            style={{
              fontSize: 10.5,
              padding: "1px 5px",
              borderRadius: 3,
              background:
                thread.status === "resolved"
                  ? "color-mix(in oklab, var(--exact) 14%, var(--bg-raised))"
                  : "color-mix(in oklab, var(--fuzzy) 14%, var(--bg-raised))",
              color:
                thread.status === "resolved" ? "var(--exact)" : "var(--fuzzy)",
              fontWeight: 600,
            }}
          >
            {thread.status}
          </span>
        </div>
        <div style={{ color: "var(--ink-2)" }}>{thread.body}</div>
        {thread.replies > 0 ? (
          <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-4)" }}>
            {thread.replies} repl{thread.replies === 1 ? "y" : "ies"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function TextReviewOverviewTab({
  totals,
  threads,
}: {
  totals: {
    total: number;
    pending: number;
    discuss: number;
    approved: number;
    comments: number;
  } | null;
  threads: Thread[];
}): ReactNode {
  const t = totals ?? {
    total: 0,
    pending: 0,
    discuss: 0,
    approved: 0,
    comments: 0,
  };

  const openThreads = threads.filter((th) => th.status === "open").length;

  const stats = [
    { label: "total", value: t.total, tone: "var(--ink-1)" },
    {
      label: "pending",
      value: t.pending,
      tone: t.pending > 0 ? "var(--fuzzy)" : "var(--ink-2)",
    },
    {
      label: "discuss",
      value: t.discuss,
      tone: t.discuss > 0 ? "var(--mismatch)" : "var(--ink-2)",
    },
    { label: "approved", value: t.approved, tone: "var(--exact)" },
    { label: "comments", value: t.comments, tone: "var(--ink-1)" },
    {
      label: "open threads",
      value: openThreads,
      tone: openThreads > 0 ? "var(--fuzzy)" : "var(--ink-2)",
    },
  ];

  return (
    <div
      data-testid="text-review-overview-tab"
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
            data-testid={`text-review-stat-${s.label.replace(" ", "-")}`}
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

      {t.discuss > 0 ? (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border:
              "1px solid color-mix(in oklab, var(--mismatch) 30%, var(--border-1))",
            background:
              "color-mix(in oklab, var(--mismatch) 6%, var(--bg-surface))",
            fontSize: 12,
            color: "var(--mismatch)",
            fontWeight: 600,
          }}
        >
          DISCUSSIONS-GATE: {t.discuss} item
          {t.discuss === 1 ? "" : "s"} in discussion — confirm blocked.
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
        Per-page text viewer with annotation overlays and cross-proofer review
        history wired at I1.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

type TextReviewTab = "overview" | "review" | "threads" | "settings";

function TextReviewTabBar({
  active,
  onChange,
  counts,
}: {
  active: TextReviewTab;
  onChange: (tab: TextReviewTab) => void;
  counts: { review: number; threads: number };
}): ReactNode {
  const labels: Record<TextReviewTab, string> = {
    overview: "Overview",
    review: `Review (${counts.review})`,
    threads: `Threads (${counts.threads})`,
    settings: "Settings",
  };

  return (
    <div
      data-testid="text-review-tab-bar"
      style={{
        display: "flex",
        gap: 2,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-raised)",
      }}
    >
      {(["overview", "review", "threads", "settings"] as const).map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            data-testid={`text-review-tab-${tab}`}
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
// Main TextReviewTool
// ---------------------------------------------------------------------------

export function TextReviewTool({
  stageId,
  runnerRef,
}: ToolSlotProps): ReactNode {
  void runnerRef; // wired at I1

  const projectId = "mock-project";
  const services = useMemo(() => createMockTextReviewServices(), []);

  const [snapshot, send] = useActor(textReviewToolMachine, {
    input: { projectId, stageIndex: 9, services },
  });

  const { queue, threads, totals, _settings } = snapshot.context;
  const [activeTab, setActiveTab] = useState<TextReviewTab>("review");
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");

  // Simulate mock QUEUE_READY on mount
  useEffect(() => {
    const timeout = setTimeout(() => {
      send({
        type: "QUEUE_READY",
        queue: MOCK_ITEMS,
        threads: MOCK_THREADS,
        totals: {
          total: MOCK_ITEMS.length,
          queue: MOCK_ITEMS.length,
          pending: MOCK_ITEMS.length,
          discuss: 0,
          approved: 0,
          clean: 0,
          comments: 0,
        },
      });
    }, 150);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAssembling = snapshot.matches("assembling");
  const isSettled = snapshot.matches("settled");
  const isConfirming = snapshot.matches("confirming");
  const isReviewing = snapshot.matches("reviewing");

  // DISCUSSIONS-GATE: derive confirm-button enabled state matching gateOpen guard
  const gateOpen =
    !!totals &&
    totals.discuss === 0 &&
    (!_settings.requireCommentsResolved ||
      threads.every((t) => t.status === "resolved"));

  const counts = {
    review: queue.length,
    threads: threads.length,
  };

  const handleCommentSubmit = (itemId: string) => {
    if (!commentBody.trim()) return;
    send({ type: "OPEN_COMMENT", itemId, body: commentBody.trim() });
    setCommentBody("");
    setCommentTarget(null);
  };

  if (isAssembling) {
    return (
      <div
        data-testid="text-review-tool-assembling"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Assembling review queue…
      </div>
    );
  }

  if (isConfirming) {
    return (
      <div
        data-testid="text-review-tool-confirming"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Confirming text review stage…
      </div>
    );
  }

  if (isSettled) {
    return (
      <div
        data-testid="text-review-tool-settled"
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
        <div
          style={{
            color: "var(--exact)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          Text review complete. All items signed off.
        </div>
        <button
          data-testid="text-review-reopen"
          onClick={() => send({ type: "REOPEN" })}
          style={{
            padding: "4px 12px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 11.5,
            color: "var(--ink-3)",
          }}
        >
          Reopen
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="text-review-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TextReviewTabBar
        active={activeTab}
        onChange={setActiveTab}
        counts={counts}
      />

      {activeTab === "overview" ? (
        <TextReviewOverviewTab totals={totals} threads={threads} />
      ) : null}

      {activeTab === "settings" ? (
        <div
          data-testid="text-review-settings-tab"
          style={{
            flex: 1,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}
            >
              Stage settings · Text review
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
              Review attestation rules and sign-off thresholds.
            </div>
          </div>
          {/* requireCommentsResolved toggle — machine-level setting (DIVERGENCES.md #7) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
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
                Require all threads resolved before confirming
              </div>
              <div
                style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
              >
                When on, the confirm gate also blocks until every open thread is
                resolved.
              </div>
            </div>
            <button
              data-testid="text-review-require-comments-toggle"
              onClick={() =>
                send({
                  type: "SET_REQUIRE_COMMENTS_RESOLVED",
                  value: !_settings.requireCommentsResolved,
                })
              }
              style={{
                padding: "5px 14px",
                borderRadius: 6,
                border: `1.5px solid ${_settings.requireCommentsResolved ? "var(--accent)" : "var(--border-2)"}`,
                background: _settings.requireCommentsResolved
                  ? "color-mix(in oklab, var(--accent) 10%, var(--bg-surface))"
                  : "var(--bg-surface)",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                color: _settings.requireCommentsResolved
                  ? "var(--accent)"
                  : "var(--ink-3)",
              }}
            >
              {_settings.requireCommentsResolved ? "On" : "Off"}
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === "threads" ? (
        <div
          data-testid="text-review-threads-tab"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "12px 16px",
            gap: 12,
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
            {threads.length === 0 ? (
              <div
                style={{
                  padding: "16px 12px",
                  fontSize: 12,
                  color: "var(--ink-4)",
                  textAlign: "center",
                }}
              >
                No threads yet.
              </div>
            ) : (
              threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "review" && isReviewing ? (
        <div
          data-testid="text-review-review-tab"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "12px 16px",
            gap: 12,
          }}
        >
          {/* Banner with gate status */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid color-mix(in oklab, ${gateOpen ? "var(--exact)" : "var(--fuzzy)"} 35%, var(--border-1))`,
              background: `color-mix(in oklab, ${gateOpen ? "var(--exact)" : "var(--fuzzy)"} 6%, var(--bg-surface))`,
            }}
          >
            <span
              style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}
            >
              {queue.length === 0
                ? "Queue empty."
                : `${queue.length} item${queue.length === 1 ? "" : "s"} in queue.`}
              {totals && totals.discuss > 0 ? (
                <span
                  style={{
                    marginLeft: 8,
                    color: "var(--mismatch)",
                    fontSize: 12,
                  }}
                >
                  {totals.discuss} in discussion — gate closed.
                </span>
              ) : null}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                data-testid="text-review-approve-low-risk"
                onClick={() => send({ type: "APPROVE_LOW_RISK" })}
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
                Approve low risk
              </button>
              <button
                data-testid="text-review-confirm-advance"
                disabled={!gateOpen}
                onClick={() => {
                  if (gateOpen) send({ type: "CONFIRM_ADVANCE" });
                }}
                style={{
                  padding: "4px 12px",
                  borderRadius: 5,
                  border: "none",
                  background: gateOpen ? "var(--accent)" : "var(--bg-raised)",
                  color: gateOpen ? "var(--accent-ink, #fff)" : "var(--ink-4)",
                  cursor: gateOpen ? "pointer" : "not-allowed",
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                Confirm and advance
              </button>
            </div>
          </div>

          {/* Queue list */}
          <div
            data-testid="text-review-queue-list"
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
                gridTemplateColumns: "1fr 80px 80px 120px",
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
              <span>Status</span>
              <span>Action</span>
            </div>
            {queue.length === 0 ? (
              <div
                style={{
                  padding: "16px 12px",
                  fontSize: 12,
                  color: "var(--ink-4)",
                  textAlign: "center",
                }}
              >
                No items in queue.
              </div>
            ) : (
              queue.map((item) => (
                <div key={item.id}>
                  <QueueItemRow
                    item={item}
                    onApprove={() =>
                      send({ type: "APPROVE_ITEM", itemId: item.id })
                    }
                    onComment={() => setCommentTarget(item.id)}
                  />
                  {commentTarget === item.id ? (
                    <div
                      style={{
                        padding: "8px 12px",
                        borderTop: "1px solid var(--border-1)",
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        background:
                          "color-mix(in oklab, var(--fuzzy) 4%, var(--bg-surface))",
                      }}
                    >
                      <input
                        data-testid={`comment-input-${item.id}`}
                        type="text"
                        placeholder="Add comment…"
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCommentSubmit(item.id);
                          if (e.key === "Escape") setCommentTarget(null);
                        }}
                        style={{
                          flex: 1,
                          padding: "5px 10px",
                          borderRadius: 5,
                          border: "1px solid var(--border-2)",
                          fontSize: 12,
                          background: "var(--bg-surface)",
                          color: "var(--ink-1)",
                        }}
                      />
                      <button
                        data-testid={`comment-submit-${item.id}`}
                        onClick={() => handleCommentSubmit(item.id)}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 5,
                          border: "none",
                          background: "var(--accent)",
                          color: "var(--accent-ink, #fff)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        Submit
                      </button>
                      <button
                        onClick={() => setCommentTarget(null)}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 5,
                          border: "1px solid var(--border-2)",
                          background: "var(--bg-surface)",
                          cursor: "pointer",
                          fontSize: 12,
                          color: "var(--ink-3)",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
