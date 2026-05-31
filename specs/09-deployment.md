# Spec 09 — Deployment

Three deployment shapes, one codebase. The mode is selected at startup by env
var; nothing in the pipeline cares which it is.

| Shape | Target user | GPU | Storage | DB | Auth | Hosting cost |
|---|---|---|---|---|---|---|
| **Local** | Solo proofer on a laptop | local CUDA or CPU | filesystem | SQLite | none | $0 |
| **Self-hosted** | Small team on a single server | local CUDA or Modal | filesystem or S3 | SQLite or Postgres | API key | one VM |
| **Managed** | Hosted offering for many users | Modal or shared GPU container | S3 | Postgres | JWT | <$10/mo + GPU usage |

The whole app installs as **one Python wheel**: a single FastAPI process serves
the React SPA, the data API (`/api/data`), the GPU API (`/api/gpu`), and (in
local mode) image files via `/cdn`. Frontend is built once in CI and bundled
into the wheel as a static asset directory.

---

## Local

Installed as a `uv tool` via a one-line curl-piped script. Same pattern as
`pdomain-ocr-cli`: the script installs `uv` if missing, detects an NVIDIA GPU via
`nvidia-smi`, picks the matching PyTorch wheel index, and runs
`uv tool install` against the latest GitHub tag.

### Disk-cost callout (every-intermediate stage persistence)

Per `docs/specs/pipeline-task-model.md` Q3 (locked), every stage of every
page persists its output to disk on every run. This is roughly **16×
source-page footprint per page** at typical proof sizes. A 500-page book
at 2 MB/source-page expands to ~16 GB of stage artifacts. Configure
`PGDP_DATA_ROOT` accordingly.

The `pgdp-prep reindex <project_id>` CLI walks the page tree and the
`page_stages` DB rows, reporting drift; `--heal` deletes orphan files
and marks DB rows whose file is missing as `failed`. M5+ may add a
`pgdp-prep --prune-stage-artifacts` opt-in for users who are done
proofing and want to recover disk (at the cost of disabling fast
workbench reruns until the DAG is re-run).

```
# Linux / macOS
$ curl -sSL https://raw.githubusercontent.com/pdomain/pdomain-prep-for-pgdp/main/install.sh | sh

# Windows (PowerShell)
PS> irm https://raw.githubusercontent.com/pdomain/pdomain-prep-for-pgdp/main/install.ps1 | iex

$ pgdp-prep
GPU detected: NVIDIA GeForce RTX 4070 (12 GB)
Listening on http://127.0.0.1:8765
Opening browser…
```

Single process, single port. Opens a browser tab. No AWS, no Docker, no
docker-compose, no `.env` shuffling. Models auto-download from Hugging Face on
first run (cached under `$HF_HOME` or `~/.cache/huggingface/`).

| Component | Value |
|---|---|
| Installer | `install.sh` / `install.ps1` (one-line curl/iex) — runs `uv tool install` |
| Entrypoint | `pgdp-prep` console script (uvicorn → FastAPI) |
| Port | `8765` (configurable via `PGDP_PORT`) |
| Storage | `~/pgdp-projects/` (override with `PGDP_DATA_ROOT`) |
| Database | SQLite at `~/.local/share/pgdp-prep/state.db` (project index, jobs) |
| GPU detection at install | `nvidia-smi` → pick `cuXXX` PyTorch index; macOS arm64 → no extra index (MPS in default wheel) |
| GPU detection at startup | CuPy + CUDA → `local`; macOS arm64 PyTorch → `mps` (DocTR only); else `cpu` |
| Auth | None (single user) |
| Frontend | Served from `pdomain_prep_for_pgdp/static/` inside the installed tool's venv |
| Image CDN | `/cdn/*` served by FastAPI's `StaticFiles` mount over `PGDP_DATA_ROOT` |

CPU mode is **first-class**, not a degraded fallback. A 400-page book takes
~30 minutes of CPU compute on a modern laptop (with cv2 grayscale; ~3 hours
with the legacy GEGL path). The UI surfaces the difference with a
"CPU mode — slow" indicator.

### `install.sh` (mirrors pdomain-ocr-cli/install.sh)

```sh
#!/bin/sh
set -e

# 1. Install uv if missing
if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# 2. Detect platform → pick PyTorch index
EXTRA_INDEX=""
EXTRAS=""                    # transformers + layout detector are base deps
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    CUDA_VER=$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: \([0-9]*\.[0-9]*\).*/\1/p' | head -1)
    if [ -n "$CUDA_VER" ]; then
        CUDA_TAG="cu$(echo "$CUDA_VER" | tr -d '.')"
        EXTRA_INDEX="https://download.pytorch.org/whl/${CUDA_TAG}"
        EXTRAS="[cuda]"          # adds cupy-cuda12x + nvidia-nvimgcodec-cu12
        echo "Detected CUDA ${CUDA_VER} — installing with ${CUDA_TAG} + CuPy."
    fi
elif [ "$(uname)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
    echo "Detected Apple Silicon — DocTR will use MPS automatically."
else
    echo "No GPU detected — installing CPU-only build."
fi

# 3. Resolve latest tag
REPO="pdomain/pdomain-prep-for-pgdp"
LATEST_TAG=$(curl -sSf "https://api.github.com/repos/${REPO}/tags" 2>/dev/null \
    | grep -o '"name": "[^"]*"' | head -1 | grep -o '[^"]*$') || true
INSTALL_REF="git+https://github.com/${REPO}${LATEST_TAG:+@$LATEST_TAG}"

# 4. uv tool install
if [ -n "$EXTRA_INDEX" ]; then
    uv tool install --reinstall "${INSTALL_REF}${EXTRAS}" --extra-index-url "$EXTRA_INDEX"
else
    uv tool install --reinstall "${INSTALL_REF}${EXTRAS}"
fi

echo "Done! Run: pgdp-prep"
```

The `[cuda]` extra in `pyproject.toml` pulls `cupy-cuda12x` and
`nvidia-nvimgcodec-cu12`. Without it the package installs without CuPy and
falls back to cv2 — DocTR alone still benefits from the CUDA PyTorch wheel
when `--extra-index-url` is provided.

``transformers>=4.45`` (RT-DETR support) is a **base dependency** of
``pdomain-book-tools`` — the PP-DocLayout_plus-L illustration / caption / header
detector (spec 05) is always available without an opt-in extra. The model
checkpoint itself (~132 MB) is downloaded lazily from Hugging Face on
first use; the wheel install just provides the inference dep
(``transformers``, ~30 MB Apache 2.0). ``contour`` (rule-based) and
``none`` remain as alternative detector keys for users who prefer them.

### Manual install (no install.sh)

```sh
# Linux / macOS — install uv first
curl -LsSf https://astral.sh/uv/install.sh | sh

# CPU install (layout detector + transformers are base deps — always included)
uv tool install git+https://github.com/pdomain/pdomain-prep-for-pgdp

# NVIDIA GPU (replace cuXXX with your CUDA version, e.g. cu124)
uv tool install "git+https://github.com/pdomain/pdomain-prep-for-pgdp[cuda]" \
    --extra-index-url https://download.pytorch.org/whl/cuXXX
```

### Editable / dev install (mirrors pdomain-ocr-cli `make install-local`)

```sh
git clone https://github.com/pdomain/pdomain-prep-for-pgdp
cd pdomain-prep-for-pgdp
make install-local      # uv tool install --editable . --with-editable ../pdomain-book-tools
```

Tracks local changes to both this repo and `../pdomain-book-tools` without
reinstalling. Reverts via `make uninstall-local && curl ... | sh`.

### Optional: Modal dispatch from local mode

A power user without a local GPU can configure Modal credentials and run the
local app while dispatching GPU work to Modal:

```
PGDP_GPU_BACKEND=modal MODAL_TOKEN_ID=… MODAL_TOKEN_SECRET=… pgdp-prep
```

This is identical to the managed shape's GPU path; only the storage stays
local. Useful for "I want to OCR a book on my laptop without buying a GPU."

### Uninstall

```sh
uv tool uninstall pdomain-prep-for-pgdp
# Optional: remove cached models
rm -rf ~/.cache/huggingface/hub/models--CT2534--pdomain-ocr-models
```

---

## Self-hosted

Same single Python process, deployed to a server. Aimed at a small team using
shared GPU hardware.

```
[ user browsers ] → caddy (TLS) → uvicorn pgdp-prep
                                    │
                                    ├── filesystem or S3 (configurable)
                                    └── local CUDA or Modal (configurable)
```

| Component | Value |
|---|---|
| Process supervisor | `systemd` unit (`pgdp-prep.service`) |
| Reverse proxy | Caddy or nginx (TLS termination) |
| Storage | `STORAGE_BACKEND=local` (filesystem on the VM) or `STORAGE_BACKEND=s3` |
| Database | SQLite for ≤5 users, Postgres for more |
| GPU | Local CUDA on the VM, or Modal for burst |
| Auth | `PGDP_API_KEY=…` — Bearer token check |

Useful when a small team already has a GPU box (e.g. a workstation) but wants
the project state and proofing UI accessible to everyone.

---

## Managed

The "incredibly cheap to host" target. Achieves this by **never running an
always-on GPU instance**. The only always-on resource is a small CPU container
that hosts the FastAPI app — everything GPU-shaped batches up and dispatches
on a schedule.

```
                      ┌─────────────────────────────────────────────┐
                      │  CloudFront ──→ ECS Fargate (CPU, 0.5 vCPU) │
                      │              ──→ pgdp-prep (uvicorn)        │
                      │                    │                        │
                      │                    ├── S3 (data)            │
                      │                    ├── RDS Postgres /       │
                      │                    │    Aurora Serverless v2│
[user browsers] ──────┤                    │    (scales to 0.5 ACU) │
                      │                    │                        │
                      │                    └── BatchDispatcher ──→  │
                      │                          (every 5 min)      │
                      │                              │              │
                      │                              ▼              │
                      │                        ┌─────────────────┐  │
                      │                        │  GPUBackend     │  │
                      │                        │                 │  │
                      │                        │  Modal (default)│  │
                      │                        │  or             │  │
                      │                        │  Shared GPU ECS │  │
                      │                        │  task (warm pool│  │
                      │                        │   shared across │  │
                      │                        │   tenants)      │  │
                      │                        └─────────────────┘  │
                      └─────────────────────────────────────────────┘
```

### Why this is cheap

- **No always-on GPU.** The dominant AWS cost in the previous architecture was
  `g4dn.xlarge` ($0.53/h on-demand, $385/month). Managed mode replaces this
  with two batch flushes per hour to Modal at ~$2 / 400-page book.
- **CPU-only Fargate.** 0.5 vCPU + 1 GB RAM Fargate task is ~$10/month
  always-on. Handles all CRUD, page tagger UI, project state, packaging.
- **Aurora Serverless v2** scales to 0.5 ACU (~$0.06/h = $43/month idle).
  For very low traffic, swap for Postgres on RDS t4g.micro (~$13/month).
- **No CloudFront required for low traffic.** S3 + signed URLs or the
  Fargate container's `/cdn/*` mount works for <100 GB/month egress.
- Total fixed cost target: **$10–15/month** plus per-book GPU ($2–3 each).

### Two GPU backends

#### Backend 1 — Modal (default for managed mode)

`GPU_BACKEND=modal`. The Modal function definitions live in spec 04. Dispatch
is per-page or per-batch with no provisioning required.

- Cold start: 10–15 s (first batch of the day)
- Warm runs: ~1 s/page processing, ~0.5 s/page DocTR
- Cost: ~$0.40 per GPU-hour (T4); ≈ $2 for a 400-page book end-to-end
- No fixed cost when idle

#### Backend 2 — Shared GPU container (for higher volume)

When a managed tenant has enough sustained traffic to amortise a long-running
GPU instance, deploy a single ECS EC2 task on `g4dn.xlarge` shared across all
tenants. The dispatcher routes to it instead of Modal.

```
GPU_BACKEND=shared_container
SHARED_GPU_URL=https://gpu.internal.example.com
```

The shared task is a stripped-down `pgdp-prep` running with
`PGDP_MODE=gpu_worker_only` — no UI, just `/api/gpu/*` routes. Tenants
authenticate via per-tenant API keys; a per-tenant queue stays separate so
one tenant cannot starve another.

This backend is **opt-in**. Modal is the default because it has zero idle
cost; the shared container only wins when total weekly GPU minutes exceed
~25 hours.

### The Batch Dispatcher

Managed mode introduces one piece that local/self-hosted modes do not have:
a scheduled flush of queued GPU work.

In local mode, every workbench keystroke can dispatch to GPU immediately —
the cost of warming a pinned local CUDA context is paid once, on process
start. In managed mode that's not true: every Modal invocation pays the
~10 s cold-start tax, and routing every interactive request individually
would be ruinous.

The dispatcher batches:

```python
# pdomain_prep_shared/batch_dispatcher.py
from datetime import datetime, timedelta

class BatchDispatcher:
    """Periodic flush of queued GPU work. One instance per backend.

    Configurable cadence (default 5 minutes). Interactive requests bypass
    the dispatcher and fire immediately; only batch jobs queue up.
    """

    def __init__(self, backend: GPUBackend, interval_seconds: int = 300):
        self.backend = backend
        self.interval = interval_seconds
        self._pending: list[BatchJobItem] = []

    async def run_forever(self):
        while True:
            await asyncio.sleep(self.interval)
            await self.flush()

    async def flush(self):
        if not self._pending:
            return
        items = self._pending
        self._pending = []
        # One Modal invocation handles the whole batch — amortises cold start
        await self.backend.run_batch(items)

    def submit(self, item: BatchJobItem):
        self._pending.append(item)
```

Trade-off: a 400-page book that submits all pages at once now completes in
**(book duration) + (up to 5 min wait)** rather than starting immediately.
For a book that takes ~6 minutes of GPU time, the 5-min flush window is the
right scale — the user sees one cold start, not 400. The interval is
configurable (`PGDP_DISPATCH_INTERVAL_SECONDS`); set it lower for testing,
higher to amortise across more work.

**Interactive requests** (workbench live preview, page-correction re-runs) do
**not** go through the dispatcher. They fire immediately, accept the
~10–15 s Modal cold start when it happens, and the UI shows a "GPU warming
up…" indicator. After the first interactive request the Modal container
stays warm for the Modal idle window (~5 minutes by default), so subsequent
interactive edits are fast.

#### What goes through the dispatcher

| Operation | Routing | Why |
|---|---|---|
| Workbench `POST /api/pages/{id}/stages/{id}/run` (single, from) | Direct to GPU backend | User is waiting; latency matters |
| Page-correction stage re-run from text review | Direct | User-facing |
| `project.run_stage_all_pages(stage_id="canvas_map")` (whole-book proofing) | Dispatcher | Amortise cold start across 400 pages |
| `project.run_stage_all_pages(stage_id="ocr")` | Dispatcher | OCR also batches ~8 pages per forward pass |
| `project.run_dirty(...)` | Dispatcher when stage requires GPU; in-process otherwise | Mixed |
| `text_postprocess` stage runs (project-wide or per-page) | CPU; runs in Fargate, no dispatcher | No GPU needed |
| `extract_illustrations` stage runs | CPU; Fargate | No GPU needed |
| `project.build_package` | CPU; Fargate | No GPU needed; may park in `awaiting_review` per Q7 gate |

---

## Mode-aware code

The only code that branches on deployment mode lives in adapter selection at
startup. Everything else is shared.

| Interface | Local | Self-hosted | Managed |
|---|---|---|---|
| `IStorage` | filesystem | filesystem or S3 | S3 |
| `IDatabase` | SQLite | SQLite or Postgres | Postgres |
| `IAuth` | none | api-key | JWT (Cognito/Auth0) |
| `GPUBackend` | local CUDA / CPU | local CUDA / Modal | Modal / shared container |
| Batch dispatch | sync | sync | `BatchDispatcher` (5-min) |

```python
# pdomain_prep_shared/bootstrap.py — picked once at process start
def build_app() -> FastAPI:
    settings = Settings()  # reads env

    storage  = build_storage(settings)
    database = build_database(settings)
    auth     = build_auth(settings)
    gpu      = build_gpu_backend(settings)

    if settings.batch_dispatch_interval_seconds > 0:
        dispatcher = BatchDispatcher(gpu, settings.batch_dispatch_interval_seconds)
    else:
        dispatcher = ImmediateDispatcher(gpu)

    app = FastAPI()
    install_data_routes(app, storage, database, auth)
    install_gpu_routes(app, gpu, dispatcher, storage, auth)
    install_static_frontend(app, settings)   # from package resources
    install_local_cdn_if_needed(app, settings, storage)
    return app
```

`build_*` functions live in shared code; the wheel ships the same `build_app`
on every machine.

---

## Shared code layout

The wheel installs one importable package; both UI-serving code and GPU
worker code live in the same module tree so there is no duplication.

```
src/
└── pdomain_prep_for_pgdp/
    ├── __init__.py
    ├── __main__.py            # `python -m pdomain_prep_for_pgdp` (also `pgdp-prep` script)
    ├── settings.py            # pydantic-settings; reads env vars
    ├── bootstrap.py           # build_app() — one-shot adapter wiring
    │
    ├── api/                   # FastAPI routes
    │   ├── data/              # /api/data/* — projects, pages, assets
    │   └── gpu/               # /api/gpu/* — process-page, ocr, jobs, ingest
    │
    ├── core/                  # SHARED across all modes
    │   ├── config_resolver.py # resolve_page_config() (spec 01)
    │   ├── pipeline/          # Step 4 sub-steps (4c–4o), Step 6, Step 8, Step 10
    │   ├── ocr/               # DocTR + Tesseract wrappers
    │   ├── illustrations.py   # extract_illustration() (spec 05)
    │   ├── packaging.py       # build_package() (spec 02 step 10)
    │   └── prefix.py          # compute_prefix() (spec 01)
    │
    ├── adapters/              # SWAPPABLE
    │   ├── storage/
    │   │   ├── filesystem.py
    │   │   └── s3.py
    │   ├── database/
    │   │   ├── sqlite.py
    │   │   └── postgres.py
    │   ├── auth/
    │   │   ├── none.py
    │   │   ├── apikey.py
    │   │   └── jwt.py
    │   └── gpu/
    │       ├── local.py             # in-process CuPy/PyTorch
    │       ├── cpu.py               # CPU-only fallback
    │       ├── modal_backend.py     # dispatches to Modal functions
    │       └── shared_container.py  # HTTP client to GPU worker
    │
    ├── dispatcher/
    │   ├── immediate.py
    │   └── batched.py               # 5-min flush
    │
    └── static/                # built React SPA (populated by CI)
        ├── index.html
        ├── env.js              # generated at startup from runtime settings
        └── assets/
```

Everything in `core/` is **mode-agnostic** and gets reused by every shape.
Everything in `adapters/` and `dispatcher/` is small and swappable.

The Modal function in `adapters/gpu/modal_backend.py` imports from `core.pipeline`
directly — Modal mounts the same package into its container, so even the GPU
worker runs the **same pipeline code** as the local install.

---

## Frontend bundling

The React SPA is built in CI before `python -m build`:

```bash
# CI step
cd frontend && npm ci && npm run build           # writes to dist/
cp -r frontend/dist/* src/pdomain_prep_for_pgdp/static/
python -m build --wheel                           # static/ included via pyproject.toml
```

`pyproject.toml`:
```toml
[tool.hatch.build.targets.wheel]
packages = ["src/pdomain_prep_for_pgdp"]

[tool.hatch.build.targets.wheel.force-include]
"src/pdomain_prep_for_pgdp/static" = "pdomain_prep_for_pgdp/static"
```

At runtime FastAPI serves the SPA from package resources:

```python
from importlib.resources import files
import fastapi.staticfiles as staticfiles

app.mount(
    "/",
    staticfiles.StaticFiles(directory=files("pdomain_prep_for_pgdp") / "static", html=True),
    name="ui",
)
```

`window.__ENV__` is generated at startup based on runtime env vars and injected
into `index.html` (cached and rewritten only when env changes).

---

## Local development

`pgdp-prep` runs the production wheel layout. For frontend hot-reload
development you still want Vite:

```bash
# Terminal 1 — backend
uv run pgdp-prep --reload --frontend-dev http://localhost:5173

# Terminal 2 — frontend
cd frontend && npm run dev
```

`--frontend-dev URL` makes FastAPI redirect `/` and unknown asset paths to the
Vite dev server instead of serving the bundled SPA. No proxy config needed; one
backend handles everything else.

---

## Environment variables

```bash
# All modes
PGDP_PORT=8765                          # default
PGDP_DATA_ROOT=/var/lib/pgdp            # local mode default ~/pgdp-projects
PGDP_DOCTR_CACHE_DIR=/opt/pdomain-ml-models  # default ~/.cache/pdomain-ml-models

# Adapter selection (auto-detected when omitted)
PGDP_STORAGE_BACKEND=filesystem|s3
PGDP_DATABASE_URL=sqlite:///path/state.db | postgres://...
PGDP_AUTH_MODE=none|apikey|jwt
PGDP_API_KEY=...                        # apikey mode

# GPU
PGDP_GPU_BACKEND=local|mps|cpu|modal|shared_container
MODAL_TOKEN_ID=...                      # modal backend
MODAL_TOKEN_SECRET=...
SHARED_GPU_URL=https://gpu.internal/    # shared_container backend
SHARED_GPU_API_KEY=...

# Dispatch cadence (managed mode)
PGDP_DISPATCH_INTERVAL_SECONDS=300      # 0 = immediate (default for local/self-hosted)

# Hosted-only
S3_DATA_BUCKET=...
S3_CDN_BASE_URL=https://cdn.example.com
JWT_ISSUER=https://issuer.example.com
JWT_AUDIENCE=pgdp-prep
```

---

## Cost estimate (managed mode, light usage)

100 books processed/month, ~400 pages each, ~6 min GPU per book.

| Component | Config | $/month |
|---|---|---|
| ECS Fargate (CPU) | 0.5 vCPU + 1 GB, 24×7 | ~$10 |
| Aurora Serverless v2 | 0.5 ACU min, scaled to demand | ~$45 |
| S3 (data) | 200 GB, 200k requests | ~$5 |
| S3 egress (no CloudFront) | 50 GB | ~$4.50 |
| Modal GPU (T4) | 100 books × 6 min × $0.40/h | ~$4 |
| **Total** | | **~$70/month** |

For a hobbyist deployment of 10 books/month, swap Aurora for `t4g.micro` RDS:
~$13 fixed + ~$0.40 GPU = **~$25/month**.

For a single-user managed deployment, replace RDS with SQLite on an EBS volume
attached to the Fargate task: **~$15/month** + GPU usage.

---

## CI/CD

```yaml
# .github/workflows/release.yml
- name: Build frontend
  run: cd frontend && npm ci && npm run build && cp -r dist/* ../src/pdomain_prep_for_pgdp/static/

- name: Tag and push (install.sh resolves latest tag from GitHub API)
  run: |
    git tag "$VERSION"
    git push --tags

- name: Build container (managed mode)
  run: |
    docker build -t pgdp-prep:$VERSION .
    aws ecr get-login-password | docker login --password-stdin "$ECR"
    docker push "$ECR/pgdp-prep:$VERSION"

- name: Deploy ECS
  run: aws ecs update-service --cluster pgdp --service pgdp-prep --force-new-deployment

- name: Deploy Modal functions
  run: modal deploy src/pdomain_prep_for_pgdp/adapters/gpu/modal_backend.py
```

Local install does **not** publish to PyPI. `install.sh` reads the latest tag
from the GitHub API and installs directly via `uv tool install
git+https://github.com/.../pdomain-prep-for-pgdp@<tag>` (same pattern as
pdomain-ocr-cli). Hatchling + hatch-vcs derives the package version from the tag
at install time. No PyPI account, no upload step, no race between tag and
publish. Hosted-mode ECS still uses the same git ref via the container build.

Frontend bundle, container image, and Modal functions are all built from the
same commit. There is no monorepo coordination across separate language
stacks — `uv tool install` against the git ref is the single deliverable for
local + self-hosted, and the container that wraps the same source tree
covers managed.
