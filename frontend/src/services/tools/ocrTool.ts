/**
 * ocrTool.ts — Real OcrToolServices backed by the v2 API.
 *
 * Backend routes:
 *   GET  /api/data/projects/{id}/project-stages/ocr/tokens/{page_id}
 *     (R2 — I2 DRIFT resolved: low-confidence tokens from words.json)
 *   POST /api/data/projects/{id}/project-stages/ocr/confirm  (W4 Group 1)
 *
 * @see frontend/src/machines/tools/ocrTool.ts — OcrToolServices
 */

import { api } from "@/api/client";
import type {
  OcrPageRow,
  OcrToolServices,
  OcrToken,
} from "@/machines/tools/ocrTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Fetch low-score OCR tokens for a page.
 *
 * Route: GET /api/data/projects/{id}/project-stages/ocr/tokens/{page_id}
 * R2 — I2 DRIFT resolved (seam-remediation plan).
 */
async function fetchPageTokens(
  projectId: string,
  pageId: string,
): Promise<{ tokens: OcrToken[] }> {
  const data = await api.get<{ tokens: OcrToken[] }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/ocr/tokens/${encodeURIComponent(pageId)}`,
  );
  return data;
}

/**
 * Confirm OCR stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/ocr/confirm
 * W4 Group 1 — wired real route.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/ocr/confirm`,
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

/** Build real OcrToolServices for injection into the machine. */
export function buildRealOcrToolServices(): OcrToolServices {
  return { ...buildRealStageSettingsServices(), fetchPageTokens, confirmStage };
}

// ---------------------------------------------------------------------------
// Mount hydrate — completed OCR rows, or an honest empty result
// ---------------------------------------------------------------------------

/** Words at or above this score are not low-confidence (matches the API). */
const LOW_CONFIDENCE = 0.5;

export type OcrHydrateResult =
  { kind: "empty" } | { kind: "rows"; rows: OcrPageRow[] };

interface ListedPage {
  idx0: number;
  prefix: string;
}

interface WordConf {
  confidence: number;
  deleted: boolean;
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

function wordConfsFromList(list: unknown[]): WordConf[] {
  const words: WordConf[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const confidence = item["confidence"];
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
      continue;
    }
    words.push({ confidence, deleted: item["deleted"] === true });
  }
  return words;
}

/** Page-text `{ words }` or a raw words.json array. Null when neither is present. */
function parseWordConfs(body: unknown): WordConf[] | null {
  if (Array.isArray(body)) return wordConfsFromList(body);
  if (!isRecord(body)) return null;
  const wrapped = body["words"];
  if (!Array.isArray(wrapped)) return null;
  return wordConfsFromList(wrapped);
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

async function loadCleanOcrWords(
  projectId: string,
  idx0: number,
  signal: AbortSignal,
): Promise<WordConf[] | null> {
  const textBody = await readJson(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/text/_`,
    signal,
  );
  const fromText = textBody === null ? null : parseWordConfs(textBody);
  if (fromText !== null) return fromText;
  // Compound OCR has no single-file artifact; words.json is on the text route.
  // Try the artifact anyway for a raw words array when the text route is empty.
  const artifact = await readJson(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/ocr/artifact`,
    signal,
  );
  if (artifact === null) return null;
  return parseWordConfs(artifact);
}

/** Row stats from a words.json (or page-text words) payload. */
function ocrPageRowFromWords(
  idx: string,
  prefix: string,
  words: readonly WordConf[],
): OcrPageRow {
  let count = 0;
  let lowConf = 0;
  let sum = 0;
  for (const word of words) {
    if (word.deleted) continue;
    count += 1;
    sum += word.confidence;
    if (word.confidence < LOW_CONFIDENCE) lowConf += 1;
  }
  const row: OcrPageRow = {
    idx,
    prefix,
    state: lowConf > 0 ? "flagged" : "clean",
    words: count,
    lowConf,
  };
  if (count > 0) row.meanConf = sum / count;
  return row;
}

/** SSE bridge pages are `{ id, mode, lastRunAt, _total }`, not OCR rows. */
export function ocrRowFromSseId(id: string): OcrPageRow {
  return { idx: id, prefix: id, state: "clean" };
}

/**
 * Load one finished OCR page before the tool marks it done.
 *
 * A `stage-status: clean` event carries no word stats. This reads the
 * stage status and the words, and returns null while the page is still
 * running so a stale snapshot cannot be stored as a finished row.
 */
export async function loadFinishedOcrRow(
  projectId: string,
  pageId: string,
  signal: AbortSignal,
): Promise<OcrPageRow | null> {
  if (!isLiveProjectId(projectId)) return null;
  if (!/^\d+$/.test(pageId)) return null;
  const idx0 = Number.parseInt(pageId, 10);
  const status = await stageStatus(projectId, idx0, "ocr", signal);
  if (status !== "clean") return null;
  const words = await loadCleanOcrWords(projectId, idx0, signal);
  const idx = pageIdForIdx(idx0);
  if (words === null) return { idx, prefix: idx, state: "clean" };
  return ocrPageRowFromWords(idx, idx, words);
}

/**
 * Load completed OCR pages for a real project.
 *
 * Running rows are listed first so a clean page does not look like the end
 * of the run while another page is still recognising. Demo and missing ids
 * do not touch the network.
 */
export async function hydrateOcrProject(
  projectId: string,
  signal: AbortSignal,
): Promise<OcrHydrateResult> {
  if (!isLiveProjectId(projectId)) return { kind: "empty" };
  const pages = await listProjectPages(projectId, signal);
  if (signal.aborted) throw abortError();
  if (pages.length === 0) return { kind: "empty" };

  const running: OcrPageRow[] = [];
  const done: OcrPageRow[] = [];
  for (const page of pages) {
    const status = await stageStatus(projectId, page.idx0, "ocr", signal);
    const idx = pageIdForIdx(page.idx0);
    if (status === "running") {
      running.push({ idx, prefix: page.prefix, state: "running" });
      continue;
    }
    if (status !== "clean") continue;
    const words = await loadCleanOcrWords(projectId, page.idx0, signal);
    if (words === null) {
      done.push({ idx, prefix: page.prefix, state: "clean" });
      continue;
    }
    done.push(ocrPageRowFromWords(idx, page.prefix, words));
  }
  if (running.length === 0 && done.length === 0) return { kind: "empty" };
  return { kind: "rows", rows: [...running, ...done] };
}
