/**
 * Dialog — Radix-backed modal primitive (§13a shadcn/ui adoption, step 1).
 *
 * Thin wrapper around `@radix-ui/react-dialog` that hands callers a small,
 * shadcn-style API (`<Dialog open onOpenChange>` + `<DialogContent>` with a
 * title) while the underlying primitive does all the a11y heavy lifting:
 *
 *   - `role="dialog"` + `aria-modal="true"` set automatically
 *   - Escape closes (no manual keydown wiring)
 *   - Focus trap + initial focus on the first focusable child
 *   - Body scroll-lock while open (Radix sets `overflow: hidden` on <body>)
 *   - Click-outside on the overlay closes
 *
 * The previous hand-rolled modal in `ProjectListPage` reproduced these by
 * hand; the test contract from commit `cba526e` (role=dialog,
 * aria-modal=true, body overflow=hidden, Escape-to-close, initial focus
 * on first input) all passes through Radix unchanged. Future modals
 * (delete-project confirm, etc.) should compose this primitive instead of
 * recreating the focus-trap + scroll-lock manually.
 *
 * `<DialogTitle>` is a separate export because Radix requires a
 * `Dialog.Title` inside every `Dialog.Content` for screen-reader
 * announcement; if a caller wants the title visually hidden they can wrap
 * it in `<VisuallyHidden>` (we don't pull that primitive in yet — first
 * caller has a visible heading).
 */
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export interface DialogContentProps {
  children: ReactNode;
  /**
   * Class names applied to the content panel. Callers control width / padding
   * / spacing here so the primitive stays layout-agnostic.
   */
  className?: string;
}

export function DialogContent({ children, className }: DialogContentProps) {
  // Note: `aria-labelledby` is wired automatically by Radix when a
  // `<DialogTitle>` is rendered inside this Content (it sets it from
  // an internal context). We deliberately do NOT forward an
  // `aria-labelledby` prop from the wrapper API — Radix's spread
  // `...contentProps` would override the auto-wired value with
  // `undefined` if the caller didn't pass one, breaking accessible-name
  // lookup.
  //
  // `aria-describedby={undefined}` is the documented opt-out for callers
  // that don't render a `<DialogDescription>`. Radix would otherwise
  // emit a dev-mode warning every render. Future callers that want a
  // description should add a `<DialogDescription>` child and Radix will
  // wire it through the same context — the wrapper doesn't need to
  // change.
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-accent/40" />
      <RadixDialog.Content
        aria-describedby={undefined}
        className={
          className ??
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg bg-bg-surface p-6 shadow-lg"
        }
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

// `DialogTitle` is `RadixDialog.Title` (a forwardRef component) re-exported
// under the wrapper namespace. The react-refresh rule can't see through
// the re-assignment to confirm it's a component, so silence it locally —
// this file only exports components.

export const DialogTitle = RadixDialog.Title;
