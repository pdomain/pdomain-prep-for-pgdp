import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearPageTier,
  fetchResolved,
  overridesAt,
  savePageTier,
  saveProjectTier,
  type ResolvedTiers,
  type StageValues,
} from "@/services/stageTiers";

const EMPTY: ResolvedTiers = { effective: {}, sources: {} };

/** Resolved settings for one page and the actions that save them to a tier. */
export function useStageTiers(
  projectId: string,
  stageId: string,
  idx0: number | undefined,
) {
  const queryClient = useQueryClient();
  const stageKey = ["stage-tiers", projectId, stageId] as const;

  const resolved = useQuery({
    queryKey: [...stageKey, idx0],
    queryFn: () => fetchResolved(projectId, stageId, idx0 ?? 0),
    enabled: idx0 !== undefined,
    // A re-run writes page overrides, and a save built on old values would undo them.
    refetchOnMount: "always",
  });
  const current = resolved.data ?? EMPTY;

  const refresh = () => queryClient.invalidateQueries({ queryKey: stageKey });

  const savePage = useMutation({
    mutationFn: (draft: StageValues) =>
      savePageTier(projectId, stageId, idx0 ?? 0, {
        ...overridesAt(current, "page"),
        ...draft,
      }),
    onSuccess: refresh,
  });

  const saveProject = useMutation({
    mutationFn: (draft: StageValues) =>
      saveProjectTier(projectId, stageId, {
        ...overridesAt(current, "project"),
        ...draft,
      }),
    onSuccess: refresh,
  });

  const clearPage = useMutation({
    mutationFn: () => clearPageTier(projectId, stageId, idx0 ?? 0),
    onSuccess: refresh,
  });

  return { resolved, current, savePage, saveProject, clearPage };
}
