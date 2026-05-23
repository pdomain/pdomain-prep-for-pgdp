# Deep Code Review and Security Scan - 2026-05-22

Repo: `ConcaveTrillion/pd-prep-for-pgdp`

Scope: backend API/auth/data access, file-processing/pipeline/storage/packaging, frontend/browser behavior,
build/dependency/CI/release/config.

Method:

- Parallel subagent review by domain.
- Local static pattern scans for auth, filesystem, ZIP/image processing, frontend browser sinks, and
  security lint rules.
- Dependency audits:
  - `pnpm audit --audit-level low --json`: 2 moderate dev-tool vulnerabilities, 0 low/high/critical.
  - `pnpm audit --prod`: no known production npm vulnerabilities reported by subagent.
  - `uv lock --check`: passed.
  - `pip-audit` on full exported requirements was blocked by private/local `pd-book-tools`; subagent
    audit of locked public deps found `starlette==1.0.0` vulnerable.
  - `uv run ruff check --select S --output-format json src scripts`: no Bandit-rule findings.

Existing repo status before filing: no open issues or PRs in `ConcaveTrillion/pd-prep-for-pgdp`.

## Findings

### 1. Unauthenticated SPA fallback can serve absolute host files

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/bootstrap.py:343-348`

The SPA fallback joins the static bundle path with `full_path` and serves `candidate` when
`os.path.isfile(candidate)` is true. If `full_path` is an absolute path after URL decoding,
`os.path.join()` ignores the static root. A request such as `/%2Fetc%2Fpasswd` can therefore serve
host files.

Recommended fix: reject absolute paths and traversal segments before joining, resolve the candidate,
require it to stay under the static root, and add regression tests for encoded absolute and traversal
paths.

Suggested labels: `kind:bug`, `priority:high`, `effort:S`, `model:sonnet`, `model-effort:high`

### 2. Filesystem CDN bypasses auth for project data reads and writes

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/bootstrap.py:295-305`, `src/pd_prep_for_pgdp/api/cdn.py:22-39`,
`src/pd_prep_for_pgdp/adapters/storage/filesystem.py:74-80`

In filesystem mode, "presigned" URLs are plain `/cdn/<key>` paths. The PUT route has no auth dependency
and the StaticFiles mount serves the whole data root. In `apikey` or `jwt` mode, anyone with a known
key can fetch or overwrite source zips, artifacts, and package zips without authentication.

Recommended fix: replace raw data-root StaticFiles serving with authenticated or cryptographically
signed CDN routes, include expiry and method in signatures, scope keys to project ownership, and enforce
upload size/content-type limits.

Suggested labels: `kind:bug`, `priority:high`, `effort:L`, `model:sonnet`, `model-effort:high`

### 3. API-key mode leaks the bearer secret through `/env.js`

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/env_js.py:26-30`, `src/pd_prep_for_pgdp/api/env_js.py:38-46`,
`frontend/src/api/client.ts:14-23`, `frontend/src/api/client.ts:62-63`,
`src/pd_prep_for_pgdp/bootstrap.py:245-250`

When `auth_mode="apikey"`, `/env.js` emits `API_TOKEN` to unauthenticated browser clients. Any visitor,
and cross-origin pages via script inclusion, can recover the bearer token and call protected APIs;
wildcard CORS compounds the exposure.

Recommended fix: do not expose server API keys to browser JavaScript. Treat API-key mode as
server-to-server only, or replace browser auth with a session/OIDC flow using httpOnly SameSite cookies.
Restrict CORS to configured trusted origins.

Suggested labels: `kind:bug`, `priority:high`, `effort:M`, `model:sonnet`, `model-effort:high`

### 4. Job retry payload override can redirect work across projects and data roots

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/gpu/jobs.py:93-107`,
`src/pd_prep_for_pgdp/core/job_runner.py:432-459`

Retry shallow-merges arbitrary `payload_override` keys into the copied job payload.
`_handle_run_page_stage()` trusts payload fields including `project_id`, `page_id`, `stage_id`, and
`data_root`, and does not verify that the target project belongs to `job.owner_id`. A user who owns a
failed/cancelled job can redirect a retry to another project or a different data root.

Recommended fix: whitelist retry-overridable keys per job type, reject identity/path fields, and have
handlers re-check project ownership and configured data root. Add regression tests for forbidden
`project_id` and `data_root` overrides.

Suggested labels: `kind:bug`, `priority:high`, `effort:M`, `model:sonnet`, `model-effort:high`

### 5. Ingest accepts arbitrary storage keys for an owned project

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/gpu/ingest.py:28-49`,
`src/pd_prep_for_pgdp/core/job_runner.py:323-337`, `src/pd_prep_for_pgdp/core/ingest.py:84-87`,
`src/pd_prep_for_pgdp/core/ingest.py:356-371`

The ingest route verifies ownership of `project_id` but stores attacker-controlled `source_key` in the
queued job. The runner later reads that key from storage. A user can point their ingest at another known
storage prefix and copy/list data into their own project.

Recommended fix: bind ingest source keys to `project.storage_prefix`; for zip uploads require the
server-issued source zip key, and reject folder keys outside the project prefix. Add cross-owner
source-key tests.

Suggested labels: `kind:bug`, `priority:high`, `effort:S`, `model:sonnet`, `model-effort:high`

### 6. Packaging filename can escape the project prefix

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/core/models.py:67-69`,
`src/pd_prep_for_pgdp/api/data/projects.py:201-211`,
`src/pd_prep_for_pgdp/core/packaging.py:150-152`

`book_name` is user-controlled and is interpolated directly into `projects/{id}/for_zip/{book_name}.zip`.
In filesystem mode, traversal-like names can resolve outside `for_zip/` and overwrite other project
files.

Recommended fix: treat `book_name` as display text only. Generate package filenames from a sanitized
slug that rejects separators, `..`, and control characters; validate the composed key stays under
`project.storage_prefix + "for_zip/"`. Add traversal regression tests.

Suggested labels: `kind:bug`, `priority:high`, `effort:M`, `model:sonnet`, `model-effort:high`

### 7. ZIP and image processing paths have no resource bounds

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/cdn.py:34`, `src/pd_prep_for_pgdp/core/ingest.py:194-218`,
`src/pd_prep_for_pgdp/core/ingest.py:356-371`, `src/pd_prep_for_pgdp/core/ingest.py:427-452`,
`src/pd_prep_for_pgdp/core/ingest.py:502-527`

Upload, preview, unzip, and thumbnail code paths read entire request bodies, entire source zips, ZIP
entries, and page source bytes into memory. Large uploads, zip bombs, or huge decoded images can exhaust
RAM/CPU, and preview thumbnailing can repeatedly decompress a selected entry.

Recommended fix: enforce max upload size, source zip size, entry count, uncompressed bytes, compression
ratio, and decoded image dimensions/pixels. Stream uploads to storage and process thumbnails with bounded
queues. Add malicious archive and oversized image tests.

Suggested labels: `kind:bug`, `priority:high`, `effort:L`, `model:sonnet`, `model-effort:high`

### 8. Unsaved text-review edits can be silently overwritten

Severity: High
Category: code-quality

Evidence: `frontend/src/pages/TextReviewPage.tsx:113-119`,
`frontend/src/pages/TextReviewPage.tsx:496-506`,
`frontend/src/pages/TextReviewPage.tsx:609-615`

Fetched OCR text is copied directly into the editable draft whenever query data changes, and navigation
links do not guard dirty state. A refetch, split/page change, or Prev/Next navigation can reset `dirty`
and discard unsaved edits without confirmation.

Recommended fix: keep fetched text separate from the local draft, only apply fetched data when
`dirty === false` or after confirmation, and add route plus `beforeunload` blockers for dirty drafts.
Add tests for refetch and navigation overwrite cases.

Suggested labels: `kind:bug`, `area:tests`, `priority:high`, `effort:M`, `model:sonnet`, `model-effort:high`

### 9. Postgres adapter does not satisfy the database contract

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/adapters/database/base.py:93-126`,
`src/pd_prep_for_pgdp/adapters/database/postgres.py:260-278`,
`src/pd_prep_for_pgdp/bootstrap.py:63-74`

`build_database()` can select `PostgresDatabase`, but the adapter lacks required page-stage/split/
enumeration methods and raises `NotImplementedError` for search. Stage routes and job handlers will fail
at runtime in Postgres-backed deployments.

Recommended fix: complete the Postgres implementation to match `IDatabase`, or fail fast at startup
until it is supported. Add a shared adapter contract test for Postgres.

Suggested labels: `kind:bug`, `priority:medium`, `effort:L`, `area:tests`, `model:sonnet`, `model-effort:high`

### 10. Progress updates can undo cancellation and continue side effects

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/api/gpu/jobs.py:48-59`,
`src/pd_prep_for_pgdp/core/job_runner.py:263-305`,
`src/pd_prep_for_pgdp/core/job_runner.py:347-357`

Cancellation writes `status=cancelled`, but a running handler can later call `_update_progress()` with
a stale running job object and overwrite the cancelled status. Unzip can then enqueue follow-up thumbnail
jobs after cancellation.

Recommended fix: make job updates conditional/CAS-style, re-read and preserve terminal status in
`_update_progress()`, and add cooperative cancellation checks before expensive work and follow-up job
creation.

Suggested labels: `kind:bug`, `area:tests`, `priority:medium`, `effort:M`, `model:sonnet`, `model-effort:high`

### 11. S3 missing-object handling likely returns 500 instead of 404

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/adapters/storage/s3.py:51-60`

`S3Storage.exists()` catches only `self._client.exceptions.NoSuchKey`, while real `head_object` commonly
raises `botocore.exceptions.ClientError` with 404/NoSuchKey/NotFound. Routes expecting `exists() == False`
can surface an internal error for missing objects.

Recommended fix: catch `ClientError`, inspect error code/status for 404/NoSuchKey/NotFound, return
`False`, and re-raise other errors. Add a fake `ClientError` test.

Suggested labels: `kind:bug`, `area:tests`, `priority:medium`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 12. ZIP entries with duplicate basenames overwrite each other

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/core/ingest.py:367-371`,
`src/pd_prep_for_pgdp/core/ingest.py:461-466`

`_stem_from_zipname()` drops directory paths, and `_enumerate_zip()` writes to `source/{stem}{ext}`. A
zip containing `a/page.png` and `b/page.png` silently overwrites the first file and can create multiple
page records pointing at the same storage key.

Recommended fix: preserve sanitized relative path components, or detect duplicate output keys and assign
deterministic suffixes. Add tests for duplicate basenames across ZIP directories.

Suggested labels: `kind:bug`, `area:tests`, `priority:medium`, `effort:M`, `model:sonnet`, `model-effort:medium`

### 13. Authenticated SSE streams bypass the bearer-token client

Severity: Medium
Category: code-quality

Evidence: `frontend/src/hooks/useJobProgress.ts:53-66`,
`frontend/src/hooks/useStageEvents.ts:40-41`,
`src/pd_prep_for_pgdp/api/gpu/jobs.py:119-163`

Native `EventSource` cannot send the `Authorization` header required by `Depends(get_user)`. In `jwt`
or `apikey` mode, progress and stage event streams can 401/reconnect or fall back to stale one-shot GET
behavior.

Recommended fix: use authenticated fetch streaming/SSE parsing, cookie auth for SSE, or short-lived
signed event URLs. Add auth-mode tests for both SSE hooks.

Suggested labels: `kind:bug`, `area:tests`, `priority:medium`, `effort:M`, `model:sonnet`, `model-effort:medium`

### 14. S3 ZIP uploads can fail because XHR does not pin Content-Type

Severity: Medium
Category: code-quality

Evidence: `frontend/src/pages/ProjectListPage.tsx:437-456`,
`src/pd_prep_for_pgdp/api/data/projects.py:149`,
`src/pd_prep_for_pgdp/adapters/storage/s3.py:85-95`

S3 presigns uploads with `ContentType: application/zip`, but the frontend XHR sends the `File` without
setting `Content-Type`. Browser-selected `.zip` files can have an empty or different type, causing
signature mismatch.

Recommended fix: pass the expected content type through `uploadFile()` and set
`xhr.setRequestHeader("Content-Type", "application/zip")`, or presign using the exact type the frontend
sends.

Suggested labels: `kind:bug`, `area:tests`, `priority:medium`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 15. Locked Python dependency has active Starlette advisory

Severity: Medium
Category: security

Evidence: `uv.lock:2631`, `uv.lock:2637-2639`

The lock pins `starlette==1.0.0`. Subagent `pip-audit` on locked public dependencies reported
`PYSEC-2026-161`, fixed in `1.0.1`.

Recommended fix: update the lock to `starlette>=1.0.1` and rerun backend tests.

Suggested labels: `kind:bug`, `area:deps`, `priority:medium`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 16. Frontend dev dependency graph includes vulnerable Vite/esbuild

Severity: Medium
Category: security

Evidence: `frontend/pnpm-lock.yaml:3372`, `frontend/pnpm-lock.yaml:5794`,
`frontend/pnpm-lock.yaml:9651`; `pnpm audit --audit-level low --json`

Full `pnpm audit` reports moderate advisories for `esbuild@0.21.5` (`GHSA-67mh-4wv8-2f99`) and
`vite@5.4.21` (`GHSA-4w7w-66w2-5vf9`), pulled through Vitest dev tooling.

Recommended fix: upgrade `vitest`/`@vitest/ui` so their transitive Vite/esbuild versions are patched,
then rerun `pnpm audit`.

Suggested labels: `kind:bug`, `area:deps`, `priority:medium`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 17. Release workflow ignores the committed pnpm lockfile

Severity: Medium
Category: security

Evidence: `.github/workflows/release.yml:30-39`

The release SPA build runs `npm install` even though the repo uses `frontend/pnpm-lock.yaml` and
CI/Docker use pnpm. Release builds can use a different dependency graph than reviewed and audited CI.

Recommended fix: use corepack with a pinned pnpm version and `pnpm install --frozen-lockfile` in
release.

Suggested labels: `kind:bug`, `area:ci`, `area:deps`, `priority:medium`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 18. Docker Python install is not lockfile reproducible

Severity: Medium
Category: security

Evidence: `Dockerfile:45-60`

The runtime image copies `pyproject.toml` but not `uv.lock`, then runs
`uv pip install --system ".[s3,postgres,modal,jwt]"` without locked resolution. Production images can
drift from CI/local tested dependencies.

Recommended fix: copy `uv.lock` and install with locked resolution, or use
`uv sync --locked --no-dev --all-extras` with explicit handling for local/private sources.

Suggested labels: `kind:bug`, `area:deps`, `priority:medium`, `effort:M`, `model:sonnet`, `model-effort:medium`

### 19. Floating tool/image/action refs increase supply-chain risk

Severity: Medium
Category: security

Evidence: `Dockerfile:7`, `Dockerfile:10`, `Dockerfile:34`, `.github/workflows/ci.yml:35-37`

The Dockerfile and CI use moving refs such as `node:24-slim`, `pnpm@latest`, `ghcr.io/astral-sh/uv:latest`,
and `setup-uv` `version: latest`. Upstream movement can silently change CI or production builds.

Recommended fix: pin exact pnpm/uv versions, base image digests, and preferably action SHAs; add a
controlled update workflow.

Suggested labels: `kind:chore`, `area:ci`, `area:deps`, `priority:medium`, `effort:M`, `model:sonnet`, `model-effort:medium`

### 20. Release workflow grants write token to all jobs

Severity: Medium
Category: security

Evidence: `.github/workflows/release.yml:16-17`, `.github/workflows/release.yml:20-39`,
`.github/workflows/release.yml:46-67`

The release workflow sets workflow-wide `contents: write`. Build jobs run dependency installs before
publishing, so a compromised package script during tag builds receives a write-capable token.

Recommended fix: set top-level `contents: read`; grant `contents: write` only to the final release
upload job or step.

Suggested labels: `kind:bug`, `area:ci`, `priority:medium`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 21. Runtime container runs as root

Severity: Medium
Category: security

Evidence: `Dockerfile:17`, `Dockerfile:70-71`

The runtime image never sets `USER`, so uvicorn runs as root. An app RCE or image-processing exploit
would have root privileges inside the container and on mounted volumes.

Recommended fix: create an unprivileged user, chown writable directories, and run the service with
`USER <uid>`.

Suggested labels: `kind:chore`, `priority:medium`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 22. Install scripts execute/download unsigned remote artifacts

Severity: Medium
Category: security

Evidence: `install.sh:17-20`, `install.sh:96-105`, `install.ps1:21-24`, `install.ps1:85-93`

The installers pipe remote Astral installer scripts to a shell and download/install the first wheel
asset without checksum, signature, or attestation verification. A compromised endpoint or release asset
leads directly to local code execution.

Recommended fix: publish checksums/attestations for wheels, verify before install, and avoid pipe-to-shell
installers where possible.

Suggested labels: `kind:chore`, `area:deps`, `priority:medium`, `effort:M`, `model:sonnet`, `model-effort:medium`

### 23. Production build always emits source maps

Severity: Low
Category: security

Evidence: `frontend/vite.config.ts:21-24`

Production builds publish source maps by default. Public deployments expose original TypeScript/React
source, route names, storage keys, and auth/client implementation details, increasing reconnaissance
value after any other bug.

Recommended fix: make source maps conditional on a non-production build flag, or publish them only to
a private error-reporting store.

Suggested labels: `kind:chore`, `priority:low`, `effort:S`, `model:sonnet`, `model-effort:medium`

### 24. CI does not gate dependency vulnerability audits

Severity: Low
Category: code-quality

Evidence: `Makefile:296`; no Dependabot/Renovate config found.

The canonical `make ci` pipeline has tests, lint, typecheck, frontend build/test/lint/knip, but no
Python/npm vulnerability audit or container scan. Vulnerable dependencies can remain green until
manually audited.

Recommended fix: add scheduled and PR audit jobs for Python and pnpm, plus Dependabot/Renovate. Handle
private/local packages explicitly.

Suggested labels: `kind:chore`, `area:ci`, `area:deps`, `priority:low`, `effort:M`, `model:sonnet`, `model-effort:medium`
