/**
 * GrayscaleTabBar — tab navigation for the Grayscale tool.
 *
 * Tabs: Overview | Pages (N) | Page workbench | Stage settings
 */

import type { ReactNode } from "react";
import type { GrayscaleTab } from "./types";

const TABS: { id: GrayscaleTab; label: (count?: number) => string }[] = [
  { id: "overview", label: () => "Overview" },
  { id: "pages", label: (n) => (n != null ? `Pages ${n}` : "Pages") },
  { id: "workbench", label: () => "Page workbench" },
  { id: "settings", label: () => "Stage settings" },
];

export function GrayscaleTabBar({
  active,
  onChange,
  pageCount,
}: {
  active: GrayscaleTab;
  onChange: (tab: GrayscaleTab) => void;
  pageCount?: number;
}): ReactNode {
  return (
    <div
      data-testid="grayscale-tab-bar"
      style={{
        display: "flex",
        gap: 2,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-surface)",
        flexShrink: 0,
      }}
    >
      {TABS.map(({ id, label }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            data-testid={`grayscale-tab-${id}`}
            onClick={() => onChange(id)}
            style={{
              padding: "9px 14px",
              border: "none",
              borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              background: "transparent",
              color: isActive ? "var(--ink-1)" : "var(--ink-3)",
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {label(id === "pages" ? pageCount : undefined)}
          </button>
        );
      })}
    </div>
  );
}
