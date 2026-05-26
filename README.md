# pdomain-prep-for-pgdp

Web app that converts a folder or zip of scanned book images (e.g. from
Internet Archive) into a PGDP-ready submission package: standard proofing
images, OCR text files, and a zip ready for upload to
[Distributed Proofreaders](https://www.pgdp.net/).

One Python wheel ships everywhere — solo proofer on a laptop, small team on a
shared GPU box, or a hosted multi-tenant offering. The same pipeline runs in
all three; only the storage / database / auth / GPU adapters change.

## Quick start (local install)

```sh
# Linux / macOS
curl -sSL https://raw.githubusercontent.com/pdomain/pdomain-prep-for-pgdp/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/pdomain/pdomain-prep-for-pgdp/main/install.ps1 | iex

pgdp-prep
```

The installer:

- installs `uv` if missing,
- detects an NVIDIA GPU via `nvidia-smi` and picks the matching PyTorch wheel,
- resolves the latest GitHub tag, downloads the prebuilt wheel attached to
  that release, and runs `uv tool install` against it,
- starts a single FastAPI process on port `8765` and opens a browser tab.

No AWS, no Docker, no PyPI publish step. **End users do not need Node, npm,
or mise** — the wheel ships with the React SPA prebuilt, so `pgdp-prep` runs
out of the published install.

## Deployment shapes

| | Local | Self-hosted | Managed |
|---|---|---|---|
| Target user | Solo proofer | Small team | Hosted offering |
| Storage | Filesystem | Filesystem or S3 | S3 |
| Database | SQLite | SQLite or Postgres | Postgres |
| GPU | Local CUDA / MPS / CPU | Local CUDA / Modal | Modal / shared GPU |
| Auth | None | API key | JWT |
| AWS required | No | No | Yes |

See [`specs/09-deployment.md`](specs/09-deployment.md) for the full breakdown.

## Architecture

Single FastAPI process serving:

| Path | Purpose |
|---|---|
| `/` | React SPA (built into the wheel) |
| `/api/data/*` | Project + page CRUD, presigned URLs, jobs |
| `/api/gpu/*` | Image processing, OCR, ingest, packaging |
| `/cdn/*` | Local image files (filesystem mode only) |
| `/api/auth/*` | Identity (none / api-key / JWT) |

See [`specs/00-overview.md`](specs/00-overview.md) for the high-level picture
and the rest of `specs/` for the details.

## How to run (from a checkout)

```sh
make run        # auto-detects GPU; CUDA host -> cuda:0, else CPU
make run-cpu    # forces PGDP_GPU_BACKEND=cpu (debugging / weak GPU / CUDA OOM)
```

Both targets build the SPA bundle into `src/pdomain_prep_for_pgdp/static/`
first, then launch `pgdp-prep` as a single FastAPI process at
<http://127.0.0.1:8765> (next free port if 8765 is taken). Watch the
startup log for `local backend on cuda:0` vs `local backend on cpu`
to confirm which device the OCR pipeline picked up.

End users installing via the wheel just run `pgdp-prep` — the wheel
already includes the SPA bundle, so no `make run` step is needed.

## Development

Contributor workflows (Node, mise, local-dev with `pdomain-book-tools`, CI,
release tags) live in [`DEVELOPMENT.md`](DEVELOPMENT.md). Architecture deep
dive is in [`docs/`](docs/).

End users do not need Node, npm, or mise — the published wheel ships with
the prebuilt SPA bundle.

## Specs

The build is driven by the specs in [`specs/`](specs/) — Pydantic models in
spec 08 are the source of truth for all request/response shapes; the
TypeScript frontend types are generated from `/openapi.json`.

| Spec | Topic |
|---|---|
| 00 | Overview |
| 01 | Three-tier configuration model |
| 02 | Pipeline steps |
| 03 | UI layout |
| 04 | GPU acceleration |
| 05 | Illustration extraction |
| 06 | Page workbench |
| 07 | API design |
| 08 | Data models |
| 09 | Deployment |

## License

Unlicense (public domain).
