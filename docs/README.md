# docs/

## Agent Index

- **Kind:** process
- **Status:** active
- **Read when:** locating current architecture, intent, decisions, plans, research, or runbooks.
- **Search terms:** documentation index, architecture, plans, process, context.

This index explains where each type of repository documentation belongs and links to the current set.

| Folder | Purpose | Use when |
| --- | --- | --- |
| `architecture/` | How the system works today. | Capturing current modules, data flow, contracts, and diagrams. |
| `archive/` | Cold storage for the nine active folders. | A doc is shipped, superseded, or abandoned. |
| `decisions/` | Dated, append-only ADRs. | Recording a choice, context, alternatives, and consequences. |
| `plans/` | Active execution — what order to make a spec real. | Sequencing work for an approved spec. |
| `process/` | Cross-cutting workflow conventions. | Capturing verification, merge, release, and other team practices. |
| `research/` | Investigation in progress. Messy by design. | Exploring before committing to a design. |
| `runbooks/` | Operational reference. | An on-call or ops task needs a recipe. |
| `specs/` | Aspirational, pre-implementation design. | Describing what to build, before code. |
| `templates/` | Issue, spec, plan, ADR boilerplate. | Adding a starter template for a new doc type. |
| `usage/` | How to consume this app, tool, or library. | A user or integrator needs usage guidance. |

Empty folders are intentional and tracked via `.gitkeep`.

Active docs map to GitHub issues. See this repository's issue tracker for their status. The layout follows the
workspace standard in `/workspaces/ocr-container/docs/README.md`.

## Current documentation

- Context: [current state](context/current-state.md), [intent map](context/intent-map.md), and
  [decisions and tombstones](context/decisions.md).
- Architecture: [overview](architecture/01-overview.md), [backend](architecture/02-backend.md),
  [pipeline](architecture/03-pipeline.md), [frontend](architecture/04-frontend.md),
  [events and jobs](architecture/05-events-and-jobs.md), [deployment](architecture/06-deployment.md),
  [testing](architecture/07-testing.md), and
  [statechart convergence](architecture/statechart-convergence-notes.md).
- Durable decisions: [architecture decisions](decisions/architecture-decisions.md) and
  [API-key server-side proxy](decisions/2026-05-23-apikey-server-side-proxy.md).
- Plans: [roadmap](plans/roadmap.md),
  [compute settings backlog](plans/2026-06-08-compute-settings-panel-backlog.md),
  [page-numbering runs](plans/2026-06-17-page-numbering-runs-model.md),
  [GPU/shared settings tiers](plans/grayscale-gpu-and-shared-settings-tiers.md),
  [hi-fi deferred fixes](plans/hifi-deferred-items-fixes.md), and
  [loader/source/grayscale completion](plans/hifi-loader-source-grayscale-complete.md).
- Process and operations: [lint deviations](process/lint-deviations.md),
  [writing style](process/writing-style.md), and [local upgrade flow](runbooks/dev-local-upgrade-flow.md).
- Research: [scanno findings](research/findings-scannos.md).
