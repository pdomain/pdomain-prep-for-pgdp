import { api } from "@/api/client";

export type StageValues = Record<string, unknown>;

export interface ResolvedTiers {
  effective: StageValues;
  sources: Record<string, string>;
}

function pageSettingsUrl(
  projectId: string,
  stageId: string,
  idx0: number,
): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/${encodeURIComponent(stageId)}/settings`;
}

function allTierUrl(stageId: string): string {
  return `/api/data/settings/stages/${encodeURIComponent(stageId)}`;
}

export function fetchResolved(
  projectId: string,
  stageId: string,
  idx0: number,
): Promise<ResolvedTiers> {
  return api.get<ResolvedTiers>(
    `${pageSettingsUrl(projectId, stageId, idx0)}/resolved`,
  );
}

export function savePageTier(
  projectId: string,
  stageId: string,
  idx0: number,
  values: StageValues,
): Promise<StageValues> {
  return api.put<StageValues>(
    `${pageSettingsUrl(projectId, stageId, idx0)}/page`,
    values,
  );
}

export function clearPageTier(
  projectId: string,
  stageId: string,
  idx0: number,
): Promise<StageValues> {
  return api.delete<StageValues>(
    `${pageSettingsUrl(projectId, stageId, idx0)}/page`,
  );
}

export function saveProjectTier(
  projectId: string,
  stageId: string,
  values: StageValues,
): Promise<StageValues> {
  return api.put<StageValues>(
    `/api/data/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/settings`,
    values,
  );
}

export function fetchAllTier(stageId: string): Promise<StageValues> {
  return api.get<StageValues>(allTierUrl(stageId));
}

export function saveAllTier(
  stageId: string,
  values: StageValues,
): Promise<StageValues> {
  return api.put<StageValues>(allTierUrl(stageId), values);
}

/** The fields a tier currently supplies, so a whole-tier save keeps them. */
export function overridesAt(
  resolved: ResolvedTiers,
  tier: string,
): StageValues {
  return Object.fromEntries(
    Object.entries(resolved.effective).filter(
      ([key]) => resolved.sources[key] === tier,
    ),
  );
}
