/**
 * textReviewTool.ts — Real TextReviewToolServices backed by the v2 API.
 *
 * W4 Group 1: confirmStage wired.
 * W4 Group 3: approveLowRisk wired to real route.
 *
 * Backend routes used:
 *   POST /api/data/projects/{id}/project-stages/text_review/approve-low-risk
 *   POST /api/data/projects/{id}/project-stages/text_review/confirm
 *
 * At I1: approve-low-risk returns empty approvedIds (no real risk model yet).
 *
 * @see frontend/src/machines/tools/textReviewTool.ts — TextReviewToolServices
 */

import { api } from "@/api/client";
import type {
  QueueItem,
  ReviewTotals,
  TextReviewToolServices,
  Thread,
} from "@/machines/tools/textReviewTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Approve all low-risk items.
 *
 * W4 Group 3: POST /api/data/projects/{id}/project-stages/text_review/approve-low-risk
 * At I1: returns empty approvedIds (no real risk model yet — I2 TODO).
 */
async function approveLowRisk(
  projectId: string,
): Promise<{ approvedIds: string[] }> {
  try {
    const result = await api.post<{ approved_ids: string[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/text_review/approve-low-risk`,
      {},
    );
    return { approvedIds: result.approved_ids ?? [] };
  } catch {
    return { approvedIds: [] };
  }
}

/**
 * Confirm the text review stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/text_review/confirm
 * W4 Group 1 — wired real route.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/text_review/confirm`,
      {},
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real TextReviewToolServices for injection into the machine. */
export function buildRealTextReviewToolServices(): TextReviewToolServices {
  return { ...buildRealStageSettingsServices(), approveLowRisk, confirmStage };
}

// ---------------------------------------------------------------------------
// Mount hydrate — review queue from wordcheck flags, or an honest empty queue
// ---------------------------------------------------------------------------

export const EMPTY_REVIEW_TOTALS: ReviewTotals = {
  total: 0,
  queue: 0,
  pending: 0,
  discuss: 0,
  approved: 0,
  clean: 0,
  comments: 0,
};

export interface TextReviewQueueSnapshot {
  queue: QueueItem[];
  threads: Thread[];
  totals: ReviewTotals;
}

interface ListedPage {
  idx0: number;
  prefix: string;
}

interface ParsedFlag {
  wordId: string;
  wordText: string;
}

function isLiveProjectId(projectId: string): boolean {
  return projectId.length > 0 && projectId !== "demo";
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pageIdForIdx(idx0: number): string {
  return String(idx0).padStart(4, "0");
}

function emptyQueue(): TextReviewQueueSnapshot {
  return { queue: [], threads: [], totals: EMPTY_REVIEW_TOTALS };
}

async function readJson(
  path: string,
  signal: AbortSignal,
  query?: Record<string, string | number | boolean | null>,
): Promise<unknown> {
  try {
    if (query === undefined) {
      return await api.get<unknown>(path, { signal });
    }
    return await api.get<unknown>(path, { signal, query });
  } catch (err: unknown) {
    if (isAbortError(err)) throw err;
    return null;
  }
}

function readListedPages(value: unknown): ListedPage[] {
  if (!Array.isArray(value)) return [];
  const pages: ListedPage[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const idx0 = item["idx0"];
    if (typeof idx0 !== "number" || !Number.isInteger(idx0) || idx0 < 0) {
      continue;
    }
    const prefixRaw = item["prefix"];
    const prefix =
      typeof prefixRaw === "string" && prefixRaw.length > 0
        ? prefixRaw
        : pageIdForIdx(idx0);
    pages.push({ idx0, prefix });
  }
  return pages;
}

async function listProjectPages(
  projectId: string,
  signal: AbortSignal,
): Promise<ListedPage[]> {
  const pages: ListedPage[] = [];
  let cursor: string | null = null;
  for (let hop = 0; hop < 20; hop += 1) {
    const query = cursor === null ? { limit: 500 } : { limit: 500, cursor };
    const body = await readJson(
      `/api/data/projects/${encodeURIComponent(projectId)}/pages`,
      signal,
      query,
    );
    if (!isRecord(body)) break;
    pages.push(...readListedPages(body["pages"]));
    const next = body["next_cursor"];
    if (typeof next !== "string" || next.length === 0 || next === cursor) {
      break;
    }
    cursor = next;
  }
  return pages;
}

async function stageStatus(
  projectId: string,
  idx0: number,
  stageId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const body = await readJson(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages`,
    signal,
  );
  if (!Array.isArray(body)) return null;
  for (const item of body) {
    if (!isRecord(item)) continue;
    if (item["stage_id"] !== stageId) continue;
    const status = item["status"];
    return typeof status === "string" ? status : null;
  }
  return null;
}

function parseFlags(body: unknown): ParsedFlag[] | null {
  if (!isRecord(body)) return null;
  const raw = body["flags"];
  if (!Array.isArray(raw)) return null;
  const flags: ParsedFlag[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const wordId = item["word_id"];
    const wordText = item["word_text"];
    if (typeof wordId !== "string" || wordId.length === 0) continue;
    if (typeof wordText !== "string") continue;
    flags.push({ wordId, wordText });
  }
  return flags;
}

function queueItemFromFlag(flag: ParsedFlag, pageId: string): QueueItem {
  return {
    id: flag.wordId,
    word: flag.wordText,
    ctxL: "",
    ctxR: "",
    reason: "bad_word",
    page: pageId,
    line: 0,
    reviewer: "auto",
    comments: 0,
    status: "pending",
  };
}

/**
 * Build the text-review queue from wordcheck flags on pages that are not
 * yet attested (`text_review` clean). No flags and no open pages is an
 * empty queue. Demo and missing ids do not touch the network.
 */
export async function loadTextReviewQueue(
  projectId: string,
  signal: AbortSignal,
): Promise<TextReviewQueueSnapshot> {
  if (!isLiveProjectId(projectId)) return emptyQueue();
  const pages = await listProjectPages(projectId, signal);
  if (signal.aborted) throw abortError();
  const queue: QueueItem[] = [];
  let attestedPages = 0;
  for (const page of pages) {
    const reviewStatus = await stageStatus(
      projectId,
      page.idx0,
      "text_review",
      signal,
    );
    if (reviewStatus === "clean") {
      attestedPages += 1;
      continue;
    }
    const body = await readJson(
      `/api/data/projects/${encodeURIComponent(projectId)}/pages/${page.idx0}/stages/wordcheck/flags`,
      signal,
    );
    const flags = body === null ? null : parseFlags(body);
    if (flags === null) continue;
    const pageId = pageIdForIdx(page.idx0);
    for (const flag of flags) {
      queue.push(queueItemFromFlag(flag, pageId));
    }
  }
  if (queue.length === 0) return emptyQueue();
  return {
    queue,
    threads: [],
    totals: {
      total: queue.length,
      queue: queue.length,
      pending: queue.length,
      discuss: 0,
      approved: 0,
      clean: attestedPages,
      comments: 0,
    },
  };
}
