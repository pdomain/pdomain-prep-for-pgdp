import type { ReactNode } from "react";

/**
 * SourceTierBadge — small "from: <tier>" chip displayed next to each field.
 *
 * Tier color coding:
 *   page     — accent (user has a page-level override)
 *   project  — ocr amber (project-level default)
 *   all      — fuzzy amber (app-wide default)
 *   registry — neutral ink-4 (built-in registry default)
 */
export function SourceTierBadge({
  tier,
  testId,
}: {
  tier: string | undefined;
  testId?: string;
}): ReactNode {
  const label = tier ?? "registry";
  const colorMap: Record<string, string> = {
    page: "var(--accent)",
    project: "var(--ocr)",
    all: "var(--fuzzy)",
    registry: "var(--ink-4)",
  };
  const color = colorMap[label] ?? "var(--ink-4)";

  return (
    <span
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        height: 16,
        borderRadius: 3,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 30%, var(--border-1))`,
        color,
        fontFamily: "var(--mono-font, monospace)",
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: ".03em",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      from: {label}
    </span>
  );
}
