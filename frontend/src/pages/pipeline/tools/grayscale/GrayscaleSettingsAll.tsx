/**
 * GrayscaleSettingsAll — App-wide (all-tier) grayscale settings control.
 *
 * Task 4.3: Renders on the app Settings page to let users set the app-wide
 * grayscale converter default (the "all" tier in the 3-tier resolution:
 * page > project > all > registry).
 *
 * PUT /api/data/settings/stages/grayscale
 *
 * data-testid contract:
 *   settings-all-grayscale-converter — converter <select>
 *   settings-all-grayscale-save      — Save app default button
 *
 * @see src/pages/SettingsPage.tsx — host page
 * @see src/pdomain_prep_for_pgdp/api/data/stage_settings_all.py — PUT route
 */

import { useState } from "react";
import type { ReactNode } from "react";
import type {
  GrayscaleDraftConfig,
  GrayscaleConverter,
} from "./grayscaleConfig";

const CONVERTER_OPTIONS: { value: GrayscaleConverter; label: string }[] = [
  { value: "luma", label: "Luma (0.299R + 0.587G + 0.114B)" },
  { value: "luma_bt709", label: "Luma BT.709 (linearised)" },
  { value: "lab_l", label: "CIE L* (perceptual lightness)" },
  { value: "color2gray", label: "color2gray (structure-preserving)" },
  { value: "best_channel", label: "Best channel (R/G/B)" },
];

export interface GrayscaleSettingsAllProps {
  /** Current app-wide config (from GET /settings/stages/grayscale). */
  config: GrayscaleDraftConfig;
  /** Called when user clicks Save — receives the updated config to PUT. */
  onSave: (config: GrayscaleDraftConfig) => void;
}

/**
 * GrayscaleSettingsAllSection — Grayscale converter section for the app Settings page.
 *
 * Renders a converter <select> (and eventually other fields) with a Save button
 * that calls onSave with the updated local draft, which the parent then PUTs
 * to /api/data/settings/stages/grayscale.
 *
 * The parent (SettingsPage) owns the mutation (useMutation). This component
 * is a pure controlled form — no direct API calls.
 */
export function GrayscaleSettingsAllSection({
  config,
  onSave,
}: GrayscaleSettingsAllProps): ReactNode {
  const [draft, setDraft] = useState<GrayscaleDraftConfig>({ ...config });

  return (
    <div
      data-testid="settings-all-grayscale"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      {/* Converter select */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <label
          htmlFor="settings-all-grayscale-converter-input"
          style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500 }}
        >
          Default converter
        </label>
        <select
          id="settings-all-grayscale-converter-input"
          data-testid="settings-all-grayscale-converter"
          value={draft.converter}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              converter: e.target.value as GrayscaleConverter,
            }))
          }
          style={{
            width: "100%",
            padding: "5px 8px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-page)",
            color: "var(--ink-1)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {CONVERTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
          App-wide default converter. Applied to all projects that have no
          project-level or page-level grayscale override.
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          data-testid="settings-all-grayscale-save"
          onClick={() => onSave(draft)}
          style={{
            padding: "5px 14px",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Save app default
        </button>
      </div>
    </div>
  );
}
