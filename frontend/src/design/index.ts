/**
 * App-local design system — atoms that stay in pdomain-prep-for-pgdp.
 *
 * Disposition table: docs/specs/library-placement.md §1
 *
 * Components marked "reuse pdomain-ui" are NOT exported here; import them
 * directly from @pdomain/pdomain-ui/primitives, @pdomain/pdomain-ui/shell, etc.
 *
 * Design-canvas scaffolding (DC*, DesignCanvas, App, DCArtboard*, …) is
 * never ported — those identifiers do not appear here.
 */

// ServerFooter — PGDP-specific server-address footer
export { ServerFooter, type ServerFooterProps } from "./ServerFooter";

// Body — page-level content wrapper for pack-group stage tools
export { Body, type BodyProps } from "./Body";

// StageCard — per-stage card (named to avoid shadowing pdomain-ui Card)
export { StageCard, type StageCardProps } from "./StageCard";

// Gate — confirmation gate banner for the pipeline gate chain
export { Gate, type GateProps, type GateTone } from "./Gate";

// Seg — abbreviated segment/tab row for pack-group stage tools
export { Seg, type SegProps } from "./Seg";

// SetRow — settings row layout (label + control)
// Use SetRow; the SettingRow alias is not exported (avoids duplicate-export warnings).
export { SetRow, type SetRowProps } from "./SetRow";

// Stat — re-exports pdomain-ui StatTile under the Stat name
export { Stat, type StatTone } from "./Stat";

// Toggle2 — binary on/off toggle for stage settings panels
export { Toggle2, type Toggle2Props } from "./Toggle2";

// Tree — artefact tree display for pack-group stage tools
export { Tree, type TreeProps, type TreeItem, type TreeItemTone } from "./Tree";

// SettingSlider — numeric slider for stage step-settings panels
export { SettingSlider, type SettingSliderProps } from "./SettingSlider";

// Check — checkbox with PGDP tone/label pairing
export { Check, type CheckProps, type CheckTone } from "./Check";

// ControlsPlaceholder — dev-only striped placeholder for controls slot
export {
  ControlsPlaceholder,
  type ControlsPlaceholderProps,
} from "./ControlsPlaceholder";
