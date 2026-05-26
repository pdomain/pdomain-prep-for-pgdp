// TODO(s0-b): replace with pd-ui Button when pd-ui exports matching variants.
// pd-ui Button supports variant: "primary"|"ghost"|"danger" and size: "sm"|"md"|"lg".
// This app also uses "outline", "secondary", "link", "amber" variants and "xs", "icon",
// "default" sizes, plus the buttonVariants() helper — none of which pd-ui ships yet.
// Blocked on pd-ui extending its variant/size set or the app migrating to pd-ui variants.
import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

// Base classes applied to every button regardless of variant/size.
const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

// Variant → CSS classes.
const VARIANT_CLASSES: Record<string, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent/90",
  secondary: "bg-bg-raised text-ink-1 hover:bg-bg-sunk border border-border-2",
  outline:
    "border border-border-2 bg-transparent text-ink-1 hover:bg-bg-raised",
  ghost: "text-ink-1 hover:bg-bg-raised",
  link: "text-ink-1 underline-offset-4 hover:underline",
  amber: "bg-brand text-brand-ink hover:bg-brand/90",
  danger: "bg-status-error text-accent-ink hover:bg-status-error/90",
};

// Size → CSS classes.
const SIZE_CLASSES: Record<string, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 rounded-md px-3",
  xs: "h-7 rounded-md px-2 text-xs",
  icon: "h-9 w-9",
};

type ButtonVariant = keyof typeof VARIANT_CLASSES;
type ButtonSize = keyof typeof SIZE_CLASSES;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  "data-testid"?: string;
}

/** Returns the resolved class string for a given variant + size (for use in non-button elements like Link). */
export function buttonVariants({
  variant = "primary",
  size = "default",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(BASE, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className);
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          BASE,
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
