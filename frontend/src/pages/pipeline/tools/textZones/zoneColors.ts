/** zoneColors.ts — the zone-type palette shared by the canvas and zone list. */

import type { ZoneType } from "@/machines/tools/textZonesTool";

/** Fixed colours per zone type; Konva cannot read CSS variables. */
export const ZONE_TYPE_COLORS: Record<ZoneType, string> = {
  body: "#2f6fd6",
  heading: "#8a3fd1",
  header: "#6b7280",
  footer: "#6b7280",
  caption: "#c27c0e",
  footnote: "#0f8a6a",
  illustration: "#d1453b",
  table: "#b4527a",
  marginalia: "#4d7c0f",
};
