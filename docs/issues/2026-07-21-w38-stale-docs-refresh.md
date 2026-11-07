---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Stale architecture docs: GPU claim, statechart routes, book-tools pin (W3.8)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Low — misleads agents and humans; not a runtime defect
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** editing architecture docs, GPU registry, book-tools pins, or Wave 3 doc hygiene.
- **Search terms:** 03-pipeline GPU, statechart-convergence-notes, pdomain-book-tools 0.17, pin 0.21, missing routes,
  W3.8
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Some architecture notes still lag the shipped code. `statechart-convergence-notes.md`
open questions describe a **0.17.1** book-tools pin missing denoise/dewarp
APIs though `pyproject.toml` requires **`pdomain-book-tools>=0.21.0`**; design
statecharts document cancel and other routes that are missing or soft-failed
(W3.6). Agents that trust docs alone will make wrong sequencing decisions.

The 2026-11-07 consolidation corrected the pipeline and roadmap CPU-only claims.
It also retired the July review-fixes plan: its original frontend route/auth correction shipped in `29f60ca`.
The older evidence below remains historical. This issue stays open for the remaining statechart/pin claims
and the broader per-stage region-editing verification requested by `04-frontend.md`.

## Impact

- Implementers skip GPU work or re-implement pins already bumped.
- Cancel/route work rediscovers soft-fail FE instead of reading code.
- Docgraph “built/verified” dates (2026-07-14) overstate freshness.

## Environment / versions

```
docs: docs/architecture/03-pipeline.md
      docs/architecture/statechart-convergence-notes.md
pin:  pyproject.toml pdomain-book-tools>=0.21.0
code: core/pipeline/stage_registry.py V2_STAGE_IMPL + GPU entries
```

## Evidence

### 1. GPU claim vs registry

```
# docs/architecture/03-pipeline.md ~91–95
A GPU fast path is not yet shipped: every `STAGE_IMPL[stage_id]` only has a
"cpu" entry today. A "cuda" device key … is parked under roadmap §D5 …
```

```
# stage_registry.py (GPU section ~1423+)
# GPU-capable stages (book-tools 0.19.0 — full single island):
# … threshold, deskew, denoise, dewarp, post_transform_crop, …
```

Registry builds `"gpu"` keys and maps `"cuda"` → `"gpu"` in `get_stage_impl`.

### 2. Book-tools pin notes vs pyproject

```
# statechart-convergence-notes.md ~277–287
the pinned 0.17.1 wheel lacks both `denoise_binary` and the
`geometry_correction` package). Until CT cuts a book-tools release
`>=0.18` and bumps the pin …
```

```
# pyproject.toml
"pdomain-book-tools>=0.21.0",
"pdomain-ops>=0.11.2",
```

Open question is obsolete; denoise/dewarp are no longer blocked on an unreleased
0.18 cut from this pin’s perspective.

### 3. Missing / phantom routes in design docs

Statecharts still specify `POST …/stages/:stageId/cancel` (see W3.6 evidence).
Pipeline completion plan also notes phantom `text_review/clean` doc references
(Wave 0 attestation work) and v1 micro-stage tables elsewhere in architecture.

### 4. Parent plan W3.8

“Refresh stale docs: 03-pipeline GPU claim, statechart missing-routes,
book-tools pin notes | Doc matches code; docgraph check clean.”

## Root-cause hypotheses

1. **(Most likely) Docs frozen at convergence ship (2026-06/07)** while
   registry GPU entries and dependency bumps landed later without doc reverify.
2. **Multiple doc owners** — pipeline vs statechart notes vs pin process
   (`update-pdomain-deps`) updated independently.

## Defects to fix

1. **Resolved 2026-11-07:** the pipeline GPU section now links the supported stages and CPU/GPU limits.
2. **Retire or rewrite book-tools 0.17 open question** against `>=0.21.0`.
3. **Annotate missing-route statechart claims** (cancel, etc.) or point to
   DIVERGENCES / issues.
4. **Bump Last verified** + docgraph reindex/check.

## Next steps

1. Diff architecture claims against `stage_registry.py` and `pyproject.toml`.
2. Patch the three surfaces; leave product gaps as links to issues, not as
   outdated absolutes.
3. `docgraph reindex` + `docgraph check --strict`.

## What is NOT broken

- Runtime GPU optional path does not depend on the stale sentence.
- Code pin already satisfies denoise/dewarp API availability relative to 0.17 notes.
- The original July frontend route/auth correction shipped. Broader region-editing verification remains here.

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link doc
commits, route retirement through `doc-retirer`.
