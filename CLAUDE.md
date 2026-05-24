# CLAUDE — pd-prep-for-pgdp

Web app that converts a folder/zip of scanned book images into a PGDP-ready
submission package. Single Python wheel ships everywhere — solo proofer on a
laptop, small-team self-hosted, or hosted multi-tenant.

Architecture: `specs/00-overview.md`. Full spec set (`specs/00`–`specs/09`)
is the **source of truth**; it encodes an already-applied refactor proposal
(`specs/REFACTOR-PROPOSAL.md`) — treat 00–09 as canonical and the proposal
as historical context.

## Quick orientation

- **Backend:** FastAPI + uvicorn, Python 3.13. `src/pd_prep_for_pgdp/`.
- **Frontend:** React 19 + Vite + TS + TanStack Query + Konva + Tailwind. `frontend/`.
- **Pipeline core:** `src/pd_prep_for_pgdp/core/` — mode-agnostic, used by every adapter.
- **Adapters:** `src/pd_prep_for_pgdp/adapters/` — `IStorage` (filesystem/S3),
  `IDatabase` (SQLite/Postgres), `IAuth` (none/apikey/jwt), `GPUBackend`
  (cpu/local/modal/shared_container). Selected at startup by `Settings`.
- **OCR:** `core/ocr.py` mirrors `pd-ocr-cli`'s flow verbatim: load DocTR
  predictor (process-singleton) → load layout detector → run page →
  `page.reorganize_page(layout=...)` → optional `validate_word_preservation`.
  Canonical reference: `pd-ocr-cli/pd_ocr_cli/ocr_to_txt.py:307-540`.
- **Pipeline steps:** spec 02. Step IDs: 0/1/2 ingest, 4 process page,
  4.5 illustrations, 6 OCR crop, 7 OCR, 8 text post-process, 10 package.

## Commands

```sh
make ci AI=1        # full CI — always run before committing
make test AI=1      # canonical — `uv run pytest tests/ -v --ignore=tests/e2e`
make e2e AI=1       # Playwright e2e suite (separate uv group)
make run            # builds SPA bundle, then launches pgdp-prep at http://127.0.0.1:8765
make run-cpu        # same, forces PGDP_GPU_BACKEND=cpu

# local-dev workflow (spec #362) — reference implementation; see ../docs/process/local-dev.md
make local-setup        # clone any missing sibling pd-* repos
make local-dev          # switch to local-dev mode (Python + npm siblings editable + marker)
make local-check        # print local-dev mode + per-sibling resolution
make local-upgrade-deps # upgrade deps then restore editables (local-mode only)
make local-install      # uv tool install --editable . with editable siblings (local-mode only)
make local-uninstall    # uv tool uninstall pgdp-prep
make local-run          # run pgdp-prep against local-dev workspace (local-mode only)
```

Legacy `dev-local`, `install-local`, `uninstall-local`,
`check-local-editable`, `upgrade-deps-local`, `run-local` are kept as
deprecation aliases.

`AI=1` captures verbose output to `.ci-ai.log`; stdout shows `✅` on pass or
filtered failure sections on error. Remove `AI=1` only if you need full verbose
output for debugging.

Local dev with hot-reload (two-process):

```sh
make frontend-dev    # one terminal — Vite on :5173
uv run pgdp-prep --reload --frontend-dev http://localhost:5173   # other — :8765
```

Project has its own `.venv/` (provisioned by `make setup` via `uv`).
Targeted runs: `uv run pytest -k <pattern>`.

## Rules

- Always run `make ci AI=1` before committing.
- Make targets first; fall back to `uv run …` only when no target exists.
- Never `python -m pytest`. Always `uv run pytest` or `make test`.
  Bare `python`/`python3`/`.venv/bin/python` miss the venv.

## Test conventions

- **TDD-first** for pure-function additions (resolver, prefix, packaging
  manifests, scannos, etc). Test with concrete expected output, then the
  implementation. Pattern: `tests/test_text_postprocess.py`.
- **Stub-shaped work** (route stubs, adapter Protocols) is exempt — just write the stub.
- **Pipeline modules** that depend on cv2 / pd-book-tools get integration-shaped
  tests on synthetic inputs (e.g. `test_process_page.py`'s black-on-white
  round-trip through Step 4).

## Decisions (locked 2026-05-07 — details in linked specs)

- **Pipeline task-model refactor:** per-page stage DAG + dirty propagation +
  splits-as-sibling-pages. No new `JobType.batch_*` values; no new sub-steps
  in `core/pipeline/process_page.py` monolith. Spec:
  `docs/specs/pipeline-task-model.md`.
- **Dual-write contract:** every stage write = transaction across on-disk
  artifact + `page_stages` DB row. `pgdp-prep reindex` is source-of-truth
  arbiter. Never bypass.
- **Splits = sibling pages:** split produces N new sibling `Page` rows with
  `parent_page_id` / `source_crop_bbox` / `split_index` / `split_at_stage`.
  Not config on `ocr_crop`.
- **Local-first:** active work = SQLite + filesystem + CPU. Cloud/remote
  items parked in `docs/plans/roadmap.md §Deferred`.
- `pd-book-tools` pinned to `v0.9.0`. Upgrade: `make upgrade-pd-book-tools`.
- `gpu_backend="cpu"` is the test default. `LocalBackend` subclasses
  `CpuBackend`; Modal/SharedContainer require real config.
- `make build` runs `frontend-build` first so the wheel ships with the SPA bundle.
- Data API: every route filters by `user.user_id`; flipping `auth_mode`
  `none`→`jwt` is multi-user-safe.

## Sibling repos

In `/workspaces/ocr-container/` (when present):

- `pd-book-tools/` — shared OCR/geometry/image-processing primitives.
- `pd-ocr-cli/` — the `install.sh` + uv-tool pattern this repo mirrors.
- `pd-ocr-labeler/` — separate labeler UI (DocTR labels).
- `pd-ocr-trainer/` — DocTR training, out of scope here.

## GH issues

Cross-cut work tasks are tracked as GH issues in
**`ConcaveTrillion/ocr-container-meta`** (not in this repo's own tracker).
Plans under `docs/plans/` in the workspace root are synced there
via `/decompose-spec --sync`. Milestone naming: `spec: <plan-basename> (#N)`.

When shipping a plan task:

- Before starting: `gh issue view <N> --repo ConcaveTrillion/ocr-container-meta`
- After completing: `gh issue close <N> --repo ConcaveTrillion/ocr-container-meta`
- List open tasks:
  `gh issue list --repo ConcaveTrillion/ocr-container-meta --milestone "spec: <name> (#N)" --state open`

## docs/ folder

This repo follows the workspace docs/ template — see [`docs/README.md`](docs/README.md). Active
folders: `architecture/`, `decisions/`, `plans/`, `process/`, `research/`,
`runbooks/`, `specs/`, `templates/`, `usage/`, plus parallel `archive/`
subfolders.

**Superpowers redirect.** When a superpowers skill (e.g. `brainstorming`,
`writing-plans`) instructs you to save to `docs/superpowers/specs/<file>.md`
or `docs/superpowers/plans/<file>.md`, save to `docs/specs/<file>.md` or
`docs/plans/<file>.md` instead. There is no `docs/superpowers/` subdirectory
in this repo.

<!-- workspace-process:start -->

## Before coding

These steps are workspace defaults for any coding task. **User-level settings
override them** — a user's own `~/.claude/CLAUDE.md`, `settings.json`, or a
direct instruction in the conversation takes precedence and may waive or
change any step below.

### Working principles

- **Use skills.** Invoke the relevant superpowers skill before starting —
  process skills first (`brainstorming`, `systematic-debugging`,
  `writing-plans`, `test-driven-development`), then implementation skills.
  If a skill applies, using it is not optional.
- **Delegate by default.** Dispatch subagents for non-trivial work: per-repo
  agents for repo changes, `Explore` for code searches. This keeps large tool
  output out of the parent context.
- **Parallelize.** Run independent tasks as concurrent subagents — multiple
  agent calls in a single message. Set `model: sonnet` on implementers and
  reviewers.

### Steps

1. **Check the working tree.** `git status --short`. Surface or resolve stray
   uncommitted work before starting — don't build on it.
2. **Read repo guidance.** This repo's `CLAUDE.md` and `CONVENTIONS.md` for
   repo-specific rules.
3. **Consult `docs/` for authoritative context** (whichever folders exist):
   `plans/` (the work plan), `specs/` (design specs — follow any `Spec:`
   pointer from the issue), `research/` (prior investigations), `decisions/`
   (ADRs / constraints), `architecture/` (shipped design).
4. **Check live issue status.** `gh issue view <N> --repo <owner/repo>` —
   confirm it isn't already closed; note its milestone.
5. **Check for in-flight work.** Open PRs and existing branches touching the
   same area, to avoid colliding with work-in-progress.
6. **Consult agent memory.** `.claude/agent-memory/<repo>/feedback_*.md` for
   corrections not yet promoted to `CONVENTIONS.md`.
7. **Locate code with `Explore` first.** Use an `Explore` subagent to find
   relevant files before broad `Read`/grep.
8. **Isolate in a worktree.** Never work directly in the interactive checkout
   at `/workspaces/ocr-container/<repo>/`. Use the `using-git-worktrees` skill
   to set up an isolated worktree. When delegating to a full-power
   implementation agent, pass `isolation: "worktree"` on the `Agent` call
   (skip for `-docs` agents and the `driver` agent). When an agent returns a
   worktree path + branch, use the `finishing-a-development-branch` skill to
   decide how to integrate.
9. **TDD.** Write the failing test first where the plan calls for it.
10. **Verify before committing.** Focused verification plus `make ci`.
11. **Commit locally; do not push** without explicit say-so.

<!-- workspace-process:end -->
