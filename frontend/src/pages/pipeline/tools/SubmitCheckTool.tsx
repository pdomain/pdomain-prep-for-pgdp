/**
 * SubmitCheckTool — React surface for the Submit Check stage tool.
 *
 * Drives `submitCheckToolMachine`. Two tabs:
 * - **Overview** — Dry-run gate + checks list + manual SUBMIT two-step confirm
 * - **Settings** — Safety toggles
 *
 * The two-step SUBMIT confirm (GateConfirmation) is the key UX invariant:
 *   SUBMIT button → if confirmOnSubmit → confirmation dialog → CONFIRM → submitted
 *
 * There is no live API upload. The flow is:
 *   1. Dry run passes → "Download package" link appears.
 *   2. User downloads the zip and uploads it manually to dpscans folder.
 *   3. User clicks "Mark as submitted" → confirm dialog confirms manual step.
 *   4. CONFIRM → submitted (final, attestation recorded).
 *
 * CT 2026-06-11: liveSubmit replaced by manual attestation flow per CT directive.
 *
 * @see src/machines/tools/submitCheckTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/submit_check/submit-check.jsx
 * @see docs/architecture/statechart-convergence-notes.md §Open questions #4
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  submitCheckToolMachine,
  type SubmitCheck,
  type SubmitCheckToolServices,
} from "@/machines/tools/submitCheckTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { buildRealSubmitCheckToolServices } from "@/services/tools/submitCheckTool";

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

/**
 * Manual-attestation confirm dialog.
 *
 * Copy explains the manual upload step required before confirming.
 */
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
        Confirm manual submission to PGDP
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
        Before confirming, upload the zip to your{" "}
        <strong>dpscans folder on pgdp.net</strong>. Once you have done that,
        click <em>Confirm</em> to record that you have submitted the package.
        This is a manual step — there is no automated upload.
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
          Confirm — I uploaded the zip
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
  _testServices,
}: ToolSlotProps & { _testServices?: SubmitCheckToolServices }): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = _testServices ?? buildRealSubmitCheckToolServices();

  const [snapshot, send] = useActor(submitCheckToolMachine, {
    input: {
      projectId,
      stageIndex: 21,
      services,
      settings: { confirmOnSubmit: true },
    },
  });

  const [tab, setTab] = useState("overview");

  const ctx = snapshot.context;
  const isDryRunning = snapshot.matches("dryRunning");
  const isBlocked = snapshot.matches("blocked");
  const isReady = snapshot.matches("ready");
  const isConfirming = snapshot.matches("confirmingSubmit");
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
              Marked as submitted
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-3)" }}>
              Attested at{" "}
              {ctx.submittedAt
                ? new Date(ctx.submittedAt).toLocaleString()
                : "unknown time"}
              . Upload your zip to pgdp.net if you have not already. Pipeline
              complete.
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
                      ? "Dry run passed · ready to submit"
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
                      ? "Download the zip and upload it to your dpscans folder on pgdp.net."
                      : "Resolve the failing checks before submitting; nothing was uploaded."}
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

            {/* Download + submit actions */}
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
                  destination
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--ink-4)",
                    fontFamily: "var(--mono-font, monospace)",
                    marginTop: 2,
                  }}
                >
                  manual upload
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
                    Simulates acceptance checks without uploading
                  </div>
                </div>
                {/* Download package affordance — visible when dry run passed */}
                {isReady && (
                  <a
                    data-testid="download-package-link"
                    href={`/api/data/projects/${projectId}/project-stages/zip/artifact`}
                    download
                    style={{
                      fontSize: 12,
                      color: "var(--ocr)",
                      textDecoration: "none",
                      border: "1px solid var(--border-1)",
                      borderRadius: 6,
                      padding: "4px 10px",
                    }}
                  >
                    Download package
                  </a>
                )}
                {!isConfirming && (
                  <Button
                    data-testid="submit-btn"
                    variant="primary"
                    size="sm"
                    disabled={!isReady || isBlocked || isDryRunning}
                    onClick={() => send({ type: "SUBMIT" })}
                  >
                    Mark as submitted…
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
                Safety and confirmation settings.
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
                    Confirm on submit
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Show confirmation dialog before marking as submitted
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
                    Upload destination
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      marginTop: 2,
                    }}
                  >
                    Where to upload the zip
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--mono-font, monospace)",
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                  }}
                >
                  dpscans folder on pgdp.net (manual)
                </span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
