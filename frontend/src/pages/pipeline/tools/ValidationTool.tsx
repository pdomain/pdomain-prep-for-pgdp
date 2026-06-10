/**
 * ValidationTool — React surface for the Validation stage tool.
 *
 * Drives `validationToolMachine`. Two tabs:
 * - **Overview** — Gate card + stat tiles + rule list with Fix/Waive actions
 * - **Settings** — Strictness, per-rule toggles, waiver settings
 *
 * DCArtboard-faithful layout:
 * ┌──────────────────────────────────────────────────┐
 * │  Gate card (passed / N error · build blocked)    │
 * │  ─────────────────────────────────────────────   │
 * │  Stat row (pass · warn · error · rules)          │
 * │  ─────────────────────────────────────────────   │
 * │  Pre-flight checks card — rule list              │
 * │    each rule: icon · name · detail · level chip  │
 * │    error rows: Fix button                        │
 * │    warn rows: Waive button (if allowed)          │
 * └──────────────────────────────────────────────────┘
 *
 * @see src/machines/tools/validationTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/validation/validation.jsx
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  validationToolMachine,
  type ValidationToolServices,
  type ValidationRule,
  type RuleLevel,
} from "@/machines/tools/validationTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";

// ---------------------------------------------------------------------------
// Mock service adapter (replaced at I1)
// ---------------------------------------------------------------------------

const MOCK_RULES: ValidationRule[] = [
  {
    id: "r1",
    name: "Metadata complete",
    level: "pass",
    detail: "all fields filled",
  },
  {
    id: "r2",
    name: "Zero open scannos",
    level: "warn",
    detail: "2 open scannos in Wordcheck",
  },
  { id: "r3", name: "All pages have text", level: "pass", detail: "387 / 387" },
  {
    id: "r4",
    name: "No stale stages",
    level: "error",
    detail: "text_review is stale",
  },
  {
    id: "r5",
    name: "Proof pack complete",
    level: "pass",
    detail: "387 / 387 pages",
  },
  {
    id: "r6",
    name: "Image quality",
    level: "pass",
    detail: "all pages within bounds",
  },
  { id: "r7", name: "Page order confirmed", level: "pass", detail: "no gaps" },
  { id: "r8", name: "OCR confidence", level: "pass", detail: "≥ 0.85 mean" },
];

function makeMockValidationServices(
  _projectId: string,
): ValidationToolServices {
  return {
    runChecks: () =>
      Promise.resolve({
        rules: MOCK_RULES,
        counts: {
          pass: MOCK_RULES.filter((r) => r.level === "pass").length,
          warn: MOCK_RULES.filter((r) => r.level === "warn").length,
          error: MOCK_RULES.filter((r) => r.level === "error").length,
        },
      }),
    persistWaiver: (_pid, _ruleId, _note) => Promise.resolve({ ok: true }),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const LEVEL_COLOR: Record<RuleLevel, string> = {
  pass: "var(--exact)",
  warn: "var(--fuzzy)",
  error: "var(--mismatch)",
};

function LevelIcon({ level }: { level: RuleLevel }) {
  const color = LEVEL_COLOR[level];
  const symbol = level === "pass" ? "✓" : level === "warn" ? "!" : "✕";
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: 99,
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
      {symbol}
    </span>
  );
}

function GateCard({
  passed,
  errorCount,
}: {
  passed: boolean;
  errorCount: number;
}) {
  const color = passed ? "var(--exact)" : "var(--mismatch)";
  const label = passed
    ? "Pre-flight passed"
    : `${errorCount} error · build blocked`;
  const sub = passed
    ? "All blocking rules pass — ready to build."
    : "Fix the errors below to unblock Build package. Warnings can be waived with a note.";
  return (
    <div
      data-testid={passed ? "gate-passed" : "gate-blocked"}
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
        {passed ? "✓" : "!"}
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
}: {
  label: string;
  value: number | string;
  tone?: string;
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
    </div>
  );
}

function RuleRow({
  rule,
  onFix,
  onWaive,
  allowWaivers,
}: {
  rule: ValidationRule;
  onFix: (ruleId: string) => void;
  onWaive: (ruleId: string) => void;
  allowWaivers: boolean;
}) {
  return (
    <div
      data-testid={`rule-row-${rule.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderTop: "1px solid var(--border-1)",
      }}
    >
      <LevelIcon level={rule.level} />
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: "var(--ink-1)",
          fontWeight: 500,
        }}
      >
        {rule.name}
        {rule.waiver && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: "var(--fuzzy)",
              fontStyle: "italic",
            }}
          >
            (waived: {rule.waiver})
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          fontFamily: "var(--mono-font, monospace)",
        }}
      >
        {rule.detail}
      </span>
      <span
        style={{
          width: 54,
          textAlign: "right",
          fontSize: 10,
          fontWeight: 700,
          color: LEVEL_COLOR[rule.level],
          textTransform: "uppercase",
          fontFamily: "var(--mono-font, monospace)",
        }}
      >
        {rule.level}
      </span>
      {rule.level === "error" ? (
        <Button
          data-testid={`rule-fix-${rule.id}`}
          variant="ghost"
          size="sm"
          onClick={() => onFix(rule.id)}
        >
          Fix
        </Button>
      ) : rule.level === "warn" && allowWaivers && !rule.waiver ? (
        <Button
          data-testid={`rule-waive-${rule.id}`}
          variant="ghost"
          size="sm"
          onClick={() => onWaive(rule.id)}
        >
          Waive
        </Button>
      ) : (
        <span style={{ width: 52 }} />
      )}
    </div>
  );
}

function WaiverDialog({
  ruleId,
  note,
  onSetNote,
  onConfirm,
  onCancel,
}: {
  ruleId: string;
  note: string;
  onSetNote: (n: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="waiver-dialog"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 10,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
        Waive warning: {ruleId}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
        A note is required to waive this warning for the record.
      </div>
      <textarea
        data-testid="waiver-note-input"
        value={note}
        onChange={(e) => onSetNote(e.target.value)}
        placeholder="Reason for waiving…"
        rows={3}
        style={{
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid var(--border-1)",
          background: "var(--bg-raised)",
          color: "var(--ink-1)",
          fontSize: 12,
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button
          data-testid="waiver-cancel-btn"
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          data-testid="waiver-confirm-btn"
          variant="default"
          size="sm"
          onClick={onConfirm}
          disabled={!note.trim()}
        >
          Confirm waiver
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function ValidationSettings() {
  return (
    <div
      data-testid="validation-settings"
      style={{
        padding: "20px 28px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>
          Stage settings · Validation
        </h2>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
          Which rules run and how strict the gate is.
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
          style={{ padding: "10px 16px", fontSize: 12, color: "var(--ink-3)" }}
        >
          Full settings wiring at I1 — strictness, per-rule toggles, waiver
          configuration.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ValidationTool({
  stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = makeMockValidationServices(projectId);

  const [snapshot, send] = useActor(validationToolMachine, {
    input: {
      projectId,
      stageIndex: 17,
      services,
      settings: { allowWaivers: true, strictness: "advisory" },
    },
  });

  const [tab, setTab] = useState("overview");

  const ctx = snapshot.context;
  const isChecking = snapshot.matches("checking");
  const isPassed = snapshot.matches("passed");
  const isBlocked = snapshot.matches("blocked");
  const isWaiving = snapshot.matches({ blocked: "waiving" });
  const isError = snapshot.matches("loadError");

  const errorCount = ctx.counts?.error ?? 0;

  if (isChecking) {
    return (
      <div
        data-testid="validation-checking"
        data-stage-id={stageId}
        style={{ padding: "20px 28px", color: "var(--ink-3)", fontSize: 13 }}
      >
        Running pre-flight checks…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        data-testid="validation-load-error"
        style={{
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--mismatch)" }}>
          {ctx.error?.message ?? "Failed to run checks"}
        </div>
        <Button
          data-testid="validation-retry-btn"
          variant="default"
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
      data-testid="validation-tool"
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
            <GateCard passed={isPassed} errorCount={errorCount} />

            <div style={{ display: "flex", gap: 12 }}>
              <StatTile
                label="pass"
                value={ctx.counts?.pass ?? 0}
                tone="exact"
              />
              <StatTile
                label="warnings"
                value={ctx.counts?.warn ?? 0}
                tone="fuzzy"
              />
              <StatTile label="errors" value={errorCount} tone="mismatch" />
              <StatTile label="rules" value={ctx.rules.length} />
            </div>

            {isWaiving && ctx.waiverDraft && (
              <WaiverDialog
                ruleId={ctx.waiverDraft.ruleId}
                note={ctx.waiverDraft.note}
                onSetNote={(note) => send({ type: "SET_NOTE", note })}
                onConfirm={() => send({ type: "CONFIRM_WAIVE" })}
                onCancel={() => send({ type: "CANCEL" })}
              />
            )}

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
                    Pre-flight checks
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    {ctx.rules.length} rules · errors block the build, warnings
                    are advisory
                  </div>
                </div>
                <Button
                  data-testid="rerun-checks-btn"
                  variant="default"
                  size="sm"
                  onClick={() => send({ type: "RERUN_CHECKS" })}
                  disabled={isBlocked && isWaiving}
                >
                  Re-run checks
                </Button>
              </div>
              <div style={{ padding: "0 16px" }}>
                {ctx.rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    allowWaivers={ctx.allowWaivers}
                    onFix={(ruleId) => send({ type: "FIX", ruleId })}
                    onWaive={(ruleId) => send({ type: "WAIVE", ruleId })}
                  />
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <ValidationSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
