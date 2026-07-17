---
kind: handoff
status: "active"
created: "2026-07-17"
created_at: "2026-07-17T09:18:20Z"
owner: CT
branch: master
scope: issue-tracker-migration
worktree: /workspaces/pdomain/pdomain-prep-for-pgdp
base_commit: 6fc5b911118721084c16cc257dbf172147f2c414
supersedes: ""
---

# Issue tracker migration — pickup prompt

## Agent Index

- **Kind:** handoff
- **Status:** active
- **Read when:** picking up the task of clearing this repo's GitHub issue
  tracker into docs.
- **Search terms:** issue tracker migration, roadmap, closed issues archive,
  gh issue delete, docgraph handoff.

## Goal

Clear this repo's GitHub issue tracker by migrating its open backlog into
`docs/roadmap.md`, archiving every issue's full text into Git history, then
deleting the issues. This is the same proven pattern already run on
`pdomain-ocr-cli` (50 issues) and `pdomain-ocr-simple-gui` (37 issues,
roadmap-first).

## Current state

Open issues: 48. Closed issues: 131. Admin confirmed on the repo. Docgraph is
present (`DOCGRAPH.md`). `docs/decisions/` exists with prior ADRs. No
`docs/roadmap.md` yet — it must be authored as part of this migration.

Label breakdown across the 48 open issues:

- `kind:feature` — 43, all `status:backlog`
- `kind:spec` — 1 (`#152`), `status:backlog`
- `kind:bug` — 3, `priority:medium`, `effort:M`/`effort:L`, `area:tests`
- `kind:chore` — 1 (`#146`), `priority:low`, `area:deps` + `area:ci`

44 of the 48 carry `status:backlog`; the remaining 4 (the bugs and the chore)
carry `priority:*`/`effort:*` instead of a `status:*` label.

Representative titles:

- `#198` MIGRATION_NOTES.md in pd-ui
- `#197` Storybook consumer demo
- `#196` Routing — pipeline sub-tabs in ProjectConfigurePage
- `#190` ProjectsPage shell refit
- `#178` Page workbench (HJDecisionCard + Before/After split)
- `#169` Scannos pipeline stage (P)
- `#168` Stage 11 page — ReorderScansStage
- `#156` Files tab — ThumbCard grid + FileToolbar + SourceBanner
- `#152` Spec: pd-ui design handoff — implementation in pd-prep-for-pgdp
- `#146` CI does not gate dependency vulnerability audits
- `#135` Authenticated SSE streams bypass the bearer-token client
- `#132` Progress updates can undo cancellation and continue side effects
- `#131` Postgres adapter does not satisfy the database contract

Read on whether this is real backlog: yes. The 43 `kind:feature` issues
(`#156`–`#198`) are concrete UI-component and page-porting tasks that
implement the `pd-ui` design handoff bundle inside this frontend-heavy
consumer app — `#152` is their tracking/spec issue, and it points at a real
spec (`docs/specs/2026-05-24-pd-ui-design-handoff-implementation.md`) and plan
(`docs/plans/pd-ui-design-handoff-implementation.md`) already checked in.
Expect this pattern to continue: pd-ui/porting issues, stage pages, modals,
panels. The 4 bug/chore issues (`#131`, `#132`, `#135`, `#146`) trace back to
a real source document too — `docs/research/2026-05-22-deep-code-review-security-scan.md`
— and describe concrete defects (e.g. `#131`: the Postgres adapter lacks
required `IDatabase` methods and will raise `NotImplementedError` at runtime).
None of the 48 look stale or abandoned — this is genuine pending work worth
carrying into a roadmap, not a tracker to just wipe.

## Decisions the next session must make

- Scope: migrate the 48 OPEN issues (recommended). The 131 CLOSED issues are
  completed history; archiving and deleting them too is OPTIONAL and only
  applies if the goal is a full tracker wipe rather than clearing the open
  backlog.
- Roadmap-first is REQUIRED here — the open issues are unfinished backlog.
  Never delete an issue without first carrying its content into
  `docs/roadmap.md` (for open work) or the closed-issues archive doc (for
  closed work).

## The proven procedure

1. Pull each in-scope issue's full content:
   `gh issue view N --repo pdomain/pdomain-prep-for-pgdp --json number,title,author,createdAt,closedAt,state,stateReason,labels,body,comments,url`
   Save each to a scratch directory and record a `sha256sum` of the raw JSON
   for later verification.
2. If migrating open backlog: author `docs/roadmap.md`, mirroring the shape of
   `../pdomain-ocr-cli/docs/roadmap.md` — docgraph frontmatter, Agent Index,
   Goal/Architecture/Tech Stack/Global Constraints sections, work clusters,
   and Now/Next/Later grouped by theme. Tag every roadmap item with its
   source issue number, e.g. `#169`.
3. Render `docs/decisions/2026-07-DD-closed-issues-archive.md` (adjust the
   date): docgraph frontmatter (Kind: decision, Status: retired) + Agent
   Index + Context/Decision/Consequences/Supersedes sections, then one
   `## #N — title` section per archived issue holding its metadata, labels,
   URL, full body verbatim, and all comments verbatim. Add
   `<!-- markdownlint-disable -->` immediately after the frontmatter block —
   the verbatim issue text will not conform to markdownlint rules.
4. Commit the roadmap and the archive together in one commit. Then, in a
   SECOND commit, `git rm` the archive file, citing the add-commit's SHA and
   `git show <sha>:<path>` in the removal commit message as the retrieval
   path. Git history is the permanent tombstone; the roadmap stays live and
   readable.
5. Only after the archive commit exists: delete each migrated issue with
   `gh issue delete N --repo pdomain/pdomain-prep-for-pgdp --yes`. This is
   PERMANENT. Get an explicit human "go" before running any delete.

## Gotchas

The `pre-commit-update` hook bumps `.pre-commit-config.yaml` on every commit
and can abort the commit. If it fires: revert the bump
(`git checkout -- .pre-commit-config.yaml`) and commit with
`SKIP=pre-commit-update git commit ...`. Validate new/changed docs with
`uv run pre-commit run markdownlint-cli2 --files <doc>` and the docgraph check
MCP tool — an orphan-doc advisory on the archive file (before its removal
commit) is expected and fine.

## Pointers

- `docs/roadmap.md` — target file to author (does not exist yet).
- `docs/decisions/` — where the closed-issues archive doc is rendered, then
  removed.
- `DOCGRAPH.md` — repo docgraph conventions.
- `../pdomain-ocr-cli/docs/roadmap.md` — shape reference, already migrated.
- `../pdomain-ocr-simple-gui/docs/roadmap.md` — shape reference,
  roadmap-first migration, already migrated.

## Reference worked examples

- `pdomain-ocr-cli`: archive commit `9498407` (local in that repo).
- `pdomain-ocr-simple-gui`: roadmap+archive commit `ec3979f`, then removal
  commit `7f3be6b` (local in that repo).
- The step-by-step pattern is also captured in agent memory under
  `closed-issue-archive-pattern`.

## Resume steps

1. `gh issue list --repo pdomain/pdomain-prep-for-pgdp --state open --limit 300 --json number,title,body,labels,comments,url > /tmp/pdomain-prep-for-pgdp-open-issues.json`
2. Read `../pdomain-ocr-cli/docs/roadmap.md` and `../pdomain-ocr-simple-gui/docs/roadmap.md` as shape references.
3. Draft `docs/roadmap.md` grouping the 43 `kind:feature` + 1 `kind:spec` issues under the `pd-ui` design-handoff theme, and the 3 `kind:bug` + 1 `kind:chore` issues under a separate quality/security theme, tagging every item with its issue number.
