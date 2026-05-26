/**
 * Accordion — Radix-backed accordion primitive (§16 Radix wrappers).
 *
 * Thin wrapper around `@radix-ui/react-accordion`. Radix handles:
 *   - `role="button"` ARIA wiring on triggers.
 *   - `aria-expanded` state on open/closed items.
 *   - `data-state="open"|"closed"` on items, triggers, and content.
 *   - Single/multiple expansion modes.
 *
 * Future callers should import from this wrapper, not directly from
 * `@radix-ui/react-accordion`.
 */
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "@pdomain/pdomain-ui/icons";
import { cn } from "@/lib/utils";

export const Accordion = AccordionPrimitive.Root;
export const AccordionItem = AccordionPrimitive.Item;

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          "flex flex-1 items-center justify-between py-4 text-sm font-medium text-ink-1 transition-all hover:text-ink-2 [&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className="overflow-hidden text-sm data-[state=closed]:animate-none data-[state=open]:animate-none"
      {...props}
    >
      <div className={cn("pb-4 pt-0 text-ink-2", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
