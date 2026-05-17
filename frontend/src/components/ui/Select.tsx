/**
 * Select — Radix-backed custom select primitive (§13a shadcn/ui adoption).
 *
 * Thin wrapper around `@radix-ui/react-select`. Radix handles:
 *   - `role="combobox"` + `aria-expanded` on the trigger.
 *   - `role="listbox"` + `role="option"` on the dropdown.
 *   - Arrow-key / Home / End navigation.
 *   - Type-ahead selection.
 *   - Click-outside + Escape to dismiss.
 *   - Portal so z-index stacking is always correct.
 *
 * For simple value-controlled selects where native `<select>` styling is
 * acceptable, a native element is fine. Use this wrapper when you need
 * cross-browser consistent custom styling or richer keyboard/ARIA semantics.
 *
 * Future callers should import from this wrapper, not directly from
 * `@radix-ui/react-select`.
 */
import * as RadixSelect from "@radix-ui/react-select";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  open,
  onOpenChange,
  disabled,
  children,
}: SelectProps) {
  return (
    <RadixSelect.Root
      {...(value !== undefined && { value })}
      {...(defaultValue !== undefined && { defaultValue })}
      {...(onValueChange !== undefined && { onValueChange })}
      {...(open !== undefined && { open })}
      {...(onOpenChange !== undefined && { onOpenChange })}
      {...(disabled !== undefined && { disabled })}
    >
      {children}
    </RadixSelect.Root>
  );
}

export type SelectTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof RadixSelect.Trigger>,
  "children"
> & {
  children: ReactNode;
  className?: string;
};

export function SelectTrigger({
  children,
  className,
  ...rest
}: SelectTriggerProps) {
  return (
    <RadixSelect.Trigger className={className} {...rest}>
      {children}
    </RadixSelect.Trigger>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const SelectValue = RadixSelect.Value;

export type SelectContentProps = Omit<
  ComponentPropsWithoutRef<typeof RadixSelect.Content>,
  "children"
> & {
  children: ReactNode;
  className?: string;
};

export function SelectContent({
  children,
  className,
  position = "popper",
  ...rest
}: SelectContentProps) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content position={position} className={className} {...rest}>
        <RadixSelect.Viewport>{children}</RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export interface SelectItemProps {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function SelectItem({
  value,
  children,
  className,
  disabled,
}: SelectItemProps) {
  return (
    <RadixSelect.Item
      value={value}
      className={className}
      {...(disabled !== undefined && { disabled })}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

export interface SelectGroupProps {
  children: ReactNode;
}

export function SelectGroup({ children }: SelectGroupProps) {
  return <RadixSelect.Group>{children}</RadixSelect.Group>;
}

export interface SelectLabelProps {
  children: ReactNode;
  className?: string;
}

export function SelectLabel({ children, className }: SelectLabelProps) {
  return (
    <RadixSelect.Label className={className}>{children}</RadixSelect.Label>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const SelectSeparator = RadixSelect.Separator;
