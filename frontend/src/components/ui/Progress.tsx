import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

interface ProgressProps {
  value?: number;
  className?: string;
  "data-testid"?: string;
}

export function Progress({
  value = 0,
  className,
  "data-testid": testId,
}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-testid={testId}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-bg-sunk",
        className,
      )}
      value={value}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-accent transition-all"
        style={{ transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
