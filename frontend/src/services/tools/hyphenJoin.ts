/**
 * hyphenJoin.ts — Real HyphenJoinServices backed by the v2 API.
 *
 * Backend routes:
 *   POST /api/data/projects/{id}/project-stages/hyphen_join/scan
 *     (R2 — I2 DRIFT resolved: project-level hyphen scan)
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages/hyphen-join/candidates
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/hyphen-join/decisions
 *
 * @see frontend/src/machines/tools/hyphenJoin.ts — HyphenJoinServices
 */

import { api } from "@/api/client";
import type {
  HyphenJoinServices,
  HyphenCase,
  HyphenCaseKind,
  HyphenCaseStatus,
  HyphenTotals,
} from "@/machines/tools/hyphenJoin";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCaseStatus(value: string): value is HyphenCaseStatus {
  return (
    value === "joined" ||
    value === "validated" ||
    value === "undecided" ||
    value === "flagged" ||
    value === "crosspage" ||
    value === "mismatch"
  );
}

function isCaseKind(value: string): value is HyphenCaseKind {
  return (
    value === "auto" ||
    value === "crosspage" ||
    value === "manual" ||
    value === "mismatch"
  );
}

function pageIdForIdx(idx0: number): string {
  return String(idx0).padStart(4, "0");
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mapScanCase(item: unknown): HyphenCase | null {
  if (!isRecord(item)) return null;
  const id = item["id"];
  const prefix = item["prefix"];
  const suffix = item["suffix"];
  const idx0 = item["idx0"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof prefix !== "string" || typeof suffix !== "string") return null;
  if (typeof idx0 !== "number" || !Number.isInteger(idx0) || idx0 < 0) {
    return null;
  }
  const statusRaw = item["status"];
  const kindRaw = item["kind"];
  const status =
    typeof statusRaw === "string" && isCaseStatus(statusRaw)
      ? statusRaw
      : "undecided";
  const kind =
    typeof kindRaw === "string" && isCaseKind(kindRaw) ? kindRaw : "auto";
  return {
    caseId: id,
    kind,
    head: prefix,
    tail: suffix,
    line: 1,
    page: pageIdForIdx(idx0),
    status,
    validated: status === "validated" || status === "joined",
    conf: 1,
    book: {
      inBody: true,
      joinedElsewhere: false,
      mismatch: kind === "mismatch" || status === "mismatch",
    },
  };
}

/** Map the project scan body onto the tool's case records. */
export function hyphenCasesFromScan(body: unknown): {
  cases: HyphenCase[];
  totals: HyphenTotals;
} {
  const record = isRecord(body) ? body : {};
  const rawCases = record["cases"];
  const cases = Array.isArray(rawCases)
    ? rawCases.flatMap((item) => {
        const mapped = mapScanCase(item);
        return mapped === null ? [] : [mapped];
      })
    : [];
  const totalsRecord = isRecord(record["totals"]) ? record["totals"] : {};
  return {
    cases,
    totals: {
      total: isRecord(record["totals"])
        ? numberField(totalsRecord, "total")
        : cases.length,
      joined: numberField(totalsRecord, "joined"),
      validated: numberField(totalsRecord, "validated"),
      undecided: numberField(totalsRecord, "undecided"),
      flagged: numberField(totalsRecord, "flagged"),
      crosspage: numberField(totalsRecord, "crosspage"),
      mismatch: numberField(totalsRecord, "mismatch"),
      unvalidated: numberField(totalsRecord, "unvalidated"),
    },
  };
}

function pageIdx0(page: string): number | null {
  const match = /(\d+)$/.exec(page);
  const digits = match?.[1];
  if (digits === undefined) return null;
  const idx = Number.parseInt(digits, 10);
  return Number.isNaN(idx) ? null : idx;
}

function decisionForCase(hyphenCase: HyphenCase): "join" | "keep" | null {
  if (hyphenCase.status === "joined") return "join";
  if (hyphenCase.status === "crosspage" && hyphenCase.validated) return "join";
  if (hyphenCase.status === "validated" && hyphenCase.kind === "mismatch") {
    return "join";
  }
  if (hyphenCase.status === "validated") return "keep";
  return null;
}

async function postDecisions(
  projectId: string,
  page: string,
  decisions: { candidate_id: string; decision: "join" | "keep" }[],
): Promise<void> {
  if (decisions.length === 0) return;
  const idx = pageIdx0(page);
  if (idx === null) return;
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx}/stages/hyphen-join/decisions`,
    { decisions },
  );
}

/**
 * Scan hyphenation candidates across all pages.
 *
 * Route: POST /api/data/projects/{id}/project-stages/hyphen_join/scan
 * R2 — I2 DRIFT resolved (seam-remediation plan).
 */
async function scanHyphenation(
  projectId: string,
): Promise<{ cases: HyphenCase[]; totals: HyphenTotals }> {
  const data: unknown = await api.post<unknown>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/hyphen_join/scan`,
    {},
  );
  return hyphenCasesFromScan(data);
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

async function persistDecision(
  projectId: string,
  page: string,
  candidateId: string,
  decision: "join" | "keep",
): Promise<void> {
  await postDecisions(projectId, page, [
    { candidate_id: candidateId, decision },
  ]);
}

async function persistPage(
  projectId: string,
  pageId: string,
  cases: HyphenCase[],
): Promise<void> {
  const decisions = cases.flatMap((hyphenCase) => {
    if (hyphenCase.page !== pageId) return [];
    const decision = decisionForCase(hyphenCase);
    if (decision === null) return [];
    return [{ candidate_id: hyphenCase.caseId, decision }];
  });
  await postDecisions(projectId, pageId, decisions);
}

/** Build real HyphenJoinServices for injection into the machine. */
export function buildRealHyphenJoinServices(): HyphenJoinServices {
  return { scanHyphenation, persistDecision, persistPage };
}
