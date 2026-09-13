/**
 * ToggleGroup — Radix-backed toggle group primitive (§16 Radix wrappers).
 *
 * Thin wrapper around `@radix-ui/react-toggle-group`. Radix handles:
 *   - `role="group"` ARIA wiring.
 *   - `data-state="on"|"off"` on each Item for CSS styling.
 *   - Single/multiple selection modes.
 *
 * Future callers should import from this wrapper, not directly from
 * `@radix-ui/react-toggle-group`.
 */
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export const ToggleGroup = ToggleGroupPrimitive.Root;

interface ToggleGroupItemProps extends React.ComponentPropsWithoutRef<
  typeof ToggleGroupPrimitive.Item
> {
  "data-testid"?: string;
}

export function ToggleGroupItem({
  className,
  "data-testid": testId,
  ...props
}: ToggleGroupItemProps) {
  return (
    <ToggleGroupPrimitive.Item
      data-testid={testId}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-bg-surface transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        "bg-bg-surface text-ink-3 hover:bg-bg-raised hover:text-ink-1",
        "data-[state=on]:bg-bg-raised data-[state=on]:text-ink-1 data-[state=on]:shadow-xs",
        className,
      )}
      {...props}
    />
  );
}
