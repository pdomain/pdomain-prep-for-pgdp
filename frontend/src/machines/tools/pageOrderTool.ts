/**
 * pageOrderTool — XState v5 machine for the Page order stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-page-order.yaml`
 *
 * THE MODEL: the book is an ordered list of LEAVES grouped into NUMBERING RUNS.
 * A run = contiguous span sharing a numbering style (roman/arabic/none), a
 * start (Set: explicit value · Continue: previous run's last), and a step.
 * Roles (text / plate / blank / skip / cover) are per-leaf. Page labels are
 * COMPUTED from runs + roles; the ledger reconciles OCR-read folios against
 * those computed labels.
 *
 * One workspace, three parallel regions:
 *   - ledger: table/grid view with drag-reorder and inline role/run dropdowns
 *   - inspector: per-leaf workbench (right rail)
 *   - runs: editable spine (run list + add/edit forms)
 *   - naming: output file naming (in workspace.on)
 *
 * ## Divergences from YAML
 *
 * ### F5.4-1 — naming region as workspace-level context (not parallel region)
 * The YAML models `naming` as a parallel region with a single `configured` leaf
 * state. Since it has no behavioral sub-states (it is always `configured`), it
 * is implemented as a workspace-level `SET_NAME_PART` event handler rather than
 * a parallel region. This avoids 4-region state combinatorics for a region that
 * never transitions between sub-states.
 *
 * ### F5.4-2 — `assignSelectedLeaf` raises LEAF_SELECTED as `always` guard
 * The YAML raises LEAF_SELECTED internally from `assignSelectedLeaf` to trigger
 * the inspector region. XState v5 cannot raise internal events that cross parallel
 * regions safely. Resolution: the inspector watches for `SELECT_LEAF` directly
 * (same event as ledger) — both the ledger and inspector handle `SELECT_LEAF`.
 * The inspector transitions on `SELECT_LEAF` (not `LEAF_SELECTED`).
 *
 * ### F5.4-3 — `computeLabels` + `reconcile` are pure synchronous helpers
 * The YAML marks these as side-effect-free derivations. They are implemented as
 * plain assign actions that compute folioLabel per leaf from (runs, roles, order)
 * and flag per leaf from (computed label vs ocrFolio). They run after every
 * model edit per the YAML contract.
 *
 * ### F5.4-4 — `_dropTarget` stored in context (contrary to DIVERGENCES.md #8 view-field rule)
 * The YAML stores `ctx._over = { scan, after }` in context. `_dropTarget` IS
 * stored in machine context (see `PageOrderToolContext._dropTarget`). This is
 * intentional: the `reorderable` guard fires on DRAG_START before any DRAG_OVER
 * arrives, and the `moveLeaves` action must read the last drop position from
 * context at DROP time. Storing it in local React state would not be visible to
 * the XState `assign` action. The DIVERGENCES.md #8 convention (omit view-only
 * fields) does not apply here — `_dropTarget` is read by the `moveScans` action
 * at DROP time and is therefore load-bearing context.
 * See DIVERGENCES.md §F5.4-4 for the full record.
 *
 * ### F5.4-5 — Side-effect service calls are async fire-and-forget
 * `persistLeaf`, `persistOrder`, `persistRuns`, `persistNaming` are called as
 * side-effect actions (not invoke actors) — they fire and are not awaited.
 * Errors are swallowed at F5. At I1, wrap in fromPromise with error handling.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-page-order.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/page_order/page-order-unified.jsx
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type LeafRole = "text" | "plate" | "blank" | "skip" | "cover";
export type RunStyle = "roman" | "arabic" | "none";
export type LensKind =
  | "all"
  | "outOfSequence"
  | "gap"
  | "duplicate"
  | "misread"
  | "missingNumber"
  | "unnumbered"
  | "marker"
  | "countedBlank"
  | "renumber"
  | "continues";
export type ViewKind = "table" | "grid";

export interface RunStart {
  mode: "set" | "continue";
  value?: number;
}

export interface Run {
  id: string;
  label: string;
  style: RunStyle;
  start: RunStart;
  step: number;
  /** [firstScan, lastScan] inclusive */
  span: [number, number];
}

export interface Leaf {
  scan: number;
  role: LeafRole;
  runId: string | null;
  /** Computed label derived from run + role + order */
  folioLabel?: string | null;
  /** OCR-read folio from the physical page */
  ocrFolio?: string | null;
  /** Reconciliation flags */
  flags: string[];
  /** For plates: descriptive tag (e.g. "Plate VIII") */
  plateTag?: string;
  /** Foldout segments data */
  foldout?: unknown;
  /**
   * PGDP output filename prefix from the naming manifest (e.g. "f001", "c001").
   * Null for skip pages (not included in package). Undefined if manifest has
   * not yet been fetched (page_order stage not yet clean).
   *
   * Populated by the MANIFEST_PUSH event after fetching
   * GET /api/data/projects/{id}/project-stages/page_order/artifact.
   */
  prefix?: string | null;
}

export interface PageOrderTotals {
  total: number;
  scanned: number;
  outOfSeq: number;
  gaps: number;
  duplicates: number;
}

export interface NamingScheme {
  parts: { seq: boolean; type: boolean; folio: boolean };
  digits: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface PageOrderToolServices {
  /**
   * PATCH /api/projects/:id/pages/:pageId/leaf
   * Persists role, runId, folio override, or plateTag for a single leaf.
   */
  persistLeaf(projectId: string, leaf: Leaf): Promise<void>;

  /**
   * PUT /api/projects/:id/pages/reorder
   * Persists the new page order (ordered scan list).
   * Also marks page_order project stage dirty + emits PageReorderUpdate SSE.
   */
  persistOrder(projectId: string, scans: number[]): Promise<void>;

  /**
   * PUT /api/projects/:id/stages/page_order/runs
   * Persists the full runs array.
   */
  persistRuns(projectId: string, runs: Run[]): Promise<void>;

  /**
   * PUT /api/projects/:id/stages/page_order/naming
   * Persists the naming scheme.
   */
  persistNaming(projectId: string, naming: NamingScheme): Promise<void>;

  /**
   * POST /api/projects/:id/stages/page_order/confirm
   * Commits order, runs, and naming; advances to next stage.
   */
  confirmStage(projectId: string): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface PageOrderToolInput {
  projectId: string;
  stageIndex: number;
  services: PageOrderToolServices;
}

export interface PageOrderToolContext {
  projectId: string;
  stageIndex: number;
  services: PageOrderToolServices;
  /** Partial leaves accumulated during readingFolios phase */
  partialLeaves: { scan: number; ocrFolio: string | null }[];
  /** Full leaf model (assigned on FOLIOS_DONE) */
  leaves: Leaf[];
  runs: Run[];
  totals: PageOrderTotals | null;
  lens: LensKind;
  view: ViewKind;
  selectedLeaf: number | null;
  selScans: number[];
  openDropdown: { scan: number; kind: "role" | "run" } | null;
  runEdit: string | null;
  addingRun: boolean;
  naming: NamingScheme | null;
  error: { message: string } | null;
  /** Last drag-over target (transient, not persisted) */
  _dropTarget: { scan: number; after: boolean } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type PageOrderToolEvent =
  // folio reading phase
  | { type: "FOLIO_PUSH"; scan: number; ocrFolio: string | null }
  | {
      type: "FOLIOS_DONE";
      leaves: Leaf[];
      runs: Run[];
      totals: PageOrderTotals;
    }
  /**
   * Naming manifest fetched from the backend.
   *
   * Carries {scan → prefix} map from
   * GET /api/data/projects/{id}/project-stages/page_order/artifact.
   * scan is the 0-based idx0 (matches Leaf.scan).
   * prefix is the PGDP filename prefix (e.g. "f001", "c001"), or null for skip pages.
   *
   * Sent by the surface component after FOLIOS_DONE and after any re-run.
   * The machine merges these into Leaf.prefix for the naming preview column.
   */
  | { type: "MANIFEST_PUSH"; prefixes: Record<number, string | null> }
  // ledger
  | { type: "SELECT_LEAF"; scan: number }
  | { type: "TOGGLE_SCAN"; scan: number }
  | { type: "OPEN_DROPDOWN"; scan: number; kind: "role" | "run" }
  | { type: "SET_ROLE"; scan: number; role: LeafRole }
  | { type: "SET_RUN"; scan: number; runId: string }
  | { type: "SET_LENS"; value: LensKind }
  | { type: "SET_VIEW"; value: ViewKind }
  | { type: "DRAG_START"; scan: number }
  | { type: "DRAG_OVER"; scan: number; after: boolean }
  | { type: "DROP"; scan: number }
  | { type: "DRAG_CANCEL" }
  // inspector
  | { type: "OVERRIDE_FOLIO"; patch: Partial<Leaf> }
  | { type: "SET_PLATE_TAG"; patch: Partial<Leaf> }
  | { type: "EDIT_FOLDOUT"; patch: Partial<Leaf> }
  | { type: "OPEN_SCAN" }
  | { type: "CLOSE_INSPECTOR" }
  // runs
  | { type: "ADD_RUN" }
  | { type: "CONFIRM_ADD"; run: Run }
  | { type: "CANCEL" }
  | { type: "EDIT_RUN"; runId: string }
  | { type: "SET_STYLE"; patch: Partial<Run> }
  | { type: "SET_START"; patch: Partial<Run> }
  | { type: "REMOVE_RUN" }
  | { type: "DONE" }
  // naming
  | { type: "SET_NAME_PART"; patch: Partial<NamingScheme> }
  // lifecycle
  | { type: "CONFIRM_ADVANCE" }
  | { type: "UPSTREAM_CHANGED" };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute the folioLabel for each leaf from the runs + roles + order.
 * Simplified: body-text leaves get roman (front matter) or arabic (body/appendix).
 * Plates and blanks get "—" or "[Blank Page]".
 * At I1, replace with the full algorithm from the YAML spec comments.
 */
function computeLabels(leaves: Leaf[], runs: Run[]): Leaf[] {
  // Build scan → run lookup
  const runById = new Map<string, Run>(runs.map((r) => [r.id, r]));
  const result: Leaf[] = [];
  // Track counters per run
  const runCounters = new Map<string, number>();

  for (const leaf of leaves) {
    const run = leaf.runId ? runById.get(leaf.runId) : null;

    if (leaf.role === "plate") {
      result.push({ ...leaf, folioLabel: "—" });
      continue;
    }
    if (leaf.role === "blank" || leaf.role === "skip") {
      // Blank counted in run gets a number; binder's blank gets [Blank Page]
      if (run) {
        const count = (runCounters.get(run.id) ?? 0) + 1;
        runCounters.set(run.id, count);
        const start = run.start.mode === "set" ? (run.start.value ?? 1) : 1;
        const n = start + (count - 1) * run.step;
        const label =
          run.style === "roman"
            ? toRoman(n)
            : run.style === "arabic"
              ? String(n)
              : "—";
        result.push({ ...leaf, folioLabel: label });
      } else {
        result.push({ ...leaf, folioLabel: "[Blank Page]" });
      }
      continue;
    }

    if (!run) {
      result.push({ ...leaf, folioLabel: null });
      continue;
    }

    const count = (runCounters.get(run.id) ?? 0) + 1;
    runCounters.set(run.id, count);
    const start = run.start.mode === "set" ? (run.start.value ?? 1) : 1;
    const n = start + (count - 1) * run.step;
    const label =
      run.style === "roman"
        ? toRoman(n)
        : run.style === "arabic"
          ? String(n)
          : "—";
    result.push({ ...leaf, folioLabel: label });
  }

  return result;
}

/** Simplified roman numeral converter (I–MMMCMXCIX). */
function toRoman(n: number): string {
  if (n <= 0) return String(n);
  const pairs: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let result = "";
  let rem = n;
  for (const [val, sym] of pairs) {
    while (rem >= val) {
      result += sym;
      rem -= val;
    }
  }
  return result;
}

/**
 * Reconcile OCR folios against computed labels; produce flags per leaf.
 * Returns updated leaves + recomputed totals.
 */
function reconcile(
  leaves: Leaf[],
  currentTotals: PageOrderTotals | null,
): { leaves: Leaf[]; totals: PageOrderTotals } {
  const seen = new Map<string, number>(); // computed label → first scan
  let outOfSeq = 0;
  const gaps = 0;
  let duplicates = 0;

  const updated = leaves.map((leaf) => {
    const flags: string[] = [];
    const computed = leaf.folioLabel ?? null;

    if (computed && computed !== "[Blank Page]" && computed !== "—") {
      // Check duplicate
      if (seen.has(computed)) {
        flags.push("duplicate");
        duplicates++;
      } else {
        seen.set(computed, leaf.scan);
      }

      // Check misread (OCR folio doesn't match computed)
      if (leaf.ocrFolio && leaf.ocrFolio !== computed) {
        flags.push("outOfSequence");
        outOfSeq++;
      }
    }

    return { ...leaf, flags };
  });

  const total = currentTotals?.total ?? leaves.length;
  const scanned = leaves.filter((l) => l.ocrFolio !== null).length;

  return {
    leaves: updated,
    totals: {
      total,
      scanned,
      outOfSeq,
      gaps,
      duplicates,
    },
  };
}

/**
 * Move selected scans to a new position.
 * If selScans is empty, moves the DROP event's scan.
 */
function moveScans(
  leaves: Leaf[],
  selScans: number[],
  dropScan: number,
  dropTarget: { scan: number; after: boolean } | null,
): Leaf[] {
  // Determine which scans to move
  const toMove = selScans.length > 0 ? selScans : [dropScan];
  const moving = leaves.filter((l) => toMove.includes(l.scan));
  const rest = leaves.filter((l) => !toMove.includes(l.scan));

  if (!dropTarget) return leaves;

  const insertIdx = rest.findIndex((l) => l.scan === dropTarget.scan);
  if (insertIdx === -1) return [...rest, ...moving];

  const insertAt = dropTarget.after ? insertIdx + 1 : insertIdx;
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

function patchLeafByScan(
  leaves: Leaf[],
  scan: number,
  fn: (l: Leaf) => Leaf,
): Leaf[] {
  return leaves.map((l) => (l.scan === scan ? fn(l) : l));
}

function insertRun(runs: Run[], run: Run): Run[] {
  return [...runs, run];
}

function patchRunById(
  runs: Run[],
  runId: string | null,
  patch: Partial<Run>,
): Run[] {
  if (!runId) return runs;
  return runs.map((r) => (r.id === runId ? { ...r, ...patch } : r));
}

function removeRunMergingUp(runs: Run[], runId: string | null): Run[] {
  if (!runId) return runs;
  return runs.filter((r) => r.id !== runId);
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const pageOrderToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: PageOrderToolContext;
    events: PageOrderToolEvent;
    input: PageOrderToolInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: confirmStage`
     * DIVERGENCE #3: onDone carries event.output not event.data.
     */
    confirmStage: fromPromise<
      { ok: boolean },
      { projectId: string; services: PageOrderToolServices }
    >(({ input }) => input.services.confirmStage(input.projectId)),
  },

  guards: {
    /**
     * YAML: `reorderable: ctx.view === 'table'`
     * Drag-reorder only available in table view.
     */
    reorderable: ({ context }) => context.view === "table",

    /**
     * YAML: `sequenceClean: ctx.totals.outOfSeq === 0 && ctx.totals.duplicates === 0`
     */
    sequenceClean: ({ context }) => {
      if (!context.totals) return false;
      return context.totals.outOfSeq === 0 && context.totals.duplicates === 0;
    },
  },

  actions: {
    /**
     * YAML: `mergeFolio: upsert { scan, ocrFolio } into ctx.leaves`
     * During readingFolios, accumulates partial leaf data.
     */
    mergeFolio: assign({
      partialLeaves: ({ context, event }) => {
        if (event.type !== "FOLIO_PUSH") return context.partialLeaves;
        const existing = context.partialLeaves.findIndex(
          (l) => l.scan === event.scan,
        );
        if (existing === -1) {
          return [
            ...context.partialLeaves,
            { scan: event.scan, ocrFolio: event.ocrFolio },
          ];
        }
        return context.partialLeaves.map((l, i) =>
          i === existing ? { ...l, ocrFolio: event.ocrFolio } : l,
        );
      },
    }),

    /**
     * YAML: `assignModel + computeLabels + reconcile`
     * All three are folded into one assign (DIVERGENCES.md #9 pattern).
     */
    assignModelAndCompute: assign(
      (
        _args,
        params: {
          leaves: Leaf[];
          runs: Run[];
          totals: PageOrderTotals;
        },
      ): Partial<PageOrderToolContext> => {
        // computeLabels assigns folioLabel per leaf based on run configuration.
        // On initial load, use the server-provided totals as-is — they are the
        // authoritative sequencing analysis. reconcile() is only called on
        // subsequent local mutations (reorder, role assignment) where a fresh
        // flag derivation is needed.
        const leaves = computeLabels(params.leaves, params.runs);
        return {
          leaves,
          runs: params.runs,
          totals: params.totals,
          partialLeaves: [],
        };
      },
    ),

    /**
     * Naming manifest received — merge prefixes into leaves.
     *
     * Fired by MANIFEST_PUSH (from surface component after fetching the
     * page_order artifact). Updates Leaf.prefix for each leaf whose scan
     * (idx0) appears in event.prefixes. Leaves not in the map keep their
     * existing prefix (undefined = not yet received).
     */
    assignPrefixes: assign({
      leaves: ({ context, event }) => {
        if (event.type !== "MANIFEST_PUSH") return context.leaves;
        const { prefixes } = event;
        return context.leaves.map((leaf): Leaf => {
          if (!(leaf.scan in prefixes)) return leaf;
          // prefixes[leaf.scan] is string | null — the key exists (checked above)
          const prefix: string | null = prefixes[leaf.scan] ?? null;
          return { ...leaf, prefix };
        });
      },
    }),

    /** YAML: `assignLens: ctx.lens = event.value` */
    assignLens: assign({
      lens: ({ event }) => {
        if (event.type !== "SET_LENS") return "all" as const;
        return event.value;
      },
    }),

    /** YAML: `assignView: ctx.view = event.value` */
    assignView: assign({
      view: ({ event }) => {
        if (event.type !== "SET_VIEW") return "table" as const;
        return event.value;
      },
    }),

    /**
     * YAML: `assignSelectedLeaf + LEAF_SELECTED raise`
     * F5.4-2 divergence: inspector reacts to SELECT_LEAF directly.
     */
    assignSelectedLeaf: assign({
      selectedLeaf: ({ event }) => {
        if (event.type !== "SELECT_LEAF") return null;
        return event.scan;
      },
    }),

    /** YAML: `clearSelectedLeaf: ctx.selectedLeaf = null` */
    clearSelectedLeaf: assign({ selectedLeaf: () => null }),

    /** YAML: `toggleScanSelection: ctx.selScans = xor(ctx.selScans, event.scan)` */
    toggleScanSelection: assign({
      selScans: ({ context, event }) => {
        if (event.type !== "TOGGLE_SCAN") return context.selScans;
        const { scan } = event;
        const already = context.selScans.includes(scan);
        return already
          ? context.selScans.filter((s) => s !== scan)
          : [...context.selScans, scan];
      },
    }),

    /** YAML: `assignDropdown` */
    assignDropdown: assign({
      openDropdown: ({ event }) => {
        if (event.type !== "OPEN_DROPDOWN") return null;
        return { scan: event.scan, kind: event.kind };
      },
    }),

    /** YAML: `closeDropdown: ctx.openDropdown = null` */
    closeDropdown: assign({ openDropdown: () => null }),

    /**
     * YAML: `patchLeafRole + computeLabels + reconcile + persistLeaf + closeDropdown`
     * Folded: role patch + recompute in one assign, then side-effect persist.
     */
    patchLeafRole: assign(
      ({ context, event }): Partial<PageOrderToolContext> => {
        if (event.type !== "SET_ROLE") return {};
        const patched = patchLeafByScan(context.leaves, event.scan, (l) => ({
          ...l,
          role: event.role,
        }));
        const withLabels = computeLabels(patched, context.runs);
        const { leaves, totals } = reconcile(withLabels, context.totals);
        return { leaves, totals, openDropdown: null };
      },
    ),

    patchLeafRoleSideEffect: ({ context, event }) => {
      if (event.type !== "SET_ROLE") return;
      const leaf = context.leaves.find((l) => l.scan === event.scan);
      if (leaf) {
        void context.services.persistLeaf(context.projectId, leaf);
      }
    },

    /**
     * YAML: `patchLeafRun + computeLabels + reconcile + persistLeaf + closeDropdown`
     */
    patchLeafRun: assign(
      ({ context, event }): Partial<PageOrderToolContext> => {
        if (event.type !== "SET_RUN") return {};
        const patched = patchLeafByScan(context.leaves, event.scan, (l) => ({
          ...l,
          runId: event.runId,
        }));
        const withLabels = computeLabels(patched, context.runs);
        const { leaves, totals } = reconcile(withLabels, context.totals);
        return { leaves, totals, openDropdown: null };
      },
    ),

    patchLeafRunSideEffect: ({ context, event }) => {
      if (event.type !== "SET_RUN") return;
      const leaf = context.leaves.find((l) => l.scan === event.scan);
      if (leaf) {
        void context.services.persistLeaf(context.projectId, leaf);
      }
    },

    /** YAML: `patchLeaf` — for inspector edits (folio override, plate tag, foldout) */
    patchLeaf: assign(({ context, event }): Partial<PageOrderToolContext> => {
      if (
        event.type !== "OVERRIDE_FOLIO" &&
        event.type !== "SET_PLATE_TAG" &&
        event.type !== "EDIT_FOLDOUT"
      ) {
        return {};
      }
      if (context.selectedLeaf === null) return {};
      const patched = patchLeafByScan(
        context.leaves,
        context.selectedLeaf,
        (l) => ({ ...l, ...event.patch }),
      );
      const withLabels = computeLabels(patched, context.runs);
      const { leaves, totals } = reconcile(withLabels, context.totals);
      return { leaves, totals };
    }),

    patchLeafSideEffect: ({ context }) => {
      if (context.selectedLeaf === null) return;
      const leaf = context.leaves.find((l) => l.scan === context.selectedLeaf);
      if (leaf) {
        void context.services.persistLeaf(context.projectId, leaf);
      }
    },

    /** YAML: `assignDropTarget: ctx._over = { scan, after }` — F5.4-4: stored in context */
    assignDropTarget: assign({
      _dropTarget: ({ event }) => {
        if (event.type !== "DRAG_OVER") return null;
        return { scan: event.scan, after: event.after };
      },
    }),

    /**
     * YAML: `moveLeaves + computeLabels + reconcile + persistOrder + emitOrderChanged`
     */
    moveLeaves: assign(({ context, event }): Partial<PageOrderToolContext> => {
      if (event.type !== "DROP") return {};
      const moved = moveScans(
        context.leaves,
        context.selScans,
        event.scan,
        context._dropTarget,
      );
      const withLabels = computeLabels(moved, context.runs);
      const { leaves, totals } = reconcile(withLabels, context.totals);
      return {
        leaves,
        totals,
        selScans: [],
        _dropTarget: null,
      };
    }),

    moveLeavesSideEffect: ({ context }) => {
      const scans = context.leaves.map((l) => l.scan);
      void context.services.persistOrder(context.projectId, scans);
    },

    /** YAML: `clearDrag: ctx._over = null` */
    clearDrag: assign({ _dropTarget: () => null }),

    /** YAML: `insertRun + computeLabels + reconcile + persistRuns` */
    insertRun: assign(({ context, event }): Partial<PageOrderToolContext> => {
      if (event.type !== "CONFIRM_ADD") return {};
      const runs = insertRun(context.runs, event.run);
      const withLabels = computeLabels(context.leaves, runs);
      const { leaves, totals } = reconcile(withLabels, context.totals);
      return { runs, leaves, totals, addingRun: false };
    }),

    insertRunSideEffect: ({ context }) => {
      void context.services.persistRuns(context.projectId, context.runs);
    },

    /** YAML: `patchRun + computeLabels + reconcile` */
    patchRun: assign(({ context, event }): Partial<PageOrderToolContext> => {
      if (event.type !== "SET_STYLE" && event.type !== "SET_START") return {};
      const runs = patchRunById(context.runs, context.runEdit, event.patch);
      const withLabels = computeLabels(context.leaves, runs);
      const { leaves, totals } = reconcile(withLabels, context.totals);
      return { runs, leaves, totals };
    }),

    /** YAML: `mergeRunUp + computeLabels + reconcile + persistRuns` */
    mergeRunUp: assign(({ context }): Partial<PageOrderToolContext> => {
      const runs = removeRunMergingUp(context.runs, context.runEdit);
      const withLabels = computeLabels(context.leaves, runs);
      const { leaves, totals } = reconcile(withLabels, context.totals);
      return { runs, leaves, totals, runEdit: null };
    }),

    mergeRunUpSideEffect: ({ context }) => {
      void context.services.persistRuns(context.projectId, context.runs);
    },

    /** YAML: `assignRunEdit: ctx.runEdit = event.runId` */
    assignRunEdit: assign({
      runEdit: ({ event }) => {
        if (event.type !== "EDIT_RUN") return null;
        return event.runId;
      },
    }),

    /** YAML: `clearRunEdit + persistRuns` */
    clearRunEditAndPersist: assign({ runEdit: () => null }),

    clearRunEditSideEffect: ({ context }) => {
      void context.services.persistRuns(context.projectId, context.runs);
    },

    /** YAML: `patchNaming + persistNaming` */
    patchNaming: assign(({ context, event }): Partial<PageOrderToolContext> => {
      if (event.type !== "SET_NAME_PART") return {};
      const naming: NamingScheme = {
        parts: context.naming?.parts ?? {
          seq: true,
          type: false,
          folio: false,
        },
        digits: context.naming?.digits ?? 4,
        ...event.patch,
      };
      return { naming };
    }),

    patchNamingSideEffect: ({ context }) => {
      if (!context.naming) return;
      void context.services.persistNaming(context.projectId, context.naming);
    },

    /**
     * YAML: `assignError: ctx.error = event.error`
     * DIVERGENCE #3 params pattern.
     */
    assignError: assign(
      (_args, params: { error: unknown }): Partial<PageOrderToolContext> => {
        let msg: string;
        if (params.error instanceof Error) {
          msg = params.error.message;
        } else if (typeof params.error === "string") {
          msg = params.error;
        } else {
          msg = "Unknown error";
        }
        return { error: { message: msg } };
      },
    ),

    /**
     * YAML: `emitOrderChanged` — notify pipelineShell that page order changed
     * so it can fan-out UPSTREAM_CHANGED to all downstream stage runners.
     * No-op at F5; at I1 pipelineShell orchestrates the fan-out.
     * See DIVERGENCES.md §F5.4-emitOrderChanged.
     */
    emitOrderChanged: () => {
      /* At I1: send ORDER_CHANGED to the parent pipelineShell actor */
    },

    /** YAML: `emitResolved` — notify parent stageRunner (no-op at F5) */
    emitResolved: () => {
      /* At I1: send RESOLVE to the parent stageRunner actor */
    },
  },
}).createMachine({
  id: "pageOrderTool",
  initial: "readingFolios",

  context: ({
    input,
  }: {
    input: PageOrderToolInput;
  }): PageOrderToolContext => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    partialLeaves: [],
    leaves: [],
    runs: [],
    totals: null,
    lens: "all",
    view: "table",
    selectedLeaf: null,
    selScans: [],
    openDropdown: null,
    runEdit: null,
    addingRun: false,
    naming: null,
    error: null,
    _dropTarget: null,
  }),

  states: {
    // -------------------------------------------------------------------------
    // readingFolios — accumulates FOLIO_PUSH events until FOLIOS_DONE
    // -------------------------------------------------------------------------
    readingFolios: {
      on: {
        FOLIO_PUSH: { actions: ["mergeFolio"] },
        FOLIOS_DONE: {
          target: "workspace",
          actions: {
            type: "assignModelAndCompute",
            params: ({ event }) => ({
              leaves: event.leaves,
              runs: event.runs,
              totals: event.totals,
            }),
          },
        },
      },
    },

    // -------------------------------------------------------------------------
    // workspace — parallel: ledger × inspector × runs
    // -------------------------------------------------------------------------
    workspace: {
      type: "parallel",
      on: {
        CONFIRM_ADVANCE: {
          target: "confirming",
          guard: "sequenceClean",
        },
        // Naming is workspace-level per F5.4-1 divergence
        SET_NAME_PART: {
          actions: ["patchNaming", "patchNamingSideEffect"],
        },
        // Naming manifest received from backend — update prefix on each leaf
        MANIFEST_PUSH: { actions: ["assignPrefixes"] },
      },
      states: {
        // ---- Region: ledger --------------------------------------------------
        ledger: {
          initial: "browsing",
          on: {
            SET_LENS: { actions: ["assignLens"] },
            SET_VIEW: { actions: ["assignView"] },
          },
          states: {
            browsing: {
              on: {
                SELECT_LEAF: { actions: ["assignSelectedLeaf"] },
                TOGGLE_SCAN: { actions: ["toggleScanSelection"] },
                OPEN_DROPDOWN: { actions: ["assignDropdown"] },
                SET_ROLE: {
                  actions: ["patchLeafRole", "patchLeafRoleSideEffect"],
                },
                SET_RUN: {
                  actions: ["patchLeafRun", "patchLeafRunSideEffect"],
                },
                DRAG_START: {
                  target: "reordering",
                  guard: "reorderable",
                },
              },
            },
            reordering: {
              on: {
                DRAG_OVER: { actions: ["assignDropTarget"] },
                DROP: {
                  target: "browsing",
                  actions: [
                    "moveLeaves",
                    "moveLeavesSideEffect",
                    "emitOrderChanged",
                  ],
                },
                DRAG_CANCEL: {
                  target: "browsing",
                  actions: ["clearDrag"],
                },
              },
            },
          },
        },

        // ---- Region: inspector -----------------------------------------------
        inspector: {
          initial: "closed",
          states: {
            closed: {
              on: {
                // F5.4-2 divergence: react to SELECT_LEAF directly (not LEAF_SELECTED)
                SELECT_LEAF: { target: "open" },
              },
            },
            open: {
              on: {
                OVERRIDE_FOLIO: {
                  actions: ["patchLeaf", "patchLeafSideEffect"],
                },
                SET_PLATE_TAG: {
                  actions: ["patchLeaf", "patchLeafSideEffect"],
                },
                EDIT_FOLDOUT: {
                  actions: ["patchLeaf", "patchLeafSideEffect"],
                },
                OPEN_SCAN: {
                  // side-effect: open full-res scan (no-op at F5)
                },
                CLOSE_INSPECTOR: {
                  target: "closed",
                  actions: ["clearSelectedLeaf"],
                },
              },
            },
          },
        },

        // ---- Region: runs ---------------------------------------------------
        runs: {
          initial: "idle",
          states: {
            idle: {
              on: {
                ADD_RUN: { target: "adding" },
                EDIT_RUN: {
                  target: "editing",
                  actions: ["assignRunEdit"],
                },
              },
            },
            adding: {
              on: {
                CONFIRM_ADD: {
                  target: "idle",
                  actions: ["insertRun", "insertRunSideEffect"],
                },
                CANCEL: { target: "idle" },
              },
            },
            editing: {
              on: {
                SET_STYLE: { actions: ["patchRun"] },
                SET_START: { actions: ["patchRun"] },
                REMOVE_RUN: {
                  target: "idle",
                  actions: ["mergeRunUp", "mergeRunUpSideEffect"],
                },
                DONE: {
                  target: "idle",
                  actions: ["clearRunEditAndPersist", "clearRunEditSideEffect"],
                },
              },
            },
          },
        },
      },
    },

    // -------------------------------------------------------------------------
    // confirming — invoke confirmStage service
    // -------------------------------------------------------------------------
    confirming: {
      invoke: {
        src: "confirmStage",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "settled",
          actions: ["emitResolved"],
        },
        onError: {
          target: "workspace",
          actions: {
            type: "assignError",
            params: ({ event }) => ({ error: event.error }),
          },
        },
      },
    },

    // -------------------------------------------------------------------------
    // settled — order, numbering, and names locked
    // -------------------------------------------------------------------------
    settled: {
      on: {
        UPSTREAM_CHANGED: { target: "readingFolios" },
      },
    },
  },
});
