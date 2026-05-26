// TODO(s0-b): replace with pd-ui KeyCap when pd-ui's API matches local usage.
// pd-ui KeyCap uses keys: string | string[] prop (renders <kbd> elements internally).
// This app calls <KeyCap>{k}</KeyCap> with children: ReactNode — incompatible.
// Callers would need to change to <KeyCap keys={k} /> to adopt pd-ui's version.
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface KeyCapProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function KeyCap({
  children,
  className,
  "data-testid": testId,
}: KeyCapProps) {
  return (
    <kbd
      data-testid={testId}
      className={cn(
        "inline-flex items-center justify-center rounded border border-border-2 bg-bg-raised px-1.5 py-0.5 font-mono text-xs text-ink-2 shadow-sm",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
