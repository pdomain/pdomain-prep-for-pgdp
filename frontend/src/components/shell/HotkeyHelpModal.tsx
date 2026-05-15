/**
 * HotkeyHelpModal — global keyboard shortcut reference (hifi P4-3).
 *
 * Opened by pressing `?` anywhere in the app. Reads from `hotkeyMap.ts`
 * (the canonical registry) so this modal always stays in sync with actual
 * registered shortcuts without manual duplication.
 *
 * Sections are rendered in SECTION_ORDER order; sections with no entries
 * are skipped automatically (e.g. "View" before any View shortcuts are added).
 */
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { KeyCap } from "../ui/KeyCap";
import { Separator } from "../ui/Separator";
import { HOTKEY_MAP } from "../../lib/hotkeyMap";

const SECTION_ORDER = ["Navigation", "Editing", "View"] as const;

interface HotkeyHelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HotkeyHelpModal({ open, onClose }: HotkeyHelpModalProps) {
  const bySection = SECTION_ORDER.map((section) => ({
    section,
    entries: HOTKEY_MAP.filter((e) => e.section === section),
  })).filter((g) => g.entries.length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <div className="space-y-4">
          {bySection.map(({ section, entries }) => (
            <div key={section}>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-2">
                {section}
              </p>
              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <div
                    key={entry.keys.join("+")}
                    className="flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-1">
                      {entry.keys.map((k) => (
                        <KeyCap key={k}>{k}</KeyCap>
                      ))}
                    </div>
                    <span className="text-sm text-ink-2">
                      {entry.description}
                    </span>
                  </div>
                ))}
              </div>
              <Separator className="mt-3" />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
