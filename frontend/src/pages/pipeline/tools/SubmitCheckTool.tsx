/**
 * SubmitCheckTool — React surface for the Submit Check stage tool.
 *
 * Drives `submitCheckToolMachine`. Two tabs:
 * - **Overview** — Dry-run gate + checks list + SUBMIT two-step confirm
 * - **Settings** — Target (Production/Sandbox), safety toggles, credentials
 *
 * The two-step SUBMIT confirm (GateConfirmation) is the key UX invariant:
 *   SUBMIT button → if confirmOnSubmit → confirmation dialog → CONFIRM → upload
 *
 * @see src/machines/tools/submitCheckTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/submit_check/submit-check.jsx
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  submitCheckToolMachine,
  type SubmitCheckToolServices,
  type SubmitCheck,
} from "@/machines/tools/submitCheckTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

const MOCK_CHECKS: SubmitCheck[] = [
  { ok: true, label: "File naming scheme matches PGDP convention" },
  { ok: true, label: "Package size within upload limits (1.38 GB)" },
  { ok: true, label: "Manifest SHA-256 verified" },
  { ok: true, label: "Metadata fields complete" },
  { ok: true, label: "No unsupported characters in text files" },
];

function makeMockSubmitCheckServices(
  _projectId: string,
): SubmitCheckToolServices {
  return {
    dryRun: (_pid, _target) => Promise.resolve(MOCK_CHECKS),
    liveSubmit: (_pid, _target) =>
      Promise.resolve({ at: new Date().toISOString() }),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CheckRow({ check }: { check: SubmitCheck }) {
  const color = check.ok ? "var(--exact)" : "var(--mismatch)";
  return (
    <div
      data-testid={`check-row-${check.ok ? "ok" : "fail"}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 0",
        borderTop: "1px solid var(--border-1)",
      }}
    >
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
        {check.ok ? "✓" : "✕"}
      </span>
      <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-1)" }}>
        {check.label}
      </span>
    </div>
  );
}

function ConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="submit-confirm-dialog"
      style={{
        background: "var(--bg-surface)",
        border:
          "1px solid color-mix(in oklab, var(--mismatch) 40%, var(--border-1))",
        borderRadius: 10,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>
        Confirm live submission to PGDP
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        This will upload the package to pgdp.net. This action is{" "}
        <strong>irreversible</strong> — once submitted, the project enters the
        PGDP proofing queue. Make sure the dry run passed and all settings are
        correct before confirming.
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Button
          data-testid="submit-cancel-btn"
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          data-testid="submit-confirm-btn"
          variant="primary"
          size="sm"
          onClick={onConfirm}
          style={{
            background: "var(--mismatch)",
            borderColor: "var(--mismatch)",
          }}
        >
          Submit to PGDP
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SubmitCheckTool({
  stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = makeMockSubmitCheckServices(projectId);

  const [snapshot, send] = useActor(submitCheckToolMachine, {
    input: {
      projectId,
      stageIndex: 21,
      services,
      settings: { confirmOnSubmit: true, target: "production" },
    },
  });

  const [tab, setTab] = useState("overview");

  const ctx = snapshot.context;
  const isDryRunning = snapshot.matches("dryRunning");
  const isBlocked = snapshot.matches("blocked");
  const isReady = snapshot.matches("ready");
  const isConfirming = snapshot.matches("confirmingSubmit");
  const isSubmitting = snapshot.matches("submitting");
  const isSubmitted = snapshot.matches("submitted");
  const isFailed = snapshot.matches("failed");

  const allOk = ctx.checks.every((c) => c.ok);

  if (isSubmitted) {
    return (
      <div
        data-testid="submitted-final"
        data-stage-id={stageId}
        style={{
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
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
            }}
          >
            ✓
          </div>
          <div>
            <div
              style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}
            >
              Submitted to PGDP
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-3)" }}>
              Project accepted at{" "}
              {ctx.submittedAt
                ? new Date(ctx.submittedAt).toLocaleString()
                : "unknown time"}
              . Pipeline complete.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="submit-check-tool"
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
            {/* Gate card */}
            {!isDryRunning && (
              <div
                data-testid={allOk ? "dry-run-passed" : "dry-run-blocked"}
                style={{
                  borderRadius: 10,
                  border: `1px solid color-mix(in oklab, ${allOk ? "var(--exact)" : "var(--fuzzy)"} 40%, var(--border-1))`,
                  background: `color-mix(in oklab, ${allOk ? "var(--exact)" : "var(--fuzzy)"} 7%, var(--bg-surface))`,
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
                    background: `color-mix(in oklab, ${allOk ? "var(--exact)" : "var(--fuzzy)"} 18%, var(--bg-surface))`,
                    color: allOk ? "var(--exact)" : "var(--fuzzy)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {allOk ? "✓" : "!"}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                    }}
                  >
                    {allOk
                      ? "Dry run passed · safe to submit"
                      : `Dry run found ${ctx.checks.filter((c) => !c.ok).length} blocker(s)`}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 12,
                      color: "var(--ink-3)",
                    }}
                  >
                    {allOk
                      ? "No live upload yet — this simulates the PGDP submission end-to-end."
                      : "Resolve the failing checks before a live submission; nothing was uploaded."}
                  </div>
                </div>
              </div>
            )}

            {isDryRunning && (
              <div
                data-testid="dry-running"
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  padding: "4px 0",
                }}
              >
                Running dry-run checks…
              </div>
            )}

            {isFailed && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: "var(--mismatch)" }}>
                  {ctx.error?.message ?? "Dry run failed"}
                </span>
                <Button
                  data-testid="submit-retry-btn"
                  variant="default"
                  size="sm"
                  onClick={() => send({ type: "RETRY" })}
                >
                  Retry
                </Button>
              </div>
            )}

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
                    color: "var(--ocr)",
                    fontFamily: "var(--mono-font, monospace)",
                  }}
                >
                  pgdp.net
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
                  target
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--ink-4)",
                    fontFamily: "var(--mono-font, monospace)",
                    marginTop: 2,
                  }}
                >
                  {ctx.target}
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
                  data-testid="checks-stat"
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    color: allOk ? "var(--exact)" : "var(--fuzzy)",
                    fontFamily: "var(--mono-font, monospace)",
                  }}
                >
                  {ctx.checks.filter((c) => c.ok).length} / {ctx.checks.length}
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
                  checks
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
                  dry run
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
                  mode
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--ink-4)",
                    fontFamily: "var(--mono-font, monospace)",
                    marginTop: 2,
                  }}
                >
                  no upload
                </div>
              </div>
            </div>

            {/* Confirmation dialog */}
            {isConfirming && (
              <ConfirmDialog
                onConfirm={() => send({ type: "CONFIRM" })}
                onCancel={() => send({ type: "CANCEL" })}
              />
            )}

            {/* Checks list */}
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
                    Submission dry run
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Simulates the upload + server-side acceptance checks
                  </div>
                </div>
                {!isConfirming && !isSubmitting && (
                  <Button
                    data-testid="submit-btn"
                    variant="primary"
                    size="sm"
                    disabled={!isReady || isBlocked || isDryRunning}
                    onClick={() => send({ type: "SUBMIT" })}
                  >
                    {isSubmitting ? "Submitting…" : "Submit to PGDP…"}
                  </Button>
                )}
                {(isReady || isBlocked) && (
                  <Button
                    data-testid="rerun-dry-btn"
                    variant="ghost"
                    size="sm"
                    onClick={() => send({ type: "RERUN_DRY" })}
                  >
                    Re-run dry run
                  </Button>
                )}
              </div>
              <div style={{ padding: "0 16px" }}>
                {ctx.checks.map((check, i) => (
                  <CheckRow key={i} check={check} />
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div
            data-testid="submit-check-settings"
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
                Stage settings · Submit check
              </h2>
              <div
                style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}
              >
                Submission target and safety.
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
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>Target</div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    PGDP environment
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono-font, monospace)",
                    fontSize: 12,
                    color: "var(--ink-2)",
                  }}
                >
                  {ctx.target}
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
                    Confirm on submit
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Extra confirmation before live upload
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono-font, monospace)",
                    fontSize: 11,
                    color: ctx.confirmOnSubmit
                      ? "var(--exact)"
                      : "var(--ink-4)",
                  }}
                >
                  {ctx.confirmOnSubmit ? "on" : "off"}
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
                    Credentials
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    pgdp.net API token
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono-font, monospace)",
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                  }}
                >
                  •••• configured
                </span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
