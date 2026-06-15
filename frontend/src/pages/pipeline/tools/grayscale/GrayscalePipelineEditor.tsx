/**
 * GrayscalePipelineEditor — Task 4.2 pipeline config editor panel.
 *
 * Renders the composable pipeline stages (flatten / converter / CLAHE) with:
 *   - Real visible+wired controls (never display:none stubs)
 *   - Per-field resolved-source tier badges showing which settings tier
 *     (page | project | all | registry) supplied each value
 *   - data-testid on every control for Task 5 driver-contract compliance
 *
 * data-testid contract (Task 5.1):
 *   grayscale-flatten-toggle            — flatten enabled checkbox
 *   grayscale-converter-select          — converter <select>
 *   grayscale-clahe-toggle              — CLAHE enabled checkbox
 *   grayscale-channel-select            — channel <select> (only when converter=best_channel)
 *   grayscale-resolved-source-converter — "from: <tier>" badge for converter field
 *
 * Props:
 *   draft    — current GrayscaleDraftConfig (from machine context.draft)
 *   sources  — per-field source tier map from GET .../settings/resolved
 *   onSetConverter — dispatch SET_CONVERTER to the machine
 *   onSetFlatten   — dispatch SET_FLATTEN to the machine
 *   onSetClahe     — dispatch SET_CLAHE to the machine
 *   onSetChannel   — dispatch SET_CHANNEL to the machine
 *
 * @see Task 4.2 in docs/plans/2026-06-15-grayscale-pipeline.md
 * @see frontend/src/pages/pipeline/tools/grayscale/grayscaleConfig.ts
 * @see frontend/src/machines/tools/grayscaleTool.ts — SET_CONVERTER etc.
 */

import type { ReactNode } from "react";
import type {
  GrayscaleDraftConfig,
  GrayscaleConverter,
  GrayscaleChannel,
} from "./grayscaleConfig";
import { GRAYSCALE_CONFIG_DEFAULTS } from "./grayscaleConfig";

// ---------------------------------------------------------------------------
// Source-tier badge
// ---------------------------------------------------------------------------

/**
 * SourceTierBadge — small "from: <tier>" chip displayed next to each field.
 *
 * Tier color coding:
 *   page     — accent (user has a page-level override)
 *   project  — ocr amber (project-level default)
 *   all      — fuzzy amber (app-wide default)
 *   registry — neutral ink-4 (built-in registry default)
 */
function SourceTierBadge({
  tier,
  testId,
}: {
  tier: string | undefined;
  testId?: string;
}): ReactNode {
  const label = tier ?? "registry";
  const colorMap: Record<string, string> = {
    page: "var(--accent)",
    project: "var(--ocr)",
    all: "var(--fuzzy)",
    registry: "var(--ink-4)",
  };
  const color = colorMap[label] ?? "var(--ink-4)";

  return (
    <span
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        height: 16,
        borderRadius: 3,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 30%, var(--border-1))`,
        color,
        fontFamily: "var(--mono-font, monospace)",
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: ".03em",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      from: {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Toggle control (checkbox-styled)
// ---------------------------------------------------------------------------

function ToggleRow({
  label,
  checked,
  onChange,
  testId,
  sub,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
  sub?: string;
}): ReactNode {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          marginTop: 2,
          accentColor: "var(--accent)",
          cursor: "pointer",
        }}
      />
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}>
          {label}
        </div>
        {sub && (
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: "var(--ink-3)",
              lineHeight: 1.4,
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function EditorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      style={{
        borderRadius: 7,
        border: "1px solid var(--border-1)",
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-1)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--ink-4)",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "10px 12px" }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Converter section
// ---------------------------------------------------------------------------

const CONVERTER_OPTIONS: { value: GrayscaleConverter; label: string }[] = [
  { value: "luma", label: "Luma (0.299R + 0.587G + 0.114B)" },
  { value: "luma_bt709", label: "Luma BT.709 (linearised)" },
  { value: "lab_l", label: "CIE L* (perceptual lightness)" },
  { value: "color2gray", label: "color2gray (structure-preserving)" },
  { value: "best_channel", label: "Best channel (R/G/B)" },
];

const CHANNEL_OPTIONS: { value: GrayscaleChannel; label: string }[] = [
  { value: "auto", label: "Auto (sharpest)" },
  { value: "green", label: "Green" },
  { value: "red", label: "Red" },
  { value: "blue", label: "Blue" },
];

function ConverterSection({
  draft,
  sources,
  onSetConverter,
  onSetChannel,
}: {
  draft: GrayscaleDraftConfig;
  sources: Record<string, string>;
  onSetConverter: (c: GrayscaleConverter) => void;
  onSetChannel: (ch: GrayscaleChannel) => void;
}): ReactNode {
  const converterTier = sources["converter"] ?? sources["flatten.enabled"];
  const showChannel = draft.converter === "best_channel";

  return (
    <EditorSection title="Converter">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Converter select + source badge */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}
            >
              Algorithm
            </span>
            <SourceTierBadge
              tier={converterTier}
              testId="grayscale-resolved-source-converter"
            />
          </div>
          <select
            data-testid="grayscale-converter-select"
            value={draft.converter}
            onChange={(e) =>
              onSetConverter(e.target.value as GrayscaleConverter)
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
          <div
            style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.4 }}
          >
            {draft.converter === "luma" &&
              "ITU-R BT.601 luma formula. Fastest; works well for modern clean scans."}
            {draft.converter === "luma_bt709" &&
              "ITU-R BT.709 luma. Better for displays; linearises before weighting."}
            {draft.converter === "lab_l" &&
              "CIE L* from CIELAB. Perceptually uniform — ideal for faded or aged paper."}
            {draft.converter === "color2gray" &&
              "Structure-preserving algorithm. Preserves local contrast features."}
            {draft.converter === "best_channel" &&
              "Picks the single R/G/B channel with the highest sharpness/contrast."}
          </div>
        </div>

        {/* Channel select — only when converter=best_channel */}
        {showChannel && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span
              style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}
            >
              Channel
            </span>
            <select
              data-testid="grayscale-channel-select"
              value={draft.channel}
              onChange={(e) => onSetChannel(e.target.value as GrayscaleChannel)}
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
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </EditorSection>
  );
}

// ---------------------------------------------------------------------------
// Flatten section
// ---------------------------------------------------------------------------

function FlattenSection({
  draft,
  onSetFlatten,
}: {
  draft: GrayscaleDraftConfig;
  onSetFlatten: (enabled: boolean) => void;
}): ReactNode {
  const flatten = draft.flatten ?? GRAYSCALE_CONFIG_DEFAULTS.flatten;

  return (
    <EditorSection title="Flatten (background normalisation)">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ToggleRow
          label="Enable flatten"
          checked={flatten.enabled}
          onChange={onSetFlatten}
          testId="grayscale-flatten-toggle"
          sub="Estimates and subtracts the background illumination gradient. Improves
               contrast on yellowed or unevenly-lit pages."
        />
        {flatten.enabled && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              paddingTop: 4,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  marginBottom: 2,
                }}
              >
                Radius
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                }}
              >
                {flatten.radius}px
              </span>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  marginBottom: 2,
                }}
              >
                Strength
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                }}
              >
                {flatten.strength.toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>
    </EditorSection>
  );
}

// ---------------------------------------------------------------------------
// CLAHE section
// ---------------------------------------------------------------------------

function ClaheSection({
  draft,
  onSetClahe,
}: {
  draft: GrayscaleDraftConfig;
  onSetClahe: (enabled: boolean) => void;
}): ReactNode {
  const clahe = draft.clahe ?? GRAYSCALE_CONFIG_DEFAULTS.clahe;

  return (
    <EditorSection title="CLAHE (adaptive contrast)">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ToggleRow
          label="Enable CLAHE"
          checked={clahe.enabled}
          onChange={onSetClahe}
          testId="grayscale-clahe-toggle"
          sub="Contrast-Limited Adaptive Histogram Equalisation. Enhances local contrast
               without over-amplifying noise in flat regions."
        />
        {clahe.enabled && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              paddingTop: 4,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  marginBottom: 2,
                }}
              >
                Clip limit
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                }}
              >
                {clahe.clip_limit.toFixed(1)}
              </span>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  marginBottom: 2,
                }}
              >
                Tile grid
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                }}
              >
                {clahe.tile_grid}×{clahe.tile_grid}
              </span>
            </div>
          </div>
        )}
      </div>
    </EditorSection>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * GrayscalePipelineEditor — composable pipeline editor panel.
 *
 * Renders flatten / converter / CLAHE sections with source-tier badges.
 * All controls are visible, wired, and carry data-testid.
 *
 * Caller is responsible for:
 *   1. Holding draft state (from machine context.draft)
 *   2. Fetching resolved sources (from GET .../settings/resolved) and passing
 *      the `sources` map in as a prop
 *   3. Wiring the onSet* callbacks to machine send() calls
 */
export function GrayscalePipelineEditor({
  draft,
  sources,
  onSetConverter,
  onSetFlatten,
  onSetClahe,
  onSetChannel,
}: {
  draft: GrayscaleDraftConfig;
  sources: Record<string, string>;
  onSetConverter: (c: GrayscaleConverter) => void;
  onSetFlatten: (enabled: boolean) => void;
  onSetClahe: (enabled: boolean) => void;
  onSetChannel: (ch: string) => void;
}): ReactNode {
  return (
    <div
      data-testid="grayscale-pipeline-editor"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <FlattenSection draft={draft} onSetFlatten={onSetFlatten} />
      <ConverterSection
        draft={draft}
        sources={sources}
        onSetConverter={onSetConverter}
        onSetChannel={(ch) => onSetChannel(ch)}
      />
      <ClaheSection draft={draft} onSetClahe={onSetClahe} />
    </div>
  );
}
