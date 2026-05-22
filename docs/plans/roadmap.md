# 08 — Roadmap

> Shipped items live in `docs/archive/plans/roadmap-shipped.md`. Locked architecture
> decisions live in `architecture/architecture-decisions.md`. This file is the
> **forward** view of open work.

**Local-first priority (locked 2026-05-07 — see AD-4 in
`architecture/architecture-decisions.md`):** all P0 / P1 / P2 work below targets
the SQLite + filesystem + CPU shape. Cloud / remote items are parked
under "Deferred — remote / cloud mode" at the bottom.

**Reference for finished work:**

- Pipeline task-model M1–M6 — fully shipped (see
  `docs/archive/plans/roadmap-shipped.md` §P0.5).
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
  see `docs/archive/plans/2026-05-16-backend-quality-hardening.md`.

---

## P0 — Daily-use blockers

Items that prevent a user from completing a real book end-to-end in
`make run` today.

> All P0 items shipped. See "Reference for finished work" above.

---

## P1 — UX completeness

> All P1 items shipped. See "Reference for finished work" above and
> `docs/archive/plans/roadmap-shipped.md`.

---

## P2 — Polish / nice-to-have

> All P2 items shipped. See "Reference for finished work" above.

---

## P3 — Pipeline depth

> P3.1 (compute_prefix frontmatter) shipped — moved to "Reference for finished work".
> No remaining open P3 items.

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

### D1. Modal app S3 wiring

`src/pd_prep_for_pgdp/adapters/gpu/modal_app.py` — `process_page` /
`run_ocr` / `run_batch` raise `NotImplementedError`. Needs S3
storage config wiring + Modal-side function bodies + a real account
for end-to-end tests.

### D2. Postgres adapter — live-DB integration tests

Scaffold shipped (`adapters/database/postgres.py`); direct-class
tests `importorskip` psycopg cleanly. Reviving requires (1) a
Postgres service in the dev container, (2) a parametrised `db`
fixture factory yielding SQLite **or** Postgres, (3) deciding the
managed-mode default (currently empty `database_url` falls back to
SQLite).

### D3. install.sh end-to-end exercise

`install.sh` / `install.ps1` / `Makefile.install` are authored but
the curl-pipe-sh path has never been exercised in a clean shell.
Note: long-term strategy is the self-hosted PEP 503 index
(AD-10); fix the latent wheel-METADATA bug pre-fixed in pd-ocr-cli
before exercising.

### D4. CI container push

`.github/workflows/release.yml` builds the managed-mode container
on tag push but doesn't push to a registry. Wire ECR / GHCR creds.

### D5. CUDA `STAGE_IMPL` entries

Today every `STAGE_IMPL[stage_id]` only has a `"cpu"` entry. A
real GPU host would benefit from CUDA primitives for the
proofing-chain stages (`grayscale`, `threshold`,
`find_content_edges`, `auto_deskew`, `morph_fill`, `rescale`,
`canvas_map`) backed by `pd_book_tools.image_processing.cupy_processing`,
behind a `[cuda]` extra so the wheel install stays slim. Track as
a slice when the registry is the only call path (already true
post-M6).

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
   `docs/archive/plans/roadmap-shipped.md` with a condensed summary + commit SHAs.
