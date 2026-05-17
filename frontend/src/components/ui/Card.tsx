import { cn } from "@/lib/utils";
import { type HTMLAttributes } from "react";

export function Card({
  className,
  "data-testid": testId,
  ...props
}: HTMLAttributes<HTMLDivElement> & { "data-testid"?: string }) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-lg border border-border-1 bg-bg-surface shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 p-6", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    // eslint-disable-next-line jsx-a11y/heading-has-content -- content provided by caller via {...props}; this is a forwarding component
    <h3
      className={cn(
        "font-semibold leading-none tracking-tight text-ink-1",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
