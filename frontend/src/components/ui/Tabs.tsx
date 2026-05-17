/**
 * Tabs — Radix-backed tab panel primitive (§13a shadcn/ui adoption).
 *
 * Thin wrapper around `@radix-ui/react-tabs`. Radix handles:
 *   - `role="tablist"` / `role="tab"` / `role="tabpanel"` ARIA wiring.
 *   - Arrow-key navigation across tabs.
 *   - `aria-selected` on the active tab.
 *   - `aria-controls` / `aria-labelledby` pairing between tab and panel.
 *   - `data-state="active"|"inactive"` on both Tab and TabsContent for CSS.
 *
 * Future callers should import from this wrapper, not directly from
 * `@radix-ui/react-tabs`.
 */
import * as RadixTabs from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  return (
    <RadixTabs.Root
      {...(value !== undefined && { value })}
      {...(defaultValue !== undefined && { defaultValue })}
      {...(onValueChange !== undefined && { onValueChange })}
      className={className}
    >
      {children}
    </RadixTabs.Root>
  );
}

export type TabsListProps = Omit<
  ComponentPropsWithoutRef<typeof RadixTabs.List>,
  "children"
> & {
  children: ReactNode;
  className?: string;
};

export function TabsList({ children, className, ...rest }: TabsListProps) {
  return (
    <RadixTabs.List className={className} {...rest}>
      {children}
    </RadixTabs.List>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger({
  value,
  children,
  className,
  disabled,
}: TabsTriggerProps) {
  return (
    <RadixTabs.Trigger value={value} className={className} disabled={disabled}>
      {children}
    </RadixTabs.Trigger>
  );
}

export interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  return (
    <RadixTabs.Content value={value} className={className}>
      {children}
    </RadixTabs.Content>
  );
}
