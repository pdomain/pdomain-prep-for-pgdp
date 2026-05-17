/**
 * Tooltip — Radix-backed tooltip primitive (§13a shadcn/ui adoption).
 *
 * Thin wrapper around `@radix-ui/react-tooltip`. Radix handles:
 *   - `role="tooltip"` + `aria-describedby` wiring on the trigger.
 *   - Hover + focus open/close with configurable delay.
 *   - Escape-to-close.
 *   - Portal so z-index stacking is always correct.
 *   - `data-state="delayed-open"|"instant-open"|"closed"` for CSS transitions.
 *
 * Wrap your app (or the relevant subtree) in `<TooltipProvider>` once.
 * Then compose `<Tooltip>` + `<TooltipTrigger>` + `<TooltipContent>`.
 *
 * For cases where a native `title` attribute suffices (simple browser-default
 * tooltip on a single element, no custom styling needed) a native attribute
 * is fine. Use this wrapper when you need consistent cross-browser styling,
 * a11y `aria-describedby` wiring, or hover-delay control.
 *
 * Future callers should import from this wrapper, not directly from
 * `@radix-ui/react-tooltip`.
 */
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface TooltipProviderProps {
  children: ReactNode;
  /** Delay in ms before tooltip opens on hover. Default: 700. */
  delayDuration?: number;
  /** Delay in ms to skip open delay when moving between tooltips. */
  skipDelayDuration?: number;
}

export function TooltipProvider({
  children,
  delayDuration = 700,
  skipDelayDuration,
}: TooltipProviderProps) {
  return (
    <RadixTooltip.Provider
      delayDuration={delayDuration}
      {...(skipDelayDuration !== undefined && { skipDelayDuration })}
    >
      {children}
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  /** Override the provider's delayDuration for this tooltip. */
  delayDuration?: number;
}

export function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  children,
  delayDuration,
}: TooltipProps) {
  return (
    <RadixTooltip.Root
      {...(open !== undefined && { open })}
      {...(defaultOpen !== undefined && { defaultOpen })}
      {...(onOpenChange !== undefined && { onOpenChange })}
      {...(delayDuration !== undefined && { delayDuration })}
    >
      {children}
    </RadixTooltip.Root>
  );
}

export interface TooltipTriggerProps {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
}

export function TooltipTrigger({
  children,
  className,
  asChild,
}: TooltipTriggerProps) {
  return (
    <RadixTooltip.Trigger
      {...(asChild !== undefined && { asChild })}
      className={className}
    >
      {children}
    </RadixTooltip.Trigger>
  );
}

export type TooltipContentProps = Omit<
  ComponentPropsWithoutRef<typeof RadixTooltip.Content>,
  "children"
> & {
  children: ReactNode;
  className?: string;
};

export function TooltipContent({
  children,
  className,
  side = "top",
  sideOffset = 4,
  ...rest
}: TooltipContentProps) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        side={side}
        sideOffset={sideOffset}
        className={className}
        {...rest}
      >
        {children}
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  );
}
