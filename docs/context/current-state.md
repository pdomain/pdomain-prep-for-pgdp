# Current state

## Agent Index

- **Kind:** architecture
- **Status:** active
- **Last verified:** 2026-11-12
- **Read when:** starting work or checking the repository's current operational shape.
- **Search terms:** current state, active architecture, risks, verification.

The application is a local-first FastAPI and React 19 system packaged as one Python wheel. Its pipeline uses a
24-stage registry with per-page and project-stage state. XState v5 tool machines manage the frontend workflow,
and `pdomain-ops` provides shared page lifecycle storage.

Start with the [architecture overview](../architecture/01-overview.md). Then see the
[pipeline architecture](../architecture/03-pipeline.md), [frontend architecture](../architecture/04-frontend.md),
and [deployment architecture](../architecture/06-deployment.md).

## In-flight work

Wave 0 and Wave 1 shipped. The forward queue is the [roadmap](../plans/roadmap.md), starting at Wave 2.
The July review is the record of that sequencing. Hosted, GPU-worker, and shared-library ideas are in
[Repository boundary](../architecture/10-repository-boundary.md).

Shipped numbering, Source/grayscale, shared settings, and July safeguards now live in architecture docs.
See [numbering runs](../architecture/08-page-numbering.md),
[image preparation and settings](../architecture/09-image-prep-settings.md), and
[backend safeguards](../architecture/02-backend.md#suite-identity-authentication-and-job-safeguards).

## Current risks

The 2026-11-07 warning audit checked all 36 age-flagged documents against repository source, configuration,
tests, or their normative pointers. Current architecture distinguishes deferred/project writes from synchronous
rollback-capable page writes. Hosted workflows are absent; release commands are local scripts.
Historical decisions and scanno research keep their original context. External research and live deployments
were not revalidated by this repository audit.

- Local SQLite tests can show a transient `SQL statements in progress` commit failure under full parallel CI.
  The affected page-text test passed alone and in five repeated parallel runs. No deterministic defect was
  established.
- GPU and remote-backend behavior is not covered as deeply as the CPU, filesystem, and SQLite path in default CI.
- Some tests intentionally construct registry-version 2 projects to verify automatic migration to the current
  registry version 3. New projects are stamped with version 3.
- The lint-deviation guide records configured deviations and rationale classes. It does not duplicate every
  source-local suppression and line number; repository search is the authoritative inline inventory.

## Verification

The repository gate is `make ci AI=1`. Docgraph completion requires a fresh MCP reindex, zero strict checker
issues, and clean index health.
