/**
 * SourceToolWorkbench — Workbench tab sub-component for the Source stage tool.
 *
 * Exports:
 *   SourcePageWorkbench — per-page role/metadata editor
 *
 * Split from SourceTool.tsx (Fix 4: file too large).
 * No behavior change — only code organisation.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 * @see src/pages/pipeline/tools/SourceTool.tsx — main entry point
 */

import type { ReactNode } from "react";
import type { FileRow, FileState } from "@/machines/tools/source";

// ---------------------------------------------------------------------------
// RoleSegment
// ---------------------------------------------------------------------------

const SOURCE_ROLES: {
  id: FileState;
  label: string;
  tone: string;
}[] = [
  { id: "cover", label: "Cover", tone: "var(--ocr)" },
  { id: "page", label: "Body", tone: "var(--exact)" },
  { id: "blank", label: "Blank", tone: "var(--ink-3)" },
  { id: "inserted", label: "Insert", tone: "var(--fuzzy)" },
  { id: "duplicate", label: "Skip", tone: "var(--mismatch)" },
];

/** Workbench role segment control for per-page role assignment. */
function RoleSegment({
  activeRole,
  onChange,
}: {
  activeRole: FileState;
  onChange: (role: FileState) => void;
}): ReactNode {
  return (
    <div
      data-testid="workbench-role-segment"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${SOURCE_ROLES.length}, 1fr)`,
        gap: 4,
        padding: 3,
        background: "var(--bg-page)",
        border: "1px solid var(--border-1)",
        borderRadius: 7,
      }}
    >
      {SOURCE_ROLES.map((r) => {
        const active = r.id === activeRole;
        return (
          <button
            key={r.id}
            type="button"
            data-testid={`role-btn-${r.id}`}
            onClick={() => onChange(r.id)}
            style={{
              border: active
                ? `1px solid color-mix(in oklab, ${r.tone} 45%, var(--border-1))`
                : "1px solid transparent",
              cursor: "pointer",
              padding: "6px 4px",
              borderRadius: 5,
              background: active
                ? `color-mix(in oklab, ${r.tone} 14%, var(--bg-surface))`
                : "transparent",
              color: active ? r.tone : "var(--ink-3)",
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FakeThumb (local copy for the viewer pane)
// ---------------------------------------------------------------------------

/** Fake thumb for the workbench viewer pane (no actual image). */
function FakeThumb({
  tone = "light",
  kind,
  width,
  height,
}: {
  tone?: "light" | "mid" | "dark";
  kind?: string;
  width: number;
  height: number;
}): ReactNode {
  const paper =
    tone === "dark"
      ? "oklch(0.72 0.02 80)"
      : tone === "mid"
        ? "oklch(0.86 0.02 80)"
        : "oklch(0.95 0.012 85)";
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 3,
        background: paper,
        boxShadow: "inset 0 0 0 1px rgba(40,30,20,0.15)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {kind !== "blank" && (
        <div
          style={{
            position: "absolute",
            inset: "14% 12% 14% 12%",
            backgroundImage: `repeating-linear-gradient(to bottom, oklch(0.34 0.02 60) 0 1.5px, transparent 1.5px 7px)`,
            opacity: 0.7,
          }}
        />
      )}
      {kind === "blank" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-4)",
            fontSize: 10,
            fontFamily: "var(--mono-font)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          blank
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourcePageWorkbench
// ---------------------------------------------------------------------------

/** Full workbench tab for the source stage. */
export function SourcePageWorkbench({
  file,
  onRoleChange,
  onApply,
  onPrev,
  onNext,
}: {
  file: FileRow | null;
  onRoleChange: (idx: number, role: FileState) => void;
  onApply: () => void;
  onPrev: () => void;
  onNext: () => void;
}): ReactNode {
  if (!file) {
    return (
      <div
        style={{
          padding: "20px 28px 28px",
          color: "var(--ink-4)",
          fontSize: 13,
        }}
      >
        No page selected.
      </div>
    );
  }

  const isInserted = file.state === "inserted";

  return (
    <>
      {/* Subheader */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "18px 28px 0",
          gap: 14,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink-1)",
              letterSpacing: "-0.005em",
            }}
          >
            Page workbench · Source
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            Per-page metadata for the raw ingested scan. Set the role, page
            number, rotation, and tone hint.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            data-testid="workbench-prev-btn"
            onClick={onPrev}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 5,
              background: "transparent",
              border: "1px solid var(--border-2)",
              color: "var(--ink-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ← Prev
          </button>
          <button
            type="button"
            data-testid="workbench-next-btn"
            onClick={onNext}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 5,
              background: "transparent",
              border: "1px solid var(--border-2)",
              color: "var(--ink-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Next →
          </button>
          <div
            style={{ width: 1, height: 22, background: "var(--border-2)" }}
          />
          <button
            type="button"
            data-testid="workbench-apply-btn"
            onClick={onApply}
            style={{
              height: 28,
              padding: "0 14px",
              borderRadius: 5,
              background: "var(--accent)",
              border: "none",
              color: "var(--accent-ink)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Apply & Continue →
          </button>
        </div>
      </div>

      {/* Two-pane layout */}
      <div
        style={{
          padding: "14px 28px 28px",
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          gap: 14,
        }}
      >
        {/* Controls pane */}
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
          {/* Pane header */}
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border-1)",
            }}
          >
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              Page metadata
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-1)",
                marginTop: 3,
              }}
            >
              {file.stem}
            </div>
          </div>

          {/* Pane body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Role */}
            <div>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                  marginBottom: 6,
                }}
              >
                Role
              </div>
              <RoleSegment
                activeRole={file.state}
                onChange={(role) => onRoleChange(file.idx, role)}
              />
            </div>

            {/* Page number */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 5,
                  }}
                >
                  Page number
                </div>
                <div
                  style={{
                    height: 28,
                    padding: "0 10px",
                    background: "var(--bg-page)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12,
                    color: "var(--ink-1)",
                    fontFamily: "var(--mono-font)",
                  }}
                >
                  {file.pageNumber ?? "—"}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 5,
                  }}
                >
                  Section
                </div>
                <div
                  style={{
                    height: 28,
                    padding: "0 10px",
                    background: "var(--bg-page)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                    color: "var(--ink-1)",
                  }}
                >
                  <span>Body</span>
                  <span style={{ color: "var(--ink-3)" }}>▾</span>
                </div>
              </div>
            </div>

            {/* Insert note (only for inserted pages) — Src-WB2 */}
            {isInserted && file.note && (
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 5,
                  }}
                >
                  Insert note
                </div>
                <div
                  data-testid="workbench-insert-note"
                  style={{
                    padding: "8px 10px",
                    background: "var(--bg-page)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    fontSize: 11.5,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {file.note}
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div
              style={{
                marginTop: 4,
                padding: "10px 12px",
                borderRadius: 7,
                background: "var(--bg-page)",
                border: "1px solid var(--border-1)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                }}
              >
                Actions
              </span>
              <button
                type="button"
                data-testid="workbench-replace-btn"
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                ↑ Replace scan…
              </button>
              <button
                type="button"
                data-testid="workbench-insert-after-btn"
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                + Insert page after this…
              </button>
              <button
                type="button"
                data-testid="workbench-remove-btn"
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--mismatch)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                ✕ Remove from project
              </button>
            </div>
          </div>
        </div>

        {/* Viewer pane */}
        <div
          data-testid="source-viewer"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            minHeight: 400,
            overflow: "hidden",
          }}
        >
          {/* Viewer toolbar */}
          <div
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border-1)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: 11.5,
                color: "var(--ink-1)",
                fontWeight: 600,
                fontFamily: "var(--mono-font)",
              }}
            >
              {file.stem}
            </span>
          </div>

          {/* Viewer body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              padding: 18,
              background: "var(--bg-page)",
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              overflow: "auto",
            }}
          >
            <FakeThumb
              tone={file.tone ?? "light"}
              {...(file.state === "blank" ? { kind: "blank" } : {})}
              width={320}
              height={420}
            />
          </div>
        </div>
      </div>
    </>
  );
}
