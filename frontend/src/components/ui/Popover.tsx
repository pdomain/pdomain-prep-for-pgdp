/**
 * Popover — Radix-backed floating panel primitive (M5 hi-fi adoption, §13a).
 *
 * Thin wrapper around `@radix-ui/react-popover`.  Radix handles:
 *   - Focus trap within the floating panel.
 *   - Escape-to-close.
 *   - Click-outside dismiss.
 *   - Portal so z-index stacking is always correct.
 *   - `aria-expanded` on the trigger.
 *
 * Callers control positioning via the `side`, `align`, and `sideOffset`
 * props passed to `<PopoverContent>`.
 */
import * as RadixPopover from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

export function Popover({ open, onOpenChange, children }: PopoverProps) {
  return (
    <RadixPopover.Root
      {...(open !== undefined && { open })}
      {...(onOpenChange !== undefined && { onOpenChange })}
    >
      {children}
    </RadixPopover.Root>
  );
}

export interface PopoverTriggerProps {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
}

export function PopoverTrigger({
  children,
  className,
  asChild,
}: PopoverTriggerProps) {
  return (
    <RadixPopover.Trigger
      {...(asChild !== undefined && { asChild })}
      className={className}
    >
      {children}
    </RadixPopover.Trigger>
  );
}

export type PopoverContentProps = Omit<
  ComponentPropsWithoutRef<typeof RadixPopover.Content>,
  "children"
> & {
  children: ReactNode;
  className?: string;
};

export function PopoverContent({
  children,
  className,
  side = "bottom",
  align = "end",
  sideOffset = 4,
  ...rest
}: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
