---
Status: active
Owner: CT
Created: 2026-11-09
Last verified: 2026-11-09
Kind: decision
---

# GitHub Issues cutover to repo docs

## Agent Index

- **Kind:** decision
- **Status:** active
- **Last verified:** 2026-11-09
- **Read when:** tracing a former GitHub issue number, filing new work, or checking what the cutover preserved.
- **Search terms:** GitHub issues cutover, migration, former GH, pd-ui design handoff, #152, issue ledger,
  delete issues.

Open work for this repository lives in repo docs, not GitHub Issues. Defects with evidence live in
[`docs/issues/`](../issues/README.md). Feature work lives in the [roadmap](../plans/roadmap.md). The ledger
below maps each of the 48 open GitHub issues to where its content went. Deleting them on GitHub waits for the
owner's go.

## Context

On 2026-11-09, `pdomain/pdomain-prep-for-pgdp` had 48 open and 131 closed GitHub issues:

- Four came from the 2026-05-22 deep code review: bugs #131, #132, #135 and chore #146.
- Spec issue #152 and its 43 `kind:feature` issues, #156–#198, came from the pd-ui design handoff.

The handoff plan and spec behind #152 had already been retired in `fdd88cd`, as superseded by the statechart
convergence. The issues stayed open on GitHub after that.

The pattern follows `../pdomain-ocr-cli/docs/decisions/2026-07-19-github-issues-cutover.md`: feature work goes
to the roadmap with `former GH #NNN` tags, defects go to governed issue reports, and GitHub keeps no copy.

## Decision

1. **Check each issue against the code before migrating it.** Every row below was checked at `14f0ba8`. Stale
   text was not copied; each destination records the current state.
2. **The four review findings become governed reports** in `docs/issues/`, one per issue.
3. **#152 and its 43 features go to the roadmap** under "Former pd-ui design handoff". Shipped and superseded
   items appear only in this ledger. Items with remaining work appear on the roadmap, either as new work or
   pointing at the existing W-item or intent-map entry that already tracks them.
4. **Do not file routine work on GitHub Issues.** If an issue arrives there, move it into the roadmap or a
   governed report.
5. **Delete the 48 migrated issues from GitHub only after the owner says go.** This document is committed and
   pushed first, so it is the record.
6. **Leave the 131 closed issues alone** unless the owner asks for an archive.

## Consequences

- Agents plan from the roadmap, the intent map, and `docs/issues/`. GitHub issue numbers are provenance only.
- After deletion, former issue URLs under `github.com/pdomain/pdomain-prep-for-pgdp/issues/N` stop resolving.
  Closed issues stay on GitHub until the owner decides otherwise.
- Cross-repo work still uses `ConcaveTrillion/ocr-container-meta`.

## Supersedes / Superseded-by

Supersedes GitHub Issues as the open-work tracker for this repository. It does not supersede the roadmap,
the intent map, or architecture docs.

## Migration ledger

### Review findings

| Former GH | Check at `14f0ba8` | Destination |
| --- | --- | --- |
| #131 Postgres adapter vs `IDatabase` | Still open: 8 methods missing, search raises, no fail-fast | [Postgres adapter issue](../issues/2026-11-09-postgres-adapter-incomplete.md); roadmap D2 links it |
| #132 Progress undoes cancellation | Still open: `update_progress` writes the stale running job; unzip still enqueues thumbnails | [Cancel overwrite issue](../issues/2026-11-09-progress-overwrites-cancel.md); related to W3.6 |
| #135 SSE bypasses bearer client | Narrowed: apikey mode fixed by session cookie `e0b83cf`; JWT mode still fails | [JWT SSE issue](../issues/2026-11-09-jwt-sse-auth.md) |
| #146 No dependency audit in CI | Still open: no audit step, no Dependabot or Renovate, no workflows | [Dependency audit issue](../issues/2026-11-09-dependency-audit-gate.md) |

### pd-ui design handoff

Spec issue #152 tracked these features. Its plan tasks 4–46 map to #156–#198 in order. Classes: **shipped** means the
capability exists; **partial** means some of it exists; **superseded** means the target no longer fits the
pipeline tool-slot model; **open** means not built. "Roadmap" means the
[roadmap section](../plans/roadmap.md#former-pd-ui-design-handoff-gh-152-156198).

| Former GH | Title | Class | Evidence or destination |
| --- | --- | --- | --- |
| #152 | Spec: pd-ui design handoff | superseded | Plan and spec retired in `fdd88cd`; roadmap section |
| #156 | Files tab: cards, toolbar, banner | shipped | `tools/SourceToolFiles.tsx` |
| #157 | Multi-select + BulkBar | shipped | `SourceToolFiles.tsx`, `SourceTool.tsx` |
| #158 | Insert dialog + role backend | shipped | `InsertDialog`; `POST /projects/{id}/pages/insert` |
| #159 | Per-page workbench + step settings | shipped | `tools/SourceToolWorkbench.tsx`, `SourceToolSettings.tsx` |
| #160 | Grayscale Overview + Pages | shipped | `tools/grayscale/GrayscaleOverview.tsx`, `GrayscalePages.tsx` |
| #161 | Grayscale Step Settings | shipped | `grayscale/GrayscaleSettings.tsx`, `GrayscalePipelineEditor.tsx` |
| #162 | Grayscale before/after viewer | shipped | `grayscale/GrayscaleWorkbench.tsx` |
| #163 | Crop grid refit | partial | `tools/PagesGridTool.tsx` flags and filters; density toggle not confirmed |
| #164 | Crop bulk re-run | partial | Generic stage re-run only; roadmap H2 |
| #165 | Inline crop bbox editor | partial | `PagesGridTool.tsx` editor; apply-to-all-flagged not confirmed |
| #166 | Crop Overview + Step Settings | partial | No overview tab; roadmap H2 |
| #167 | Manual drag-reorder | shipped | `tools/PageOrderTool.tsx`, `PATCH /pages/reorder` |
| #168 | Page-order stage | partial | `PageOrderTool.tsx` ledger; folio detection is roadmap H2 |
| #169 | Scannos pipeline stage | superseded | `wordcheck` is the stage; scanno tables run in text post-processing |
| #170 | Inline suspicion popover | superseded | `tools/WordcheckTool.tsx`, `TextReviewTool.tsx` |
| #171 | Per-book candidate triage | partial | Wordcheck accept and promotion routes; no separate candidate store |
| #172 | Global rule library | open | Roadmap H2 |
| #173 | Hyphen-join Overview | shipped | `tools/HyphenJoinTool.tsx` Overview tab |
| #174 | Hyphen-join Undecided + Queue | partial | Queue tab ships; n-gram evidence is roadmap H1 |
| #175 | Auto-joined validation | shipped | HyphenJoinTool Joined tab |
| #176 | Mismatch report | shipped | HyphenJoinTool Mismatch tab |
| #177 | Hyphen-join Step Settings | open | Placeholder tab; roadmap H1 and H2 |
| #178 | Hyphen-join page workbench | shipped | HyphenJoinTool workbench tab |
| #179 | Validation panel | shipped | `tools/ValidationTool.tsx` |
| #180 | Per-check auto-fix endpoints | open | Roadmap H1 |
| #181 | QualityBanner + flag taxonomy | superseded | Per-tool flags; StageStrip flagged state |
| #182 | PageThumb/PageRow flag pills | superseded | Per-tool grids |
| #183 | Stage-jump popover | open | Roadmap H1 |
| #184 | Workbench header + edit modes | superseded | Legacy PageWorkbench replaced by the pipeline shell |
| #185 | ArtifactViewer + overlays | partial | `components/ArtifactViewer.tsx`; split overlay is roadmap H2 |
| #186 | Per-stage controls drawer | superseded | Each tool has its own Settings tab |
| #187 | Right drawer, four panels | superseded | `components/workbench/PageDrawer.tsx` |
| #188 | Collapsible text review pane | superseded | `TextReviewTool.tsx`, `WordcheckTool.tsx` |
| #189 | text_zones labeling canvas | open | Placeholder canvas; roadmap H2 |
| #190 | Projects page split pane | shipped | `pages/projects/ProjectsPage.tsx` |
| #191 | Attributes panel | shipped | `attributesPanel` machine; `/projects/{id}/attributes/{section}` |
| #192 | First-time empty hero | shipped | `pages/projects/ProjectsEmpty.tsx` |
| #193 | Manage tab | partial | Archive, clean, delete ship; save a copy is roadmap H2 |
| #194 | Desktop upload modal | shipped | Create-project dialog in `ProjectsPage.tsx` |
| #195 | Mobile upload fallback | open | Roadmap H1 |
| #196 | `?stage=` routing | shipped | `/projects/:projectId/pipeline?stage=<id>` |
| #197 | Storybook parity demo | superseded | No Storybook; parity target does not fit the tool-slot model |
| #198 | pd-ui MIGRATION_NOTES | superseded | App uses only pd-ui shell, icons, primitives, and canvas |

Totals for #156–#198: 18 shipped, 9 partial, 10 superseded, 6 open.

The feature rows come from a source inspection, not a browser run. Rows marked "not confirmed" name details
the inspection did not reach.

## Migration manifest

```text
GITHUB ISSUE MIGRATION MANIFEST
  Repository: pdomain/pdomain-prep-for-pgdp
  Branch: worktree-docs-github-issue-migration (merged to master)
  Code checked at: 14f0ba8
  Open issues discovered: 48
  Governed issue reports created: 4 (#131, #132, #135, #146)
  Roadmap items: #152 and #156–#198 (new work in H1, pointers in H2)
  Closed issues: 131, left on GitHub
  GitHub issues deleted: 0 (awaiting owner go)
```
