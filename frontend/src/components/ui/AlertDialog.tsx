/**
 * AlertDialog — Radix-backed confirmation primitive (§13a step 1b).
 *
 * Sibling of `Dialog` but for *destructive / blocking confirmations*: the
 * WAI-ARIA "alertdialog" pattern. Differences from `Dialog`:
 *
 *   - `role="alertdialog"` (Radix sets this automatically).
 *   - The overlay click does NOT dismiss — only an explicit Action or
 *     Cancel does. Escape still closes (Radix wires both).
 *   - Initial focus lands on the Cancel button per the WAI-ARIA pattern,
 *     so a user who fat-fingered the trigger doesn't blow away their
 *     project by hitting Enter.
 *
 * Usage shape mirrors the `Dialog` wrapper to keep the call sites
 * uniform: callers pass `<AlertDialog open onOpenChange>` with a
 * `<AlertDialogContent>` containing `<AlertDialogTitle>`,
 * `<AlertDialogDescription>`, `<AlertDialogCancel>` and
 * `<AlertDialogAction>`. Buttons compose Radix's primitives with the
 * Tailwind classes the call sites were already using inline so no
 * caller has to re-derive the destructive button look.
 *
 * Test contract (Radix-derived, same as `Dialog`):
 *   - `role="alertdialog"` with accessible name from `<AlertDialogTitle>`
 *   - Body scroll-lock attribute `data-scroll-locked` while open
 *   - Escape closes
 *   - Outside click does NOT close (the WAI-ARIA distinction)
 */
import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import type { ReactNode } from "react";

export interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function AlertDialog({
  open,
  onOpenChange,
  children,
}: AlertDialogProps) {
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixAlertDialog.Root>
  );
}

export interface AlertDialogContentProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogContent({
  children,
  className,
}: AlertDialogContentProps) {
  // `aria-labelledby` is auto-wired by Radix from `<AlertDialogTitle>`
  // context — same caveat as `Dialog`: don't forward an
  // `aria-labelledby` prop, the spread would override the auto value.
  return (
    <RadixAlertDialog.Portal>
      <RadixAlertDialog.Overlay className="fixed inset-0 z-50 bg-accent/40" />
      <RadixAlertDialog.Content
        className={
          className ??
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg bg-bg-surface p-6 shadow-lg"
        }
      >
        {children}
      </RadixAlertDialog.Content>
    </RadixAlertDialog.Portal>
  );
}

// Re-exports — same react-refresh caveat as `Dialog.tsx`: the rule
// can't see through `const X = RadixAlertDialog.Y` to confirm these
// are forwardRef components. This file only exports components, so
// silence locally for each re-export line.

export const AlertDialogTitle = RadixAlertDialog.Title;

export const AlertDialogDescription = RadixAlertDialog.Description;

export const AlertDialogCancel = RadixAlertDialog.Cancel;

export const AlertDialogAction = RadixAlertDialog.Action;
