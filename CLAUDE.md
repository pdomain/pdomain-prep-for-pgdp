---
Kind: process
Status: active
Last verified: 2026-11-07
---

# CLAUDE — pdomain-prep-for-pgdp

Web app that converts a folder/zip of scanned book images into a PGDP-ready submission package.
The supported implementation is local-first: filesystem storage, SQLite, and per-stage CPU/GPU execution.
Remote adapters remain extension points with incomplete persistence and deployment paths.

Architecture starts at [`docs/architecture/01-overview.md`](docs/architecture/01-overview.md).
The former root `specs/00`–`specs/09` set described the initial design but diverged
from the shipped registry, statechart, API, and persistence models. Current
architecture, generated OpenAPI, code, and tests are authoritative.

## Quick orientation

- **Backend:** FastAPI + uvicorn, Python 3.13. `src/pdomain_prep_for_pgdp/`.
- **Frontend:** React 19 + Vite + TS + **XState v5** + TanStack Query + Konva + Tailwind. `frontend/`.
- **Pipeline core:** `src/pdomain_prep_for_pgdp/core/` — mode-agnostic, used by every adapter.
- **Adapters:** storage/database/auth wiring lives under `src/pdomain_prep_for_pgdp/adapters/`.
  GPU selection includes cpu/local/mps/modal/shared_container. Local stages use the registry;
  remote GPU dispatch classes come from `pdomain_ops.gpu`. Settings selects startup configuration.
- **OCR:** `core/ocr.py` loads cached DocTR predictors, runs OCR, optionally reorganizes layout and checks
  word preservation, and also supports Tesseract. That module is the current implementation reference.
- **Pipeline stages:** 24 v2 stages in `core/pipeline/stage_registry.py` (16
  page-scoped, 8 project-scoped). Canonical stage table and registry contract:
  [pipeline architecture](docs/architecture/03-pipeline.md). Older numbered
  step IDs are historical v1 references and are superseded.
  XState v5 machines and shared tool machines live in `frontend/src/machines/`; the
  registry of stage_id → React surface component is in
  `frontend/src/pages/pipeline/toolSlot.tsx` (`TOOL_REGISTRY`).

## Commands

```sh
make ci AI=1        # full CI — always run before committing
make test AI=1      # canonical — `uv run pytest tests/ -v --ignore=tests/e2e -n auto`
make e2e AI=1       # Playwright e2e suite (separate uv group)
make run            # rebuilds SPA if missing or stale, then launches pgdp-prep at http://127.0.0.1:8765
make run-cpu        # same, forces PGDP_GPU_BACKEND=cpu

# local-dev workflow (spec #362) — reference implementation; see ../docs/process/local-dev.md
make local-setup        # clone any missing sibling pdomain-* repos
make local-dev          # switch to local-dev mode (Python + npm siblings editable + marker)
make local-check        # print local-dev mode + per-sibling resolution
make local-upgrade-deps # upgrade deps then restore editables (local-mode only)
make local-install          # uv tool install --editable . with editable siblings (local-mode only)
make local-uninstall        # uv tool uninstall pgdp-prep
make local-run              # run pgdp-prep against local-dev workspace (local-mode only)
make local-setup-py         # re-apply editable Python siblings (idempotent; called by local-run)
make local-frontend-install # pnpm install + restore pnpm link overlay for @pdomain/pdomain-ui
make local-frontend-build   # Vite build using local-linked pdomain-ui (called by local-run)

# sibling-dep refresh (spec #363) — see ../docs/process/update-pdomain-deps.md
make update-pdomain-deps     # bump pdomain-* sibling deps to registry latest; leaves diff for review
```

Legacy `dev-local`, `install-local`, `uninstall-local`,
`check-local-editable`, `upgrade-deps-local`, `run-local` are kept as
deprecation aliases.
Legacy `upgrade-pdomain-book-tools` delegates to `update-pdomain-deps`.

`AI=1` captures verbose output to `.ci-ai.log`; stdout shows `✅` on pass or
filtered failure sections on error. Remove `AI=1` only if you need full verbose
output for debugging.

Local dev with hot-reload (two-process):

```sh
make frontend-dev    # one terminal — Vite on :5173
uv run pgdp-prep --reload --frontend-dev http://localhost:5173   # other — :8765
```

The environment is `.venv/` by default, or `UV_PROJECT_ENVIRONMENT` when set. `make setup` syncs it through uv.
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
- **Pipeline modules** that depend on cv2 / pdomain-book-tools get integration-shaped
  tests on synthetic inputs (e.g. `test_process_page.py`'s black-on-white
  round-trip through Step 4).

## Decisions (locked 2026-05-07 — details in linked specs)

- **Pipeline task-model refactor:** per-page stage DAG + dirty propagation +
  splits-as-sibling-pages. No new `JobType.batch_*` values; no new sub-steps
  in `core/pipeline/process_page.py` monolith. Spec:
  [pipeline architecture](docs/architecture/03-pipeline.md).
- **Dual-write contract:** every stage write = transaction across on-disk
  artifact + `page_stages` DB row. `pgdp-prep reindex` is source-of-truth
  arbiter. Never bypass.
- **Splits = sibling pages:** split produces N new sibling `Page` rows with
  `parent_page_id` / `source_crop_bbox` / `split_index` / `split_at_stage`.
  Not config on `ocr_crop`.
- **Local-first:** active work = SQLite + filesystem + CPU. Cloud/remote
  items parked in `docs/plans/roadmap.md §Deferred`.
- Current dependency minimums are `pdomain-book-tools>=0.28.0` and `pdomain-ops>=0.11.2`, from pdomain-index-pip.
  `make local-dev` installs editable siblings; `make update-pdomain-deps` refreshes registry constraints.
- `gpu_backend="cpu"` is the test default. Local/cpu/mps startup uses `_NoOpGPUBackend` for compatibility;
  page stages execute through the registry. Remote modes require real configuration.
- `make build` runs `frontend-build` first so the wheel ships with the SPA bundle.
- Authentication selection exists, but managed multi-tenant deployment remains deferred.
  Page services use per-project local event stores.

## Sibling repos

In `/workspaces/ocr-container/` (when present):

- `pdomain-book-tools/` — shared OCR/geometry/image-processing primitives.
- `pdomain-ocr-cli/` — the `install.sh` + uv-tool pattern this repo mirrors.
- `pdomain-ocr-labeler/` — separate labeler UI (DocTR labels).
- `pdomain-ocr-trainer/` — DocTR training, out of scope here.

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
- **Write clearly.** Follow `docs/process/writing-style.md` for direct user
  updates, handoffs, final summaries, docs, reports, issue text, PR text, and
  user-facing copy. Keep agent communication short, clear, and easy to scan.
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
