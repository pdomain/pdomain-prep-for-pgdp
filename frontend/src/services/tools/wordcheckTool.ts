/**
 * wordcheckTool.ts — Real WordcheckToolServices backed by the v2 API.
 *
 * Backend routes used:
 *   POST /api/data/projects/{id}/wordlist-promotion (promote to library)
 *
 * W4 Group 3 — now real:
 *   POST /api/data/projects/{id}/project-stages/wordcheck/accept-dict
 *   POST /api/data/projects/{id}/project-stages/wordcheck/accept-high
 *   POST /api/data/projects/{id}/project-stages/wordcheck/confirm (W4 G1)
 *
 * At I1: accept-dict and accept-high routes exist but return empty results
 * (no real dictionary-fix or candidate data model yet — I2 TODO).
 *
 * @see frontend/src/machines/tools/wordcheckTool.ts — WordcheckToolServices
 * @see src/pdomain_prep_for_pgdp/api/data/pages.py — wordlist-promotion route
 */

import { api } from "@/api/client";
import type {
  ListTotals,
  Suspect,
  SuspectTotals,
  WordcheckToolServices,
} from "@/machines/tools/wordcheckTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Accept all dictionary-matched fixes.
 *
 * W4 Group 3: POST /api/data/projects/{id}/project-stages/wordcheck/accept-dict
 * At I1: returns empty fixedIds (no real fix model yet — I2 TODO).
 */
async function acceptDictionaryFixes(
  projectId: string,
): Promise<{ fixedIds: string[] }> {
  try {
    const result = await api.post<{ fixed_ids?: string[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/wordcheck/accept-dict`,
      {},
    );
    return { fixedIds: result.fixed_ids ?? [] };
  } catch {
    return { fixedIds: [] };
  }
}

/**
 * Accept all high-confidence candidates in the list builder.
 *
 * W4 Group 3: POST /api/data/projects/{id}/project-stages/wordcheck/accept-high
 * At I1: returns empty acceptedIds (no real candidate model yet — I2 TODO).
 */
async function acceptHighConfidence(
  projectId: string,
): Promise<{ acceptedIds: string[] }> {
  try {
    const result = await api.post<{ accepted_ids?: string[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/wordcheck/accept-high`,
      {},
    );
    return { acceptedIds: result.accepted_ids ?? [] };
  } catch {
    return { acceptedIds: [] };
  }
}

/**
 * Promote the project word list to the shared library.
 *
 * Uses POST /api/data/projects/{id}/wordlist-promotion — exists at I1.
 */
async function promoteToLibrary(projectId: string): Promise<ListTotals> {
  try {
    const result = await api.post<ListTotals>(
      `/api/data/projects/${encodeURIComponent(projectId)}/wordlist-promotion`,
    );
    return result;
  } catch {
    return {
      good: 0,
      bad: 0,
      bookGood: 0,
      bookBad: 0,
      libraryGood: 0,
      libraryBad: 0,
    };
  }
}

/**
 * Confirm the wordcheck stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/wordcheck/confirm
 * W4 Group 1 — wired real route.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/wordcheck/confirm`,
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

/** Build real WordcheckToolServices for injection into the machine. */
export function buildRealWordcheckToolServices(): WordcheckToolServices {
  return {
    ...buildRealStageSettingsServices(),
    acceptDictionaryFixes,
    acceptHighConfidence,
    promoteToLibrary,
    confirmStage,
  };
}

// ---------------------------------------------------------------------------
// Mount hydrate — wordcheck flags, or an honest empty scan
// ---------------------------------------------------------------------------

export const EMPTY_SUSPECT_TOTALS: SuspectTotals = {
  total: 0,
  done: 0,
  suspects: 0,
  stealth: 0,
  flagged: 0,
  reviewed: 0,
  clean: 0,
};

export interface WordcheckScan {
  suspects: Suspect[];
  totals: SuspectTotals;
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

/** Short alphabetic tokens are the real-word (stealth) scanno shape. */
export function suspectTypeForWord(word: string): "stealth" | "common" {
  return /^[A-Za-z]{2,5}$/.test(word) ? "stealth" : "common";
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

function suspectFromFlag(flag: ParsedFlag, pageId: string): Suspect {
  return {
    id: flag.wordId,
    word: flag.wordText,
    fix: "",
    ctxL: "",
    ctxR: "",
    type: suspectTypeForWord(flag.wordText),
    page: pageId,
    line: 0,
    rule: "bad_word",
    score: 1,
  };
}

function totalsFor(
  pageCount: number,
  suspects: readonly Suspect[],
  cleanPages: number,
): SuspectTotals {
  let stealth = 0;
  for (const suspect of suspects) {
    if (suspect.type === "stealth") stealth += 1;
  }
  return {
    total: pageCount,
    done: pageCount,
    suspects: suspects.length,
    stealth,
    flagged: suspects.length,
    reviewed: 0,
    clean: cleanPages,
  };
}

/**
 * Load wordcheck flags for every page.
 *
 * A 404 (stage not clean) or an empty flag list contributes no suspects.
 * When nothing is flagged, totals are the zeroed legitimate empty scan.
 * Demo and missing ids do not touch the network.
 */
export async function loadWordcheckScan(
  projectId: string,
  signal: AbortSignal,
): Promise<WordcheckScan> {
  if (!isLiveProjectId(projectId)) {
    return { suspects: [], totals: EMPTY_SUSPECT_TOTALS };
  }
  const pages = await listProjectPages(projectId, signal);
  if (signal.aborted) throw abortError();
  const suspects: Suspect[] = [];
  let cleanPages = 0;
  for (const page of pages) {
    const body = await readJson(
      `/api/data/projects/${encodeURIComponent(projectId)}/pages/${page.idx0}/stages/wordcheck/flags`,
      signal,
    );
    const flags = body === null ? null : parseFlags(body);
    if (flags === null) continue;
    if (flags.length === 0) {
      cleanPages += 1;
      continue;
    }
    const pageId = pageIdForIdx(page.idx0);
    for (const flag of flags) {
      suspects.push(suspectFromFlag(flag, pageId));
    }
  }
  if (suspects.length === 0) {
    return { suspects: [], totals: EMPTY_SUSPECT_TOTALS };
  }
  return {
    suspects,
    totals: totalsFor(pages.length, suspects, cleanPages),
  };
}
