---
Status: active
Owner: CT
Created: 2026-11-12
Last verified: 2026-11-12
Kind: decision
---

# The roadmap is the only forward queue

## Agent Index

- **Kind:** decision
- **Status:** active
- **Last verified:** 2026-11-12
- **Read when:** choosing where open work, shipped behavior, or a new repository idea is written down.
- **Search terms:** roadmap consolidation, forward queue, repository boundary, July pipeline review.

## Context

Open work was written in three places that drifted: the roadmap, the July 2026 pipeline review, and the intent map. The
roadmap still listed finished P0–P3 items. The July review's summary still called Wave 1 defects open after its own Wave
1 table. [Book path contracts](../architecture/03-pipeline.md#book-path-contracts) marked them shipped.

Hosted deployment, a GPU worker, and shared language data were parked in the roadmap's deferred section. That section
did not say which repository should own them.

## Decision

The [roadmap](../plans/roadmap.md) is the only forward queue for this app. Shipped behavior stays in
`docs/architecture/`. [Repository boundary](../architecture/10-repository-boundary.md) says which repository should own
future work.

The [July pipeline review](../plans/2026-07-21-pipeline-completion-review.md) remains the review record. It is not a
second queue. Where it disagrees with architecture about Waves 0 and 1, architecture wins.

The intent map keeps rejected directions and points at the roadmap for parked work. It does not repeat the queue.

## Consequences

Someone picking up work starts at Wave 2 on the roadmap. A proposal for any of these is judged against the repository
boundary before it is added to this app:

- Postgres hosting
- a shared GPU container
- n-gram hyphen data
- a shared scanno library
- PDF export

The design prototype at `docs/plans/design_handoff_pgdp_app/` stays in the tree as a design reference. It is not moved
into architecture.

## Supersedes / Superseded-by

This decision does not supersede [AD-4](architecture-decisions.md), the local-first priority. It supersedes the practice
of keeping a second active queue in the July review and the intent map.

Nothing supersedes this decision.
