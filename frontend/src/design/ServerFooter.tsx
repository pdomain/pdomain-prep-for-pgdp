/**
 * ServerFooter — PGDP-specific server-address footer.
 *
 * Displays the active local server address (127.0.0.1:<port>) and a
 * copy-to-clipboard button. Appears at the bottom of every app screen.
 *
 * Disposition: stays app-local (see docs/specs/library-placement.md §1.1).
 * No pdomain-ui equivalent; PGDP-domain concept.
 *
 * Token-only styling; no hex literals.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ServerFooterProps {
  /** The server address to display (e.g. "127.0.0.1:8765"). */
  address?: string;
  /** Called when the user clicks the copy icon. */
  onCopy?: () => void;
  className?: string;
  "data-testid"?: string;
  "data-screen-label"?: string;
}

/**
 * Minimal inline copy icon (single-source; imports lucide only via pdomain-ui/icons
 * but kept inline here to avoid a dep for a single glyph in the design atom).
 */
function CopyIcon({ size = 11 }: { size?: number }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function ServerFooter({
  address = "127.0.0.1:8765",
  onCopy,
  className,
  "data-testid": testId,
  "data-screen-label": screenLabel,
}: ServerFooterProps) {
  return (
    <footer
      data-testid={testId ?? "server-footer"}
      data-screen-label={screenLabel}
      className={cn(
        "flex h-[26px] flex-none items-center justify-center gap-2 border-t border-border-1 bg-bg-page font-mono text-[10.5px] text-ink-3",
        className,
      )}
    >
      <span>server:</span>
      <span className="text-ink-2">{address}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy server address"
        className="text-ink-4 hover:text-ink-2 transition-colors"
      >
        <CopyIcon size={11} />
      </button>
    </footer>
  );
}
