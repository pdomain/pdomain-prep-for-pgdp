/**
 * Map a validation-stage report onto the build_package preflight gate.
 *
 * The build machine stays `unknown` until a real report arrives. A clean
 * report is `passed`. Any blocker, or `passed: false`, is `blocked`.
 */

import { api } from "@/api/client";
import type { PreflightStatus } from "@/machines/tools/buildPackageTool";

export interface ValidationPreflightReport {
  passed: boolean;
  blocker_count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read a validation artifact. A body that is not a report is null. */
export function parseValidationPreflightReport(
  value: unknown,
): ValidationPreflightReport | null {
  if (!isRecord(value)) return null;
  const passed = value["passed"];
  const blockerCount = value["blocker_count"];
  if (typeof passed !== "boolean") return null;
  if (typeof blockerCount !== "number") return null;
  return { passed, blocker_count: blockerCount };
}

/**
 * `passed` only when the report says so and lists no blockers.
 * Null means the report is missing or unreadable (`unknown`).
 */
export function preflightFromValidationReport(
  report: ValidationPreflightReport | null,
): PreflightStatus {
  if (report === null) return "unknown";
  if (report.passed && report.blocker_count === 0) return "passed";
  return "blocked";
}

/**
 * GET the validation artifact and map it. A missing artifact or a failed
 * read stays `unknown` so Build stays disabled.
 */
export async function loadValidationPreflight(
  projectId: string,
): Promise<PreflightStatus> {
  const url = `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/validation/artifact`;
  try {
    const body: unknown = await api.get<unknown>(url);
    return preflightFromValidationReport(parseValidationPreflightReport(body));
  } catch {
    return "unknown";
  }
}
