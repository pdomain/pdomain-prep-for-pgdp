/**
 * SearchModal — global search dialog (hifi P1-2).
 *
 * Wraps the existing SearchPanel in a Radix Dialog that:
 *   - Opens via the mod+k global hotkey.
 *   - Accepts explicit open/onOpenChange props — open state is owned by
 *     App.tsx (local React state) rather than the uiPrefs store.
 *   - Extracts the current projectId from the URL (same technique as
 *     OpenTasksBell). When no project route is active, shows a helpful
 *     "navigate to a project to search" message instead.
 *
 * Phase 2.7c (#330): searchOpen removed from uiPrefs store; the dialog
 * open state is passed as props from App.tsx.
 *
 * SearchPanel is never modified here; only wrapped.
 */
import { useHotkeys } from "react-hotkeys-hook";
import { useMatch } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@concavetrillion/pd-ui/icons";
import { SearchPanel } from "@/components/SearchPanel";

interface SearchModalProps {
  /** Whether the dialog is open. Controlled by the parent (App.tsx). */
  open: boolean;
  /** Called when the dialog requests an open-state change (e.g. close via X or Escape). */
  onOpenChange: (open: boolean) => void;
  "data-testid"?: string;
}

export function SearchModal({
  open,
  onOpenChange,
  "data-testid": testId,
}: SearchModalProps) {
  useHotkeys(
    "mod+k",
    (e) => {
      e.preventDefault();
      onOpenChange(true);
    },
    { enableOnFormTags: false },
  );

  // Extract projectId from URL (works on any /projects/:projectId/* route).
  const match = useMatch("/projects/:projectId/*");
  const projectId = match?.params?.projectId ?? null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid={testId ?? "search-modal"}
          className="fixed left-[50%] top-[20%] z-50 w-full max-w-lg translate-x-[-50%] rounded-xl border border-border-1 bg-bg-surface p-0 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2"
        >
          <DialogPrimitive.Title className="sr-only">
            Search
          </DialogPrimitive.Title>
          <div className="flex items-start border-b border-border-1 px-4 py-3">
            <div className="flex-1">
              {projectId ? (
                <SearchPanel projectId={projectId} />
              ) : (
                <p className="py-2 text-sm text-ink-3">
                  Navigate to a project to search its pages.
                </p>
              )}
            </div>
            <DialogPrimitive.Close className="ml-2 mt-1 rounded-sm opacity-70 ring-offset-bg-surface transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2">
              <X className="h-4 w-4 text-ink-3" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
