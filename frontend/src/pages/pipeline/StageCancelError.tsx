import { useSelector } from "@xstate/react";
import type { StageRunnerRef } from "@/machines/pipelineShell";

export function StageCancelError({ runner }: { runner: StageRunnerRef }) {
  const message = useSelector(runner, (s) => s.context.cancelError);
  if (message === null) return null;

  return (
    <div
      role="alert"
      style={{
        padding: "10px 28px",
        fontSize: 13,
        color: "var(--ink-1)",
        background:
          "color-mix(in oklab, var(--mismatch, #ef4444) 8%, var(--bg-page))",
        borderBottom:
          "1px solid color-mix(in oklab, var(--mismatch, #ef4444) 30%, var(--border-1))",
      }}
    >
      {message}
    </div>
  );
}
