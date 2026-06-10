/**
 * SourceToolSettings — Settings tab sub-component for the Source stage tool.
 *
 * Exports:
 *   SourceStepSettings — settings inheritance banner + settings rows
 *
 * Split from SourceTool.tsx (Fix 4: file too large).
 * No behavior change — only code organisation.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 * @see src/pages/pipeline/tools/SourceTool.tsx — main entry point
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { countDraftChanges } from "@/machines/tools/stageSettings";
import { SetRow } from "@/design/SetRow";
import { Toggle2 } from "@/design/Toggle2";
import { SettingSlider } from "@/design/SettingSlider";

/** Settings inheritance banner tones. */
const SETTINGS_BANNER_CONFIG = {
  default: {
    tone: "var(--exact)",
    label: "Using project default · Standard quality preset",
    sub: "Changes here can be saved back as the project default for Source.",
  },
  modified: {
    tone: "var(--fuzzy)",
    label: (n: number) =>
      `Modified · ${n} change${n === 1 ? "" : "s"} vs project default`,
    sub: "Save these as the project default, or revert to inherit.",
  },
  preset: {
    tone: "var(--ocr)",
    label: (id: string) => `Using preset · ${id}`,
    sub: "Loaded from a saved preset; not the project default.",
  },
} as const;

/** Source stage settings tab. */
export function SourceStepSettings({
  settingsState,
  draft,
  presetId,
  isSaving,
  onSaveAsDefault,
  onRevert,
  onResetToDefault,
}: {
  settingsState:
    | "default"
    | "modified"
    | "preset"
    | "saving"
    | "reverting"
    | "resetting";
  draft: Record<string, unknown> | null;
  presetId: string | null;
  /** True while a settings service call is in flight (saving/reverting/resetting). */
  isSaving?: boolean;
  onSaveAsDefault: () => void;
  onRevert: () => void;
  onResetToDefault: () => void;
}): ReactNode {
  const [thumbQuality, setThumbQuality] = useState<string>("Standard");
  const [workers, setWorkers] = useState(4);
  const [autoConfirm, setAutoConfirm] = useState(false);

  const nChanges = countDraftChanges(draft);

  // Normalise transient states for display
  const displayState: "default" | "modified" | "preset" =
    settingsState === "saving" || settingsState === "reverting"
      ? "modified"
      : settingsState === "resetting"
        ? "preset"
        : settingsState;

  let bannerLabel: string;
  let bannerSub: string;
  let bannerTone: string;

  if (displayState === "modified") {
    bannerLabel = SETTINGS_BANNER_CONFIG.modified.label(nChanges);
    bannerSub = SETTINGS_BANNER_CONFIG.modified.sub;
    bannerTone = SETTINGS_BANNER_CONFIG.modified.tone;
  } else if (displayState === "preset") {
    bannerLabel = SETTINGS_BANNER_CONFIG.preset.label(presetId ?? "unknown");
    bannerSub = SETTINGS_BANNER_CONFIG.preset.sub;
    bannerTone = SETTINGS_BANNER_CONFIG.preset.tone;
  } else {
    bannerLabel = SETTINGS_BANNER_CONFIG.default.label;
    bannerSub = SETTINGS_BANNER_CONFIG.default.sub;
    bannerTone = SETTINGS_BANNER_CONFIG.default.tone;
  }

  const busy =
    isSaving === true ||
    settingsState === "saving" ||
    settingsState === "reverting" ||
    settingsState === "resetting";

  return (
    <div
      style={{
        padding: "20px 28px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ink-1)",
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          Stage settings · Source
        </h2>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
          Thumbnail quality, worker concurrency, and auto-confirm behaviour for
          this stage.
        </div>
      </div>

      {/* Inheritance banner */}
      <div
        data-testid="settings-banner"
        data-settings-state={settingsState}
        style={{
          borderRadius: 8,
          border: `1px solid color-mix(in oklab, ${bannerTone} 40%, var(--border-1))`,
          background: `color-mix(in oklab, ${bannerTone} 7%, var(--bg-surface))`,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
          >
            {busy ? "Saving…" : bannerLabel}
          </div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}>
            {bannerSub}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {displayState === "modified" && (
            <>
              <button
                type="button"
                data-testid="settings-revert-btn"
                onClick={onRevert}
                disabled={busy}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                ↺ Revert
              </button>
              <button
                type="button"
                data-testid="settings-save-btn"
                onClick={onSaveAsDefault}
                disabled={busy}
                style={{
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 5,
                  background: "var(--accent)",
                  border: "none",
                  color: "var(--accent-ink)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {settingsState === "saving"
                  ? "Saving…"
                  : "✓ Save as project default"}
              </button>
            </>
          )}
          {displayState === "preset" && (
            <button
              type="button"
              data-testid="settings-reset-btn"
              onClick={onResetToDefault}
              disabled={busy}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 5,
                background: "transparent",
                border: "1px solid var(--border-2)",
                color: "var(--ink-2)",
                fontSize: 12,
                fontWeight: 500,
                cursor: busy ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {settingsState === "resetting"
                ? "Resetting…"
                : "↺ Reset to project default"}
            </button>
          )}
        </div>
      </div>

      {/* Settings rows */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* Thumbnail quality */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <SetRow
            label="Thumbnail quality"
            description="Higher quality → larger cache + slower generation"
            data-testid="setting-row-thumb-quality"
          >
            <div
              style={{
                display: "inline-flex",
                padding: 3,
                background: "var(--bg-raised)",
                border: "1px solid var(--border-1)",
                borderRadius: 7,
              }}
            >
              {["Fast", "Standard", "High"].map((v) => {
                const active = thumbQuality === v;
                return (
                  <button
                    key={v}
                    type="button"
                    data-testid={`thumb-quality-${v.toLowerCase()}`}
                    onClick={() => setThumbQuality(v)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 5,
                      border: 0,
                      background: active ? "var(--bg-surface)" : "transparent",
                      color: active ? "var(--ink-1)" : "var(--ink-3)",
                      fontSize: 12,
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </SetRow>
        </div>

        {/* Workers */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <SetRow
            label="Concurrent workers"
            description="How many thumbnails to generate at once"
            data-testid="setting-row-workers"
          >
            <div style={{ minWidth: 240 }}>
              <SettingSlider
                value={workers}
                onChange={setWorkers}
                min={1}
                max={8}
                step={1}
                data-testid="workers-slider"
              />
            </div>
          </SetRow>
        </div>

        {/* Regenerate */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <SetRow
            label="Re-generate thumbnails"
            description="Clears the cache and runs again at current quality"
            data-testid="setting-row-regenerate"
          >
            <button
              type="button"
              data-testid="regenerate-btn"
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 5,
                background: "transparent",
                border: "1px solid var(--border-2)",
                color: "var(--ink-2)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ↺ Re-generate all thumbnails
            </button>
          </SetRow>
        </div>

        {/* Auto-confirm */}
        <div style={{ padding: "14px 16px" }}>
          <SetRow
            label="Auto-confirm selection"
            description="Skip manual confirmation once selection is mostly done"
            data-testid="setting-row-auto-confirm"
          >
            <Toggle2
              checked={autoConfirm}
              onChange={setAutoConfirm}
              data-testid="auto-confirm-toggle"
            />
          </SetRow>
        </div>
      </div>
    </div>
  );
}
