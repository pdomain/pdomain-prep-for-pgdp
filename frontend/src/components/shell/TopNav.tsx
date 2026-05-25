import { Link } from "react-router-dom";
import { type ReactNode } from "react";

interface TopNavProps {
  breadcrumb?: ReactNode;
  centerSlot?: ReactNode;
  rightSlot?: ReactNode;
  "data-testid"?: string;
}

export function TopNav({
  breadcrumb,
  centerSlot,
  rightSlot,
  "data-testid": testId,
}: TopNavProps) {
  return (
    <nav
      data-testid={testId ?? "top-nav"}
      className="flex h-14 items-center justify-between bg-accent px-4 text-accent-ink"
    >
      {/* Left: brand + breadcrumb */}
      <div className="flex items-center gap-3">
        {/* Brand glyph: amber gradient square with "p" */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-gradient-to-br from-amber-400 to-amber-600 text-sm font-bold text-accent-ink select-none">
            p
          </span>
          <span className="text-sm font-semibold text-accent-ink">
            pgdp-prep
          </span>
        </Link>
        {/* Breadcrumb slot */}
        {breadcrumb && (
          <>
            <span className="text-ink-3">/</span>
            <div className="flex items-center gap-1 text-sm text-ink-4">
              {breadcrumb}
            </div>
          </>
        )}
      </div>

      {/* Center: search pill placeholder */}
      <div className="flex-1 flex justify-center px-8 max-w-sm mx-auto">
        {centerSlot ?? (
          <button
            className="flex w-full items-center gap-2 rounded-md border border-border-3 bg-raised px-3 py-1.5 text-sm text-ink-3 hover:border-border-3 hover:text-ink-2 transition-colors"
            aria-label="Search (⌘K)"
          >
            <span className="flex-1 text-left">Search projects…</span>
            <kbd className="ml-auto text-xs text-ink-3 font-mono">⌘K</kbd>
          </button>
        )}
      </div>

      {/* Right: bell + user menu */}
      <div className="flex items-center gap-2">{rightSlot}</div>
    </nav>
  );
}
