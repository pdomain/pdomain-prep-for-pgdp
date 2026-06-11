/**
 * stageDeps.ts — stage dependency graph and downstream computation.
 *
 * W5.6: moved from `@/mocks/fixtures` so machines and non-mock code do not
 * import from the mock directory. `@/mocks/fixtures` re-exports from here
 * for test backward compatibility.
 *
 * The dependency graph encodes dirty propagation edges:
 * re-running stage X marks all reachable descendants stale.
 *
 * @see docs/specs/stage-registry-v2.md §2.1 "Upstream deps" column
 */

// ---------------------------------------------------------------------------
// Dependency graph
// Hand-transcribed from stage-registry-v2.md §2.1 "Upstream deps" column.
// ---------------------------------------------------------------------------

/** Adjacency map: stage → its direct upstream dependencies. */
export const STAGE_DEPS: Record<string, string[]> = {
  // Project-scoped
  source: [],
  page_order: ["source", "text_zones"], // cross-scope: text_zones all pages
  // Page-scoped
  grayscale: ["source"],
  crop: ["grayscale"],
  threshold: ["crop"],
  deskew: ["threshold"],
  denoise: ["deskew"],
  dewarp: ["denoise"],
  post_transform_crop: ["dewarp"],
  text_zones: ["post_transform_crop"],
  ocr: ["post_ocr_crop"],
  canvas_map: ["post_transform_crop"], // also blank_proof_synth alt (internal)
  post_ocr_crop: ["canvas_map"],
  wordcheck: ["ocr"],
  hyphen_join: ["wordcheck"],
  regex: ["hyphen_join"],
  text_review: ["hyphen_join", "regex"],
  illustrations: ["source"], // cross-scope: uses source thumbnail
  // Project-scoped tail
  validation: ["text_review", "illustrations", "page_order"],
  proof_pack: ["validation"],
  build_package: ["proof_pack"],
  zip: ["build_package"],
  submit_check: ["zip"],
  archive: ["submit_check"],
};

/**
 * Compute descendants of `stageId` (all transitively reachable stages
 * when `stageId` is re-run, i.e. stages that become stale).
 *
 * Uses the inverted graph: for each stage, which stages depend on it.
 *
 * This is pure logic — no side effects. Used by the shell to propagate
 * stale state and by tests to assert fan-out.
 */
export function computeDownstream(startStageId: string): string[] {
  // Build reverse adjacency (dependents of each stage)
  const dependents = new Map<string, string[]>();
  for (const [stage, deps] of Object.entries(STAGE_DEPS)) {
    for (const dep of deps) {
      const existing = dependents.get(dep) ?? [];
      existing.push(stage);
      dependents.set(dep, existing);
    }
  }

  // BFS from startStageId
  const visited = new Set<string>();
  const queue = [startStageId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return Array.from(visited);
}
