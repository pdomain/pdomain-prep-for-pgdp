import type { ReactNode } from "react";
import type { ControlDef } from "./stageSchemas";

const INSET_EDGES = ["Top", "Bottom", "Left", "Right"] as const;

function sliderReadout(ctrl: ControlDef, value: unknown): string {
  if (typeof value === "number") return String(value);
  return ctrl.autoLabel ?? "";
}

function InsetSliders({
  ctrl,
  value,
  onPatch,
}: {
  ctrl: ControlDef;
  value: unknown;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const [min, max, step] = ctrl.range ?? [0, 200, 1];
  const insets = Array.isArray(value) ? (value as number[]) : [0, 0, 0, 0];
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {INSET_EDGES.map((edge, edgeIndex) => (
        <label
          key={edge}
          style={{
            display: "grid",
            gridTemplateColumns: "48px 1fr 32px",
            gap: 6,
            alignItems: "center",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          {edge}
          <input
            type="range"
            aria-label={`${ctrl.label} ${edge}`}
            data-testid={`slider-${ctrl.key}-${edgeIndex}`}
            min={min}
            max={max}
            step={step}
            value={insets[edgeIndex] ?? 0}
            onChange={(e) =>
              onPatch({
                [ctrl.key]: insets.map((inset, i) =>
                  i === edgeIndex ? parseFloat(e.target.value) : inset,
                ),
              })
            }
          />
          <span style={{ fontFamily: "monospace" }}>
            {insets[edgeIndex] ?? 0}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Editor for a stage's backend settings; `values` holds each field's current value. */
export function ControlEditor({
  controls,
  values,
  onPatch,
  badgeFor,
}: {
  controls: ControlDef[];
  values: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
  badgeFor?: (key: string) => ReactNode;
}) {
  if (controls.length === 0) {
    return (
      <div
        data-testid="control-editor-empty"
        style={{ fontSize: 11.5, color: "var(--ink-3)" }}
      >
        This stage has no adjustable settings. Re-run repeats it with the
        current pipeline.
      </div>
    );
  }
  return (
    <div
      data-testid="control-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "10px 12px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 7,
      }}
    >
      {controls.map((ctrl) => {
        const currentVal =
          values[ctrl.key] !== undefined ? values[ctrl.key] : ctrl.defaultValue;
        return (
          <div
            key={ctrl.key}
            data-testid={`control-${ctrl.key}`}
            style={{ display: "flex", flexDirection: "column", gap: 5 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {ctrl.label}
                {badgeFor?.(ctrl.key)}
              </span>
              {ctrl.kind === "slider" && (
                <span
                  data-testid={`readout-${ctrl.key}`}
                  style={{
                    fontFamily: "monospace",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--ink-1)",
                  }}
                >
                  {sliderReadout(ctrl, currentVal)}
                </span>
              )}
            </div>
            {ctrl.description && (
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                  lineHeight: 1.4,
                }}
              >
                {ctrl.description}
              </div>
            )}
            {ctrl.kind === "slider" && ctrl.range && (
              <input
                type="range"
                aria-label={ctrl.label}
                data-testid={`slider-${ctrl.key}`}
                min={ctrl.range[0]}
                max={ctrl.range[1]}
                step={ctrl.range[2]}
                value={
                  typeof currentVal === "number" ? currentVal : ctrl.range[0]
                }
                onChange={(e) =>
                  onPatch({ [ctrl.key]: parseFloat(e.target.value) })
                }
                style={{ width: "100%" }}
              />
            )}
            {ctrl.kind === "slider" && ctrl.autoLabel && (
              <button
                type="button"
                data-testid={`auto-${ctrl.key}`}
                aria-pressed={currentVal === null}
                onClick={() => onPatch({ [ctrl.key]: null })}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  background:
                    currentVal === null ? "var(--accent)" : "var(--bg-raised)",
                  color: currentVal === null ? "#fff" : "var(--ink-2)",
                  fontSize: 11.5,
                  cursor: "pointer",
                  alignSelf: "flex-start",
                }}
              >
                {ctrl.autoLabel}
              </button>
            )}
            {ctrl.kind === "insets" && (
              <InsetSliders ctrl={ctrl} value={currentVal} onPatch={onPatch} />
            )}
            {ctrl.kind === "toggle" && (
              <button
                type="button"
                data-testid={`toggle-${ctrl.key}`}
                aria-pressed={Boolean(currentVal)}
                onClick={() => onPatch({ [ctrl.key]: !currentVal })}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  background: currentVal ? "var(--accent)" : "var(--bg-raised)",
                  color: currentVal ? "#fff" : "var(--ink-2)",
                  fontSize: 11.5,
                  cursor: "pointer",
                  alignSelf: "flex-start",
                }}
              >
                {currentVal ? "On" : "Off"}
              </button>
            )}
            {ctrl.kind === "select" && ctrl.options && (
              <select
                aria-label={ctrl.label}
                data-testid={`select-${ctrl.key}`}
                value={String(currentVal)}
                onChange={(e) =>
                  onPatch({
                    [ctrl.key]: ctrl.options?.find(
                      (option) => String(option) === e.target.value,
                    ),
                  })
                }
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  background: "var(--bg-raised)",
                  color: "var(--ink-1)",
                  fontSize: 11.5,
                }}
              >
                {ctrl.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
