/**
 * RegexTool.tsx — React surface for the Regex pass stage tool.
 *
 * Registered in TOOL_REGISTRY as `regex`.
 * Tabs:
 *  - Overview  — rule/match counts
 *  - Rules     — rule list with run/preview/add/reorder actions
 *  - Settings  — requirePreviewToCommit + rerunOnTextChange toggles
 *
 * Machine states surface:
 *  - loading → spinner
 *  - reviewing.idle → rule list with Run / Preview actions
 *  - reviewing.previewing → before/after hunk panel
 *  - reviewing.runningRule → busy spinner on the rule
 *  - clean → "All rules applied" + Rollback
 *  - error → error with Retry
 *
 * Surface controls wired (F5.5 fix round):
 *  - ADD_RULE — "Add rule" button in the rules banner (canvas: regex.jsx RXMain)
 *  - REORDER_RULE — up/down arrow buttons per rule row (canvas: "Drag to reorder" note)
 *
 * F5 mock-only: fetchRules returns mock rules; applyRule returns an updated rule.
 * I1: real backend GET/POST .../regex/rules.
 *
 * @see src/machines/tools/regexPass.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-regex.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/regex/regex.jsx — canvas authority
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { ToolSlotProps } from "../toolSlot";
import {
  regexPassMachine,
  type RegexRule,
  type RegexPassServices,
} from "@/machines/tools/regexPass";
import { buildRealRegexPassServices } from "@/services/tools/regexPass";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function RuleStatusBadge({
  status,
}: {
  status: RegexRule["status"];
}): ReactNode {
  const tone: Record<RegexRule["status"], string> = {
    applied: "var(--exact)",
    review: "var(--ocr)",
    pending: "var(--fuzzy)",
  };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 3,
        background: `color-mix(in oklab, ${tone[status]} 14%, var(--bg-raised))`,
        color: tone[status],
        fontFamily: "var(--mono-font)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Rule row
// ---------------------------------------------------------------------------

function RuleRow({
  rule,
  index,
  total,
  isRunning,
  onRun,
  onPreview,
  onToggle,
  onReorder,
}: {
  rule: RegexRule;
  index: number;
  total: number;
  isRunning: boolean;
  onRun: () => void;
  onPreview: () => void;
  onToggle: () => void;
  onReorder: (direction: "up" | "down") => void;
}): ReactNode {
  return (
    <div
      data-testid={`regex-rule-row-${rule.id}`}
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr 80px 60px 80px 120px 52px",
        gap: 8,
        padding: "8px 12px",
        borderTop: "1px solid var(--border-1)",
        alignItems: "center",
        fontSize: 12.5,
        opacity: rule.enabled ? 1 : 0.5,
      }}
    >
      {/* Enable toggle */}
      <input
        data-testid={`regex-rule-toggle-${rule.id}`}
        type="checkbox"
        checked={rule.enabled}
        onChange={onToggle}
        style={{ cursor: "pointer" }}
      />

      {/* Name + pattern */}
      <div>
        <div style={{ fontWeight: 600, color: "var(--ink-1)" }}>
          {rule.name}
        </div>
        <div
          style={{
            marginTop: 2,
            fontFamily: "var(--mono-font)",
            fontSize: 11,
            color: "var(--ink-4)",
          }}
        >
          <span style={{ color: "var(--mismatch)" }}>{rule.find}</span>
          <span style={{ margin: "0 4px" }}>→</span>
          <span style={{ color: "var(--exact)" }}>{rule.repl}</span>
          <span style={{ marginLeft: 6, color: "var(--ink-4)" }}>
            [{rule.flags}] {rule.scope}
          </span>
        </div>
      </div>

      {/* Status */}
      <RuleStatusBadge status={rule.status} />

      {/* Match count */}
      <span
        style={{
          fontFamily: "var(--mono-font)",
          fontSize: 12,
          color: "var(--ink-3)",
          textAlign: "right",
        }}
      >
        {rule.matches}
      </span>

      {/* Scope */}
      <span
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          fontFamily: "var(--mono-font)",
        }}
      >
        {rule.scope}
      </span>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4 }}>
        {isRunning ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--ocr)",
              fontFamily: "var(--mono-font)",
            }}
          >
            running…
          </span>
        ) : rule.status === "pending" ? (
          <>
            <button
              data-testid={`regex-preview-${rule.id}`}
              onClick={onPreview}
              style={{
                padding: "3px 7px",
                borderRadius: 4,
                border: "1px solid var(--border-2)",
                background: "var(--bg-surface)",
                cursor: "pointer",
                fontSize: 10.5,
                color: "var(--ink-3)",
              }}
            >
              Preview
            </button>
            <button
              data-testid={`regex-run-${rule.id}`}
              onClick={onRun}
              style={{
                padding: "3px 7px",
                borderRadius: 4,
                border: "1px solid var(--accent)",
                background:
                  "color-mix(in oklab, var(--accent) 10%, var(--bg-surface))",
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 600,
                color: "var(--accent)",
              }}
            >
              Run
            </button>
          </>
        ) : rule.status === "review" ? (
          <button
            data-testid={`regex-preview-${rule.id}`}
            onClick={onPreview}
            style={{
              padding: "3px 7px",
              borderRadius: 4,
              border: "1px solid var(--ocr)",
              background:
                "color-mix(in oklab, var(--ocr) 10%, var(--bg-surface))",
              cursor: "pointer",
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--ocr)",
            }}
          >
            Review
          </button>
        ) : (
          <span
            style={{ fontSize: 10.5, color: "var(--exact)", fontWeight: 600 }}
          >
            Applied
          </span>
        )}
      </div>

      {/* Reorder up/down buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button
          data-testid={`regex-rule-move-up-${rule.id}`}
          disabled={index === 0}
          onClick={() => onReorder("up")}
          title="Move rule up"
          style={{
            width: 22,
            height: 18,
            borderRadius: 3,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: index === 0 ? "not-allowed" : "pointer",
            fontSize: 9,
            color: index === 0 ? "var(--ink-4)" : "var(--ink-2)",
            display: "grid",
            placeItems: "center",
            padding: 0,
          }}
        >
          ▲
        </button>
        <button
          data-testid={`regex-rule-move-down-${rule.id}`}
          disabled={index === total - 1}
          onClick={() => onReorder("down")}
          title="Move rule down"
          style={{
            width: 22,
            height: 18,
            borderRadius: 3,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: index === total - 1 ? "not-allowed" : "pointer",
            fontSize: 9,
            color: index === total - 1 ? "var(--ink-4)" : "var(--ink-2)",
            display: "grid",
            placeItems: "center",
            padding: 0,
          }}
        >
          ▼
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function RegexOverviewTab({
  counts,
}: {
  counts: {
    rules: number;
    applied: number;
    review: number;
    pending: number;
    matches: number;
  } | null;
}): ReactNode {
  const c = counts ?? {
    rules: 0,
    applied: 0,
    review: 0,
    pending: 0,
    matches: 0,
  };

  const stats = [
    { label: "rules", value: c.rules, tone: "var(--ink-1)" },
    { label: "applied", value: c.applied, tone: "var(--exact)" },
    {
      label: "review",
      value: c.review,
      tone: c.review > 0 ? "var(--ocr)" : "var(--ink-2)",
    },
    {
      label: "pending",
      value: c.pending,
      tone: c.pending > 0 ? "var(--fuzzy)" : "var(--ink-2)",
    },
    { label: "matches", value: c.matches, tone: "var(--ink-1)" },
  ];

  return (
    <div
      data-testid="regex-overview-tab"
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
            data-testid={`regex-stat-${s.label}`}
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
        Match distribution by rule and full diff preview wired at I1.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

type RegexTab = "overview" | "rules" | "settings";

function RegexTabBar({
  active,
  onChange,
}: {
  active: RegexTab;
  onChange: (tab: RegexTab) => void;
}): ReactNode {
  const labels: Record<RegexTab, string> = {
    overview: "Overview",
    rules: "Rules",
    settings: "Settings",
  };

  return (
    <div
      data-testid="regex-tab-bar"
      style={{
        display: "flex",
        gap: 2,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-raised)",
      }}
    >
      {(["overview", "rules", "settings"] as const).map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            data-testid={`regex-tab-${tab}`}
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
// Main RegexTool
// ---------------------------------------------------------------------------

export function RegexTool({
  stageId,
  runnerRef,
  _testServices,
}: ToolSlotProps & { _testServices?: RegexPassServices }): ReactNode {
  void runnerRef; // wired at I1

  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = useMemo(
    () => _testServices ?? buildRealRegexPassServices(),
    [_testServices],
  );

  const [snapshot, send] = useActor(regexPassMachine, {
    input: { projectId, stageIndex: 11, services },
  });

  const { rules, counts, previewRule, _settings } = snapshot.context;
  const [activeTab, setActiveTab] = useState<RegexTab>("rules");

  const isLoading = snapshot.matches("loading");
  const isReviewing = snapshot.matches("reviewing");
  const isIdle = snapshot.matches({ reviewing: "idle" });
  const isPreviewing = snapshot.matches({ reviewing: "previewing" });
  const isRunningRule = snapshot.matches({ reviewing: "runningRule" });
  const isClean = snapshot.matches("clean");
  const isError = snapshot.matches("error");

  const previewRuleObj = previewRule
    ? rules.find((r) => r.id === previewRule)
    : null;

  if (isLoading) {
    return (
      <div
        data-testid="regex-tool-loading"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Loading regex rules…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="regex-tool-error"
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
          Failed to load regex rules. {snapshot.context.error?.message}
        </div>
        <button
          data-testid="regex-retry"
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

  if (isClean) {
    return (
      <div
        data-testid="regex-tool-clean"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            color: "var(--exact)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          All regex rules applied.{" "}
          {counts
            ? `${counts.applied} rule${counts.applied === 1 ? "" : "s"}, ${counts.matches} matches.`
            : ""}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            data-testid="regex-rollback"
            onClick={() => send({ type: "ROLLBACK" })}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              border: "1px solid var(--border-2)",
              background: "var(--bg-surface)",
              cursor: "pointer",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            Rollback to snapshot
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="regex-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <RegexTabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" ? <RegexOverviewTab counts={counts} /> : null}

      {activeTab === "settings" ? (
        <div
          data-testid="regex-settings-tab"
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
              Stage settings · Regex pass
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
              Run-time flags that govern preview/commit and change-detection
              behaviour.
            </div>
          </div>

          {/* requirePreviewToCommit */}
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
                Require preview before commit
              </div>
              <div
                style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
              >
                When on, rules in "review" state must show the before/after diff
                before they can be committed.
              </div>
            </div>
            <span
              data-testid="regex-settings-require-preview"
              style={{
                padding: "4px 12px",
                borderRadius: 5,
                border: `1.5px solid ${_settings.requirePreviewToCommit ? "var(--accent)" : "var(--border-2)"}`,
                background: _settings.requirePreviewToCommit
                  ? "color-mix(in oklab, var(--accent) 10%, var(--bg-surface))"
                  : "var(--bg-surface)",
                fontSize: 12.5,
                fontWeight: 600,
                color: _settings.requirePreviewToCommit
                  ? "var(--accent)"
                  : "var(--ink-4)",
              }}
            >
              {_settings.requirePreviewToCommit ? "On" : "Off"}
            </span>
          </div>

          {/* rerunOnTextChange */}
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
                Re-run on text change
              </div>
              <div
                style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
              >
                When on, an upstream text change invalidates all applied rules
                and re-opens reviewing.
              </div>
            </div>
            <span
              data-testid="regex-settings-rerun-on-change"
              style={{
                padding: "4px 12px",
                borderRadius: 5,
                border: `1.5px solid ${_settings.rerunOnTextChange ? "var(--accent)" : "var(--border-2)"}`,
                background: _settings.rerunOnTextChange
                  ? "color-mix(in oklab, var(--accent) 10%, var(--bg-surface))"
                  : "var(--bg-surface)",
                fontSize: 12.5,
                fontWeight: 600,
                color: _settings.rerunOnTextChange
                  ? "var(--accent)"
                  : "var(--ink-4)",
              }}
            >
              {_settings.rerunOnTextChange ? "On" : "Off"}
            </span>
          </div>
        </div>
      ) : null}

      {activeTab === "rules" && isReviewing ? (
        <div
          data-testid="regex-rules-tab"
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
              border:
                "1px solid color-mix(in oklab, var(--ocr) 35%, var(--border-1))",
              background:
                "color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))",
            }}
          >
            <span
              style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}
            >
              {counts
                ? `${counts.review} rules need review · ${counts.pending} pending`
                : "Loading…"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                data-testid="regex-load-preset"
                onClick={() => send({ type: "LOAD_PRESET" })}
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
                Load preset
              </button>
              <button
                data-testid="regex-add-rule"
                onClick={() =>
                  send({
                    type: "ADD_RULE",
                    fields: {
                      name: "New rule",
                      find: "",
                      repl: "",
                      flags: "g",
                      scope: "all",
                      enabled: true,
                    },
                  })
                }
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
                Add rule
              </button>
            </div>
          </div>

          {/* Preview panel (when in previewing state) */}
          {isPreviewing && previewRuleObj ? (
            <div
              data-testid="regex-preview-panel"
              style={{
                padding: "14px 16px",
                background:
                  "color-mix(in oklab, var(--ocr) 5%, var(--bg-surface))",
                border: "1px solid var(--ocr)",
                borderRadius: 8,
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
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink-1)",
                  }}
                >
                  Preview: {previewRuleObj.name}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    data-testid="regex-commit-rule"
                    onClick={() => send({ type: "COMMIT_RULE" })}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 5,
                      border: "none",
                      background: "var(--accent)",
                      color: "var(--accent-ink, #fff)",
                      cursor: "pointer",
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    Commit
                  </button>
                  <button
                    data-testid="regex-skip-rule"
                    onClick={() => send({ type: "SKIP_RULE" })}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 5,
                      border: "1px solid var(--border-2)",
                      background: "var(--bg-surface)",
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: "var(--ink-3)",
                    }}
                  >
                    Skip
                  </button>
                  <button
                    data-testid="regex-close-preview"
                    onClick={() => send({ type: "CLOSE" })}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 5,
                      border: "1px solid var(--border-2)",
                      background: "var(--bg-surface)",
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: "var(--ink-3)",
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div
                data-testid="regex-hunk-area"
                style={{
                  background: "var(--bg-sunk)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 6,
                  padding: "12px 14px",
                  fontFamily: "var(--mono-font)",
                  fontSize: 12,
                  color: "var(--ink-3)",
                }}
              >
                Before/after diff hunks (I1: GET .../regex/rules/
                {previewRuleObj.id}/preview)
              </div>
            </div>
          ) : null}

          {/* Running indicator */}
          {isRunningRule ? (
            <div
              data-testid="regex-running-indicator"
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background:
                  "color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))",
                border:
                  "1px solid color-mix(in oklab, var(--ocr) 35%, var(--border-1))",
                fontSize: 12.5,
                color: "var(--ocr)",
                fontWeight: 600,
              }}
            >
              Applying rule…
            </div>
          ) : null}

          {/* Rule list */}
          <div
            data-testid="regex-rule-list"
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
                gridTemplateColumns: "24px 1fr 80px 60px 80px 120px 52px",
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
              <span />
              <span>Name / Pattern</span>
              <span>Status</span>
              <span>Matches</span>
              <span>Scope</span>
              <span>Action</span>
              <span>Order</span>
            </div>
            {rules.length === 0 ? (
              <div
                style={{
                  padding: "16px 12px",
                  fontSize: 12,
                  color: "var(--ink-4)",
                  textAlign: "center",
                }}
              >
                No rules loaded.
              </div>
            ) : (
              rules.map((rule, idx) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={idx}
                  total={rules.length}
                  isRunning={isRunningRule && previewRule === rule.id}
                  onRun={() => {
                    if (isIdle) {
                      send({ type: "RUN_RULE", ruleId: rule.id });
                    }
                  }}
                  onPreview={() => {
                    if (isIdle) {
                      send({ type: "OPEN_PREVIEW", ruleId: rule.id });
                    }
                  }}
                  onToggle={() =>
                    send({ type: "TOGGLE_RULE", ruleId: rule.id })
                  }
                  onReorder={(dir) =>
                    send({
                      type: "REORDER_RULE",
                      from: idx,
                      to: dir === "up" ? idx - 1 : idx + 1,
                    })
                  }
                />
              ))
            )}
          </div>

          {/* Filter and add */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {(["all", "applied", "review", "disabled"] as const).map((f) => {
              const isActive = snapshot.context.listFilter === f;
              return (
                <button
                  key={f}
                  data-testid={`regex-filter-${f}`}
                  onClick={() => send({ type: "SET_LIST_FILTER", value: f })}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    border: `1px solid ${isActive ? "var(--accent)" : "var(--border-2)"}`,
                    background: isActive
                      ? "color-mix(in oklab, var(--accent) 10%, var(--bg-surface))"
                      : "var(--bg-surface)",
                    cursor: "pointer",
                    fontSize: 11,
                    color: isActive ? "var(--accent)" : "var(--ink-3)",
                    fontWeight: isActive ? 600 : 500,
                  }}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
