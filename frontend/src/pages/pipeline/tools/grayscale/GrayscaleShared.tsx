/**
 * GrayscaleShared — shared primitive components for the Grayscale tool.
 *
 * All components here are co-located with the Grayscale surface and must
 * not be used by other tools (use @pdomain/pdomain-ui primitives instead).
 *
 * Token usage: var(--*) only — no hard-coded colours, no !important.
 */

import type { ReactNode } from "react";
import type { GrayscaleBackend, GrayscaleMode } from "./types";

// ---------------------------------------------------------------------------
// BackendChip — GPU exact-green, CPU fuzzy-amber
// ---------------------------------------------------------------------------

export function BackendChip({
  backend,
  compact = false,
}: {
  backend: GrayscaleBackend;
  compact?: boolean;
}): ReactNode {
  const isGpu = backend === "gpu";
  const color = isGpu ? "var(--exact)" : "var(--fuzzy)";
  const label = isGpu ? "GPU · CUDA" : "CPU · numpy";
  return (
    <span
      data-testid="backend-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "1px 7px" : "2px 8px",
        height: compact ? 18 : 22,
        borderRadius: 99,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 35%, var(--border-1))`,
        color,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        fontFamily: "var(--mono-font, monospace)",
        letterSpacing: ".02em",
      }}
    >
      <span
        style={{
          width: compact ? 5 : 6,
          height: compact ? 5 : 6,
          borderRadius: 99,
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ModePill — perceptual accent / standard neutral
// ---------------------------------------------------------------------------

export function ModePill({ mode }: { mode: GrayscaleMode }): ReactNode {
  const isPerc = mode === "perceptual";
  const color = isPerc ? "var(--accent)" : "var(--ink-3)";
  const bg = isPerc
    ? `color-mix(in oklab, ${color} 14%, transparent)`
    : "var(--bg-raised)";
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 6px",
        height: 16,
        borderRadius: 3,
        background: bg,
        border: `1px solid color-mix(in oklab, ${color} 30%, var(--border-1))`,
        color,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: ".04em",
      }}
    >
      <span
        style={{ width: 5, height: 5, borderRadius: 99, background: color }}
      />
      {isPerc ? "perceptual" : "standard"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// GrayscaleSubhead — section header with optional right slot
// ---------------------------------------------------------------------------

export function GrayscaleSubhead({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        padding: "18px 28px 0",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ink-1)",
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </div>
        {sub != null && (
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {right != null && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flex: "0 0 auto",
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GrayscaleBody — padded flex-col content area
// ---------------------------------------------------------------------------

export function GrayscaleBody({
  children,
  gap = 14,
}: {
  children: ReactNode;
  gap?: number;
}): ReactNode {
  return (
    <div
      style={{
        padding: "14px 28px 28px",
        display: "flex",
        flexDirection: "column",
        gap,
        flex: 1,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatTile — single numeric stat card
// ---------------------------------------------------------------------------

export function StatTile({
  value,
  label,
  tone = "var(--ink-1)",
}: {
  value: string;
  label: string;
  tone?: string;
}): ReactNode {
  return (
    <div
      style={{
        flex: 1,
        padding: "14px 16px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: tone,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          color: "var(--ink-3)",
          letterSpacing: ".04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Divider — vertical separator
// ---------------------------------------------------------------------------

export function VDivider(): ReactNode {
  return (
    <span
      style={{
        width: 1,
        height: 18,
        background: "var(--border-2)",
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// GhostButton — ghost-style button matching design system
// ---------------------------------------------------------------------------

export function GhostButton({
  children,
  onClick,
  "data-testid": testId,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  "data-testid"?: string | undefined;
}): ReactNode {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        height: 24,
        borderRadius: 5,
        border: "1px solid var(--border-2)",
        background: "transparent",
        color: "var(--ink-2)",
        fontSize: 11.5,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PrimaryButton — accent-filled button
// ---------------------------------------------------------------------------

export function PrimaryButton({
  children,
  onClick,
  "data-testid": testId,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  "data-testid"?: string | undefined;
}): ReactNode {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 12px",
        height: 28,
        borderRadius: 6,
        border: "1px solid color-mix(in oklab, var(--accent) 60%, transparent)",
        background: "var(--accent)",
        color: "var(--accent-ink)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
