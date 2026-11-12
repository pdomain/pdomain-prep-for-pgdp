import { api } from "@/api/client";

export interface AspectPoint {
  pageId: string;
  idx0: number;
  prefix: string;
  width: number;
  height: number;
  ratio: number;
  body: boolean;
}

export interface AspectPoints {
  points: AspectPoint[];
  bodyRatio: number | null;
  canvasRatio: number;
}

function projectUrl(projectId: string): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}`;
}

export function fetchAspectPoints(projectId: string): Promise<AspectPoints> {
  return api.get<AspectPoints>(
    `${projectUrl(projectId)}/project-stages/canvas_map/aspect-points`,
  );
}

/** Saves the project's canvas ratio; the route replaces the whole project tier. */
export async function saveCanvasRatio(
  projectId: string,
  ratio: number,
): Promise<void> {
  const url = `${projectUrl(projectId)}/stages/canvas_map/settings`;
  const current = await api.get<Record<string, unknown>>(url);
  await api.put(url, { ...current, page_h_w_ratio: Number(ratio.toFixed(3)) });
}
