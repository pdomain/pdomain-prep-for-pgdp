/**
 * Stat — summary statistic display (count, label, tone).
 *
 * RECONCILIATION: Evaluated against pdomain-ui `StatTile`. The pdomain-ui
 * StatTile API (label, value, sub?, tone?: 'clean'|'dirty'|'neutral') covers
 * the design's Stat shape. This module re-exports `StatTile` from
 * `@pdomain/pdomain-ui/primitives` under the `Stat` name for PGDP stage-tool
 * use without duplicating the implementation.
 *
 * Disposition: stays app-local but defers to pdomain-ui StatTile
 * (see docs/specs/library-placement.md §1.3 — "Evaluate against StatTile;
 * if StatTile covers the shape, prefer it").
 *
 * Callers should import `Stat` from this module; the implementation lives
 * in pdomain-ui.
 */
export {
  StatTile as Stat,
  type StatTileTone as StatTone,
} from "@pdomain/pdomain-ui/primitives";
