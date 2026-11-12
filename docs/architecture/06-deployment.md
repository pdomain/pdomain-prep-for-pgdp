# 06 — Deployment

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-12
- **Read when:** packaging or deploying the application.
- **Search terms:** deployment, local install, container, cloud, release.

The supported deployment is local filesystem storage with SQLite. Self-hosted authentication is configurable.
Managed cloud operation remains deferred; adapter selection alone does not make local page stores remote.

## Local — `pgdp-prep`

The installer resolves GitHub's latest release response, selects a wheel asset, downloads it, and installs it
through uv. It fails if the release has no wheel instead of falling back to a source build requiring Node.
It can bootstrap uv and select CUDA extras when NVIDIA is detected. This describes the installer code;
this audit did not exercise a fresh remote installation or confirm current release assets.

Defaults include `127.0.0.1:8765`, `~/pgdp-projects`, filesystem storage, SQLite, and auth mode `none`.
GPU selection is automatic unless configured. The preferred variable is `PDOMAIN_GPU_BACKEND`;
`PGDP_GPU_BACKEND` remains a deprecated alias. The CLI opens a browser unless `--no-browser` is supplied.

The stage write pool defaults to `min(cpu_count(), 4)`; its queue capacity defaults to four times the pool size.
There is no configured periodic reconciliation interval. Reconciliation is an explicit CLI operation.

### Disk-cost implication of every-intermediate stage persistence

Artifacts live under `<data_root>/projects/<id>/pages/<page_id>/stages/` and project-stage directories.
Image, text, and compound products differ in size. Multiplying source size by all stage counts is a planning
estimate, not a measured invariant. A 500-page book with 2 MB inputs and sixteen source-sized intermediates
would use about 16 GB, but actual storage depends on outputs and compression.

`pgdp-prep reindex <project_id>` reports drift. With `--heal`, orphan files move to
`.orphan-stage-artifacts` with a manifest; missing artifacts mark rows failed, and hash/version drift marks rows
dirty with downstream invalidation. Heal does not reclaim durable running jobs.

## Self-hosted

Use the same wheel with filesystem/SQLite and an appropriate auth mode. For example:

```sh
PGDP_HOST=0.0.0.0
PGDP_DATA_ROOT=/var/lib/pgdp
PGDP_AUTH_MODE=apikey
PGDP_API_KEY=...
PGDP_SESSION_SECRET=...
```

Keep the session secret stable if API-key sessions should survive restarts. TLS termination is a deployment
responsibility.

The session cookie and CORS origins depend on `PGDP_HOST` unless you set them:

| Setting | `PGDP_HOST` is 127.0.0.1, localhost or ::1 | Any other host |
|---|---|---|
| `PGDP_SESSION_COOKIE_SECURE` | `false` | `true`, so browsers send the cookie over HTTPS only |
| `PGDP_CORS_ALLOW_ORIGINS` | `["*"]` | `[]`, so no cross-origin browser access |

Self-host checklist:

- Set `PGDP_AUTH_MODE=apikey`, `PGDP_API_KEY` and a stable `PGDP_SESSION_SECRET`.
- Serve the app over HTTPS. To allow login over plain HTTP on a private network, set
  `PGDP_SESSION_COOKIE_SECURE=false`. The server logs a warning at startup when the host default makes the cookie
  HTTPS-only.
- If a reverse proxy terminates HTTPS and the app binds to loopback, set `PGDP_SESSION_COOKIE_SECURE=true`.
- List any other web origin that calls the API as a JSON array, for example
  `PGDP_CORS_ALLOW_ORIGINS='["https://proof.example"]'`. The app's own pages need no entry.
- Run one server process per data root.

At startup the server marks every job still `running` as `error`, with a message saying the server stopped while
the work was running. For each such project it also marks `running` page-stage and project-stage rows as `failed`.
Run the work again afterwards. This assumes one server process per database, so do not start two servers on the
same data root. A page-stage row left `running` by a synchronous request has no job, so this pass does not reach it.

S3 configuration uses `PGDP_S3_DATA_BUCKET`. Modal credentials use `PGDP_MODAL_TOKEN_ID` and
`PGDP_MODAL_TOKEN_SECRET`. These settings expose adapter wiring, not a verified managed deployment.
The Postgres builder exists, but its stage/database contract remains incomplete.

## Managed (Fargate + Modal)

Remote GPU dispatch classes come from `pdomain_ops.gpu`. Local page lifecycle and project-stage execution still
use local project paths. Container orchestration, remote persistence, and multi-instance coordination are
candidates for another repository. See [repository boundary](10-repository-boundary.md) and
[the roadmap](../plans/roadmap.md#deferred--remote--cloud-mode).

The Dockerfile uses Node 24 to build the SPA and Python 3.13 for runtime.
No image-size or live cloud-readiness claim is established by this source audit.

## Build and release commands

`make frontend-build` copies the SPA bundle into package static resources.
Hatch's build artifacts include `static/**`; the custom SPA check rejects a wheel build without its bundle.

`make ci AI=1` runs local lint, type checks, OpenAPI generation, frontend build, backend/frontend tests, and knip.
`make ci-slow AI=1` adds distribution builds and slow tests.
The release targets invoke local release scripts. This checkout has no `.github/workflows/` release, publish,
dependency-refresh, or CI workflow. Do not describe absent GitHub workflows as active automation.

## Evidence

Verified from source on 2026-11-07: `install.sh`, `Dockerfile`, `Makefile`, `pyproject.toml`,
`scripts/do-release.sh`, `scripts/release-common.sh`, `settings.py`, `bootstrap.py`,
and `cli/reindex.py`. Python module paths are under `src/pdomain_prep_for_pgdp/`.
The repository's `.github/` tree contains an issue template, not workflows.
Local tests cover settings and reconciliation; this audit does not claim live cloud or clean-machine install tests.
