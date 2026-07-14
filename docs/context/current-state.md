# Current state

## Agent Index

- **Kind:** architecture
- **Status:** active
- **Read when:** starting work or checking the repository's current operational shape.
- **Search terms:** current state, active architecture, risks, verification.

The application is a local-first FastAPI and React 19 system packaged as one Python wheel. Its pipeline uses a
24-stage registry with per-page and project-stage state. XState v5 tool machines manage the frontend workflow,
and `pdomain-ops` provides shared page lifecycle storage.

Start with the [architecture overview](../architecture/01-overview.md). Then see the
[pipeline architecture](../architecture/03-pipeline.md), [frontend architecture](../architecture/04-frontend.md),
and [deployment architecture](../architecture/06-deployment.md).

## In-flight work

This migration initializes docgraph and repairs retrieval links. It also removes implemented or superseded
execution documents after preserving their durable content. The migration includes no product feature work.

## Current risks

- Local SQLite tests can show a transient `SQL statements in progress` commit failure under full parallel CI.
  The affected page-text test passed alone and in five repeated parallel runs. No deterministic defect was
  established.
- GPU and remote-backend behavior is not covered as deeply as the CPU, filesystem, and SQLite path in default CI.
- The lint-suppression catalogue requires reconciliation against current source before it can truthfully claim
  completeness.
- Some statechart convergence notes describe registry v2, but the current registry version is 3. Current code
  and generated schemas take precedence until the architecture text is reconciled.

## Verification

The repository gate is `make ci AI=1`. Docgraph completion requires a fresh MCP reindex, zero strict checker
issues, and clean index health.
