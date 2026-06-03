# 06 — Deployment

Spec 09 lays out three shapes. This doc tracks what's actually shippable today
vs what still needs work.

## Local — `pgdp-prep`

**Status:** ✅ shippable.

```sh
curl -sSL https://raw.githubusercontent.com/pdomain/pdomain-prep-for-pgdp/main/install.sh | sh
pgdp-prep
```

`install.sh`:

1. Install `uv` if missing.
2. Detect NVIDIA via `nvidia-smi`; if found, set `EXTRA_INDEX` to the right
   PyTorch CUDA wheel index and add the `[cuda]` extra.
3. Resolve the latest GitHub tag from the `tags` API.
4. Look up the GitHub Release for that tag, find the `.whl` asset attached
   to it (uploaded by `.github/workflows/release.yml`), download it to a
   temp dir.
5. `uv tool install --reinstall <wheel-path>[cuda]`.

Step 4 is what removes the historical Node/npm requirement: the wheel
already contains the built React SPA, so the user never builds the
frontend. If the release has no wheel asset (workflow failure, or an old
tag from before this was wired up), install.sh hard-fails with a pointer
to the release URL rather than silently falling back to a `git+...`
install (which would require Node).

Defaults at startup (no env vars set):

| Setting | Default |
|---|---|
| `host` / `port` | `127.0.0.1:8765` |
| `data_root` | `~/pgdp-projects` |
| `storage_backend` | `filesystem` |
| `database_url` | `sqlite:///~/pgdp-projects/state.db` |
| `auth_mode` | `none` |
| `gpu_backend` | auto-detect (`local` if cupy importable, else `mps` on macOS arm64, else `cpu`) |
| `dispatch_interval_seconds` | `0` (immediate) |
| `stage_write_pool_size` | `min(cpu_count(), 4)` (canonical spec Q8) |
| `stage_write_queue_cap` | `4 × stage_write_pool_size` (canonical spec Q8) |
| `reconcile_interval_seconds` | `1800` (30 min) — periodic dual-write reconciler |

`__main__.py` opens a browser tab on start unless `--no-browser` is passed.

### Disk-cost implication of every-intermediate stage persistence

Per `docs/specs/pipeline-task-model.md` Q3 (locked), every stage of every
page persists its output to disk on every run — roughly **16× source-page
footprint per page**. A 500-page book at 2 MB/source-page is ~16 GB of
stage artifacts under `~/pgdp-projects/<id>/pages/`. Configure
`PGDP_DATA_ROOT` accordingly.

The `pgdp-prep reindex <project_id>` CLI walks the page tree and the
`page_stages` DB rows, reporting drift; `--heal` deletes orphan files
and marks DB rows whose file is missing as `failed`. Run it after a
process crash or manual file moves.

## Self-hosted

**Status:** ✅ shippable for filesystem + SQLite + apikey. Postgres is deferred.

Same wheel; flip env vars:

```sh
PGDP_HOST=0.0.0.0
PGDP_DATA_ROOT=/var/lib/pgdp
PGDP_AUTH_MODE=apikey
PGDP_API_KEY=...
# optional: PGDP_STORAGE_BACKEND=s3 + S3_DATA_BUCKET=...
# optional: PGDP_GPU_BACKEND=modal + MODAL_TOKEN_ID=... MODAL_TOKEN_SECRET=...
```

Recommended: systemd unit + Caddy/nginx for TLS. The team-of-five default
reads from one shared Postgres + one shared GPU box (or Modal for burst).

## Managed (Fargate + Modal)

**Status:** 🟡 scaffolded, not yet end-to-end.

What's working:

- `Dockerfile` builds a CPU-only Python 3.13 image with `[s3,postgres,modal,jwt]`
  extras. Frontend SPA copied in from a Node build stage. ~150 MB image.
- Bootstrap selects S3 + Postgres (when implemented) + JWT + Modal at
  startup based on env vars.
- `BatchDispatcher` flushes every 5 minutes by default; managed-mode jobs
  enter `scheduled` status until the next flush.
- `ModalBackend` looks up deployed Modal Functions by name and dispatches
  via `.remote.aio()`. Wire shape verified by 3 TDD tests against a fake
  `modal` module.

What still needs work:

All cloud/remote-mode follow-ups are parked under roadmap "Deferred —
remote / cloud mode" while local-first lands:

- **`modal_app.py` function bodies** — `process_page` / `run_ocr` /
  `run_batch` raise `NotImplementedError` (roadmap §D1).
- **Postgres adapter** — scaffold shipped (commit `77072c6`); live-DB
  integration tests deferred (roadmap §D2).
- **Container publication** — GitHub Actions does not publish a container
  image; managed-mode container publication remains deferred (roadmap §D4).
- **install.sh end-to-end** has never been exercised against a clean
  shell with internet (roadmap §D3).

Cost estimate (per spec 09): with 100 books/month, ~$70/month total. Modal
GPU charges are ~$2/book; rest is Fargate (~$10) + Aurora (~$45) + S3 (~$5).

## CI

Two workflows:

| Workflow | When | Job | What |
|---|---|---|---|
| `.github/workflows/ci.yml` | every push + PR | `ci` | `make ci AI=1` — setup + frontend-install + pre-commit + openapi-export + frontend-build + pytest + frontend-format-check + frontend-lint + vitest |
| `.github/workflows/release.yml` | workflow dispatch from `make release-patch`, `make release-minor`, or `make release-major` | `release-ci` | checks out the exact tag and runs `make ci-slow` |
| `.github/workflows/release.yml` | workflow dispatch after `release-ci` | `publish` | builds the wheel, creates the GitHub Release asset, and dispatches `pdomain/pdomain-index-pip`; scheduled index regen is the fallback |

Tag pushes alone are not the supported release path. GitHub Actions does not
publish a container image for this repo.

## Frontend bundling

Spec 09 — the SPA lives inside the Python wheel:

1. `vite build` writes to `frontend/dist/`.
2. CI copies that into `src/pdomain_prep_for_pgdp/static/`.
3. `pyproject.toml`'s `[tool.hatch.build.targets.wheel.force-include]`
   bundles it into the wheel under `pdomain_prep_for_pgdp/static/`.
4. At runtime `bootstrap._mount_static_frontend` mounts that directory at
   `/`. `index.html` loads `/env.js` first (FastAPI-served, see backend doc).

The dev workflow is different: `pgdp-prep --frontend-dev http://localhost:5173`
keeps the FastAPI process from mounting the static SPA, so Vite's dev server
on port 5173 owns `/` while FastAPI owns `/api/*` and `/cdn/*`.

## What's not deployed yet

All parked under roadmap "Deferred — remote / cloud mode":

- **Modal app deploy** — the user runs `modal deploy
  src/pdomain_prep_for_pgdp/adapters/gpu/modal_app.py` themselves; CI doesn't (§D1).
- **install.sh end-to-end exercise** — `install.sh` carries the same latent
  wheel-METADATA bug pre-fixed in `pdomain-ocr-cli`; fix before exercising the
  curl-pipe-sh path (AD-10, §D3).
- **Container publication** — GitHub Actions does not publish container images
  for this repo; managed-mode container publishing remains deferred (§D4).
