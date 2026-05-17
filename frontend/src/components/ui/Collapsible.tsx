/**
 * Collapsible — Radix-backed show/hide primitive (M5 hi-fi adoption).
 *
 * Thin wrapper around `@radix-ui/react-collapsible` that exposes the
 * same ergonomic API as the other ui/ wrappers in this codebase.
 *
 * Accessibility handled by Radix:
 *   - `aria-expanded` toggled automatically on the trigger.
 *   - Content is unmounted when closed (zero-height, not display:none)
 *     so assistive tech can ignore it.
 *   - `data-state="open"|"closed"` on both Root and Content for CSS hooks.
 */
import * as RadixCollapsible from "@radix-ui/react-collapsible";
import type { ReactNode } from "react";

export interface CollapsibleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function Collapsible({
  open,
  onOpenChange,
  children,
  className,
}: CollapsibleProps) {
  return (
    <RadixCollapsible.Root
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    >
      {children}
    </RadixCollapsible.Root>
  );
}

export interface CollapsibleTriggerProps {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
}

export function CollapsibleTrigger({
  children,
  className,
  asChild,
}: CollapsibleTriggerProps) {
  return (
    <RadixCollapsible.Trigger
      {...(asChild !== undefined && { asChild })}
      className={className}
    >
      {children}
    </RadixCollapsible.Trigger>
  );
}

export interface CollapsibleContentProps {
  children: ReactNode;
  className?: string;
}

export function CollapsibleContent({
  children,
  className,
}: CollapsibleContentProps) {
  return (
    <RadixCollapsible.Content className={className}>
      {children}
    </RadixCollapsible.Content>
  );
}
