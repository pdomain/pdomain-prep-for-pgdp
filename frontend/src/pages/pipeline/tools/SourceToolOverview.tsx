/**
 * SourceToolOverview — Overview tab sub-component for the Source stage tool.
 *
 * Exports:
 *   SourceOverview   — stat grid + CTA to open the Files tab
 *
 * Split from SourceTool.tsx (Fix 4: file too large).
 * No behavior change — only code organisation.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 * @see src/pages/pipeline/tools/SourceTool.tsx — main entry point
 */

import type { ReactNode } from "react";
import type { FileTotals } from "@/machines/tools/source";
import { SourceBanner } from "./SourceToolFiles";

/** Source Overview tab. */
export function SourceOverview({
  totals,
  isGenerating,
  onOpenFiles,
}: {
  totals: FileTotals | null;
  isGenerating: boolean;
  onOpenFiles: () => void;
}): ReactNode {
  if (!totals) {
    return (
      <div
        style={{
          padding: "20px 28px 28px",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  const m = totals.marked;
  const statItems = [
    {
      label: "files",
      value: totals.files,
      tone: "var(--ink-1)",
    },
    {
      label: "thumbnails",
      value: `${totals.thumbed}/${totals.files}`,
      tone: isGenerating ? "var(--ocr)" : "var(--exact)",
    },
    {
      label: "pages",
      value: m.page,
      tone: "var(--exact)",
      sub: "in this project",
    },
    {
      label: "skipped",
      value: m.cover + m.back + m.blank + m.duplicate,
      tone: "var(--gt, #84cc16)",
      sub: "not in proofing",
    },
    { label: "inserts", value: m.inserted, tone: "var(--accent)" },
    {
      label: "unmarked",
      value: totals.unmarked,
      tone: totals.unmarked > 0 ? "var(--fuzzy)" : "var(--ink-2)",
      sub: totals.unmarked > 0 ? "needs review" : "all reviewed",
    },
  ];

  return (
    <div
      style={{
        padding: "20px 28px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <SourceBanner isGenerating={isGenerating} totals={totals} />

      {/* Stats grid */}
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
        {statItems.map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--bg-surface)",
              padding: "14px 14px 12px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--ink-3)",
                letterSpacing: ".04em",
                textTransform: "uppercase",
              }}
            >
              {stat.label}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 18,
                fontWeight: 600,
                color: stat.tone,
                letterSpacing: "-0.01em",
                fontFamily: "var(--mono-font)",
              }}
            >
              {stat.value}
            </div>
            {stat.sub && (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                  fontFamily: "var(--mono-font)",
                }}
              >
                {stat.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* CTA row */}
      <div
        style={{
          padding: "14px 16px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
            {isGenerating ? "Waiting for thumbnails…" : "Review page selection"}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
            Open the Files tab to mark covers and inserts. Confirm to advance.
          </div>
        </div>
        <button
          type="button"
          data-testid="overview-open-files-btn"
          onClick={onOpenFiles}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 6,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            color: "var(--ink-1)",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          Open Files →
        </button>
      </div>
    </div>
  );
}
