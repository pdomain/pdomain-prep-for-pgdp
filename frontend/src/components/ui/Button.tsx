// TODO(s0-b): replace with pdomain-ui Button when pdomain-ui exports matching variants.
// pdomain-ui Button supports variant: "primary"|"ghost"|"danger" and size: "sm"|"md"|"lg".
// This app also uses "outline-solid", "secondary", "link", "amber" variants and "xs", "icon",
// "default" sizes, plus the buttonVariants() helper — none of which pdomain-ui ships yet.
// Blocked on pdomain-ui extending its variant/size set or the app migrating to pdomain-ui variants.
import { forwardRef, type ButtonHTMLAttributes } from "react";

import {
  buttonVariants,
  type ButtonVariant,
  type ButtonSize,
} from "./buttonVariants";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  "data-testid"?: string;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => {
    return (
      <button
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
