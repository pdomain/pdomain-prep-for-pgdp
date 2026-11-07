# 08 — Roadmap

## Agent Index

- **Kind:** plan
- **Status:** active
- **Last verified:** 2026-11-07
- **Read when:** selecting open product or engineering work.
- **Search terms:** roadmap, open work, deferred work, priorities, pipeline completion.

> Shipped lifecycle records live in [migration decisions](../context/decisions.md). Locked architecture
> decisions live in [architecture decisions](../decisions/architecture-decisions.md). This file is the
> **forward** view of open work.

**Local-first priority (locked 2026-05-07 — see AD-4 in
`architecture/architecture-decisions.md`):** all P0 / P1 / P2 work below targets
the SQLite + filesystem + CPU shape. Cloud / remote items are parked
under "Deferred — remote / cloud mode" at the bottom.

**Reference for finished work:**

- Statechart convergence (2026-06-11) — 24-stage v2 registry, 28 XState v5
  machines, TOOL_REGISTRY, SSE channels wired, legacy surfaces removed. See
  [statechart convergence notes](../architecture/statechart-convergence-notes.md) and
  `docs/architecture/statechart-convergence-notes.md`.
- Pipeline task-model M1–M6 — fully shipped (see
  [migration decisions](../context/decisions.md)).
- §13a Radix primitives — fully shipped.
- §9a soft-delete / restore — shipped.
- §9a-followup Word-delete Undo UI — shipped (2026-05-22, server-side
  "Restore last delete" banner; strategy (a)).
- §13 search across pages — shipped (#76).
- §10 Konva rotate — shipped (#100).
- §P2.1 Konva Transformer flip — shipped (2026-05-22, feat/konva-flip): H-flip + V-flip
  in ModeToolbar "Flip" mode; PATCH `flip_horizontal`/`flip_vertical` + POST
  `manual_deskew_pre/run`; compose with rotate in CSS preview and pipeline.
- §P0.1 stale Re-process button — removed (#110, 2026-05-15).
- §P0.2 Download Package UI — shipped (#111, 2026-05-15).
- §P0.3 Folder upload — shipped (2026-05-16, client-side JSZip in create-project modal).
- §P1.1 Page reorder UI — shipped (2026-05-16, drag-and-drop in Pages tab).
- §P1.2 Crop/rotate review pass — shipped (2026-05-16, CropsGridPage canvas_map grid).
- §P3.1 compute_prefix frontmatter numbering — shipped (f001 start; 2026-05-16).
- Backend quality hardening (42 findings) — fully shipped (2026-05-16);
  see [migration decisions](../context/decisions.md).

---

## Active pipeline work (2026-07-21)

Historical P0–P3 UX tickets and the statechart/registry convergence are
shipped (see "Reference for finished work"). That does **not** mean a
proofer can finish a real book end-to-end on `make run` without further
engineering.

**Authoritative forward queue:**
[Pipeline completion review and continuation plan](2026-07-21-pipeline-completion-review.md)

Summary of remaining blockers (detail and evidence in that plan +
[docs/issues](../issues/README.md)):

- Wave 0 and Wave 1 shipped. Their current contracts are in
  [pipeline architecture](../architecture/03-pipeline.md#book-path-contracts).
- Wave 2 remains open: real shared image-review thumbnails, backend-aligned controls, canvas-map data,
  text-zone editing, and settings tiers beyond grayscale.
- Wave 3 remains open: browser CI, job recovery/cancellation, reindex repair, authentication hardening,
  broader documentation verification, OCR folios, and archive export.

## P0 — Daily-use blockers (historical)

Items that prevented a user from completing a real book end-to-end in
`make run` during the early rollout.

> Historical P0 UX tickets shipped. Live pipeline depth blockers moved to
> [completion plan](2026-07-21-pipeline-completion-review.md) Wave 0.

---

## P1 — UX completeness (historical)

> Historical P1 items shipped. See "Reference for finished work" above and
> [migration decisions](../context/decisions.md). Further hi-fi work is in
> the completion plan Waves 1–2.

---

## P2 — Polish / nice-to-have (historical)

> Historical P2 items shipped. See "Reference for finished work" above.

---

## P3 — Pipeline depth (historical)

> P3.1 (compute_prefix frontmatter) shipped — moved to "Reference for finished work".
> Remaining pipeline depth work is tracked in the
> [completion plan](2026-07-21-pipeline-completion-review.md).

---

## P5 — Stretch (post-daily-use)

### S1. PDF export

PGDP packages don't need PDFs, but some users want them as a
sanity-check artefact alongside the zip.

### S2. Multi-user permissions

Spec 00 §"stretch goal" says the architecture doesn't block
multi-user. Today every route filters by `user.user_id`. Needs an
"owner_id" filter on the page tagger that respects the JWT identity,
plus per-project sharing.

### S3. Internationalisation

The UI is English-only. The OCR pipeline is language-agnostic via
DocTR; the SPA strings would need an i18n layer.

---

## Deferred — remote / cloud mode

Revisit only after the local-mode flow above is end-to-end coherent.
None of these are in scope for daily-use rollout.

### D1. Remote GPU integration

Remote classes come from `pdomain_ops.gpu`; the old local Modal backend modules are removed.
Complete and verify remote artifact transport and local-store replacement before claiming managed readiness.

### D2. Postgres adapter — live-DB integration tests

The builder selects Postgres for configured URLs, but stage-related adapter methods remain incomplete.
A live Postgres test service and full database-contract coverage are still required.

### D3. install.sh end-to-end exercise

The installer expects a wheel from the latest GitHub release. This source audit did not exercise a clean-machine
installation or prove the historical wheel-METADATA defect remains. Keep an actual install test as deferred work.

### D4. Managed-mode container publication

Local release targets invoke release scripts. GitHub workflows were removed in `e22bdd2`;
this checkout has no automatic release/publish or container-publication workflow.
Managed container credentials and publication remain separate deferred work.

### D5. CUDA `STAGE_IMPL` entries

GPU registry implementations and CUDA dispatch already ship; see
[supported stages](../architecture/09-image-prep-settings.md#cpu-and-gpu-execution).
Representative-book GPU memory and throughput verification remains deferred.

### D6. Shared GPU container backend

`SharedContainerBackend` is a placeholder. Long-running
`pgdp-prep --mode gpu_worker_only` ECS task with per-tenant
authentication. Spec 09 §"Backend 2".

### D7. Thumbnail nvjpeg / DALI GPU path

Deferred per AD-9. CPU pool is the right default. Revisit only
after profiling on a real book (≥500 pages, GPU host) shows the
CPU path dominates after storage I/O.

---

## How to pick up

1. Read `docs/architecture/01-overview.md` for the high-level shape.
2. Read `docs/architecture/architecture-decisions.md` for the locked decisions.
3. Pick the lowest-numbered open item in this file. **Skip BLOCKED
   items unless you have a CT decision in writing.** Skip the
   "Deferred" section unless the user explicitly revives it.
4. TDD-first when possible; the test recipe is in `docs/architecture/07-testing.md`.
5. When you finish an item, **move it out** of this file into
   [migration decisions](../context/decisions.md) with a condensed summary and commit SHAs.


## Goal

Prioritize the repository's open product and engineering work while keeping shipped history out of the active queue.

## Architecture

Roadmap items extend the current local-first architecture documented in `docs/architecture/`; retired specs do not define new work.

## Tech Stack

The current FastAPI, Python 3.13, React 19, XState v5, SQLite/filesystem, and optional adapter stack applies.

## Global Constraints

Local-first work stays ahead of remote deployment, generated OpenAPI remains the contract, and removed fan-out paths must not return.
