---
Status: active
Owner: CT
Created: 2026-11-09
Last verified: 2026-11-09
Kind: decision
---

# GitHub Issues cutover to repo docs

## Agent Index

- **Kind:** decision
- **Status:** active
- **Last verified:** 2026-11-09
- **Read when:** tracing a former GitHub issue number, filing new work, or checking what the cutover preserved.
- **Search terms:** GitHub issues cutover, migration, former GH, pd-ui design handoff, #152, issue ledger,
  delete issues.

Open work for this repository lives in repo docs, not GitHub Issues. Defects with evidence live in
[`docs/issues/`](../issues/README.md). Feature work lives in the [roadmap](../plans/roadmap.md). The ledger
below maps each of the 48 open GitHub issues to where its content went. Deleting them on GitHub waits for the
owner's go.

## Context

On 2026-11-09, `pdomain/pdomain-prep-for-pgdp` had 48 open and 131 closed GitHub issues:

- Four came from the 2026-05-22 deep code review: bugs #131, #132, #135 and chore #146.
- Spec issue #152 and its 43 `kind:feature` issues, #156–#198, came from the pd-ui design handoff.

The handoff plan and spec behind #152 had already been retired in `fdd88cd`, as superseded by the statechart
convergence. The issues stayed open on GitHub after that.

The pattern follows `../pdomain-ocr-cli/docs/decisions/2026-07-19-github-issues-cutover.md`: feature work goes
to the roadmap with `former GH #NNN` tags, defects go to governed issue reports, and GitHub keeps no copy.

## Decision

1. **Check each issue against the code before migrating it.** Every row below was checked at `14f0ba8`. Stale
   text was not copied; each destination records the current state.
2. **The four review findings become governed reports** in `docs/issues/`, one per issue.
3. **#152 and its 43 features go to the roadmap** under "Former pd-ui design handoff". Shipped and superseded
   items appear only in this ledger. Items with remaining work appear on the roadmap, either as new work or
   pointing at the existing W-item or intent-map entry that already tracks them.
4. **Do not file routine work on GitHub Issues.** If an issue arrives there, move it into the roadmap or a
   governed report.
5. **Delete the 48 migrated issues from GitHub only after the owner says go.** This document is committed and
   pushed first, so it is the record. The owner gave the go on 2026-11-09.
6. **Archive every issue verbatim in git history before deleting any.** All 179 issues, open and closed, with
   their comments, are in commit `17d3dcb`; see [Verbatim archive](#verbatim-archive).
7. **Delete the 131 closed issues only after a separate owner go.** They are archived, but deletion cannot be
   undone, and the go given for the 48 open issues does not cover them.

## Consequences

- Agents plan from the roadmap, the intent map, and `docs/issues/`. GitHub issue numbers are provenance only.
- After deletion, former issue URLs under `github.com/pdomain/pdomain-prep-for-pgdp/issues/N` stop resolving.
  Closed issues stay on GitHub until the owner decides otherwise.
- Former issue text, including comments, is recoverable only from the archive commit.
- Cross-repo work still uses `ConcaveTrillion/ocr-container-meta`.

## Supersedes / Superseded-by

Supersedes GitHub Issues as the open-work tracker for this repository. It does not supersede the roadmap,
the intent map, or architecture docs.

## Migration ledger

### Review findings

| Former GH | Check at `14f0ba8` | Destination |
| --- | --- | --- |
| #131 Postgres adapter vs `IDatabase` | Still open: 8 methods missing, search raises, no fail-fast | [Postgres adapter issue](../issues/2026-11-09-postgres-adapter-incomplete.md); roadmap D2 links it |
| #132 Progress undoes cancellation | Still open: `update_progress` writes the stale running job; unzip still enqueues thumbnails | [Cancel overwrite issue](../issues/2026-11-09-progress-overwrites-cancel.md); related to W3.6 |
| #135 SSE bypasses bearer client | Narrowed: apikey mode fixed by session cookie `e0b83cf`; JWT mode still fails | [JWT SSE issue](../issues/2026-11-09-jwt-sse-auth.md) |
| #146 No dependency audit in CI | Still open: no audit step, no Dependabot or Renovate, no workflows | [Dependency audit issue](../issues/2026-11-09-dependency-audit-gate.md) |

### pd-ui design handoff

Spec issue #152 tracked these features. Its plan tasks 4–46 map to #156–#198 in order. Classes: **shipped** means the
capability exists; **partial** means some of it exists; **superseded** means the target no longer fits the
pipeline tool-slot model; **open** means not built. "Roadmap" means the
[roadmap section](../plans/roadmap.md#former-pd-ui-design-handoff-gh-152-156198).

| Former GH | Title | Class | Evidence or destination |
| --- | --- | --- | --- |
| #152 | Spec: pd-ui design handoff | superseded | Plan and spec retired in `fdd88cd`; roadmap section |
| #156 | Files tab: cards, toolbar, banner | shipped | `tools/SourceToolFiles.tsx` |
| #157 | Multi-select + BulkBar | shipped | `SourceToolFiles.tsx`, `SourceTool.tsx` |
| #158 | Insert dialog + role backend | shipped | `InsertDialog`; `POST /projects/{id}/pages/insert` |
| #159 | Per-page workbench + step settings | shipped | `tools/SourceToolWorkbench.tsx`, `SourceToolSettings.tsx` |
| #160 | Grayscale Overview + Pages | shipped | `tools/grayscale/GrayscaleOverview.tsx`, `GrayscalePages.tsx` |
| #161 | Grayscale Step Settings | shipped | `grayscale/GrayscaleSettings.tsx`, `GrayscalePipelineEditor.tsx` |
| #162 | Grayscale before/after viewer | shipped | `grayscale/GrayscaleWorkbench.tsx` |
| #163 | Crop grid refit | partial | `tools/PagesGridTool.tsx` flags and filters; density toggle not confirmed |
| #164 | Crop bulk re-run | partial | Generic stage re-run only; roadmap H2 |
| #165 | Inline crop bbox editor | partial | `PagesGridTool.tsx` editor; apply-to-all-flagged not confirmed |
| #166 | Crop Overview + Step Settings | partial | No overview tab; roadmap H2 |
| #167 | Manual drag-reorder | shipped | `tools/PageOrderTool.tsx`, `PATCH /pages/reorder` |
| #168 | Page-order stage | partial | `PageOrderTool.tsx` ledger; folio detection is roadmap H2 |
| #169 | Scannos pipeline stage | superseded | `wordcheck` is the stage; scanno tables run in text post-processing |
| #170 | Inline suspicion popover | superseded | `tools/WordcheckTool.tsx`, `TextReviewTool.tsx` |
| #171 | Per-book candidate triage | partial | Wordcheck accept and promotion routes; no separate candidate store |
| #172 | Global rule library | open | Roadmap H2 |
| #173 | Hyphen-join Overview | shipped | `tools/HyphenJoinTool.tsx` Overview tab |
| #174 | Hyphen-join Undecided + Queue | partial | Queue tab ships; n-gram evidence is roadmap H1 |
| #175 | Auto-joined validation | shipped | HyphenJoinTool Joined tab |
| #176 | Mismatch report | shipped | HyphenJoinTool Mismatch tab |
| #177 | Hyphen-join Step Settings | open | Placeholder tab; roadmap H1 and H2 |
| #178 | Hyphen-join page workbench | shipped | HyphenJoinTool workbench tab |
| #179 | Validation panel | shipped | `tools/ValidationTool.tsx` |
| #180 | Per-check auto-fix endpoints | open | Roadmap H1 |
| #181 | QualityBanner + flag taxonomy | superseded | Per-tool flags; StageStrip flagged state |
| #182 | PageThumb/PageRow flag pills | superseded | Per-tool grids |
| #183 | Stage-jump popover | open | Roadmap H1 |
| #184 | Workbench header + edit modes | superseded | Legacy PageWorkbench replaced by the pipeline shell |
| #185 | ArtifactViewer + overlays | partial | `components/ArtifactViewer.tsx`; split overlay is roadmap H2 |
| #186 | Per-stage controls drawer | superseded | Each tool has its own Settings tab |
| #187 | Right drawer, four panels | superseded | `components/workbench/PageDrawer.tsx` |
| #188 | Collapsible text review pane | superseded | `TextReviewTool.tsx`, `WordcheckTool.tsx` |
| #189 | text_zones labeling canvas | open | Placeholder canvas; roadmap H2 |
| #190 | Projects page split pane | shipped | `pages/projects/ProjectsPage.tsx` |
| #191 | Attributes panel | shipped | `attributesPanel` machine; `/projects/{id}/attributes/{section}` |
| #192 | First-time empty hero | shipped | `pages/projects/ProjectsEmpty.tsx` |
| #193 | Manage tab | partial | Archive, clean, delete ship; save a copy is roadmap H2 |
| #194 | Desktop upload modal | shipped | Create-project dialog in `ProjectsPage.tsx` |
| #195 | Mobile upload fallback | open | Roadmap H1 |
| #196 | `?stage=` routing | shipped | `/projects/:projectId/pipeline?stage=<id>` |
| #197 | Storybook parity demo | superseded | No Storybook; parity target does not fit the tool-slot model |
| #198 | pd-ui MIGRATION_NOTES | superseded | App uses only pd-ui shell, icons, primitives, and canvas |

Totals for #156–#198: 18 shipped, 9 partial, 10 superseded, 6 open.

The feature rows come from a source inspection, not a browser run. Rows marked "not confirmed" name details
the inspection did not reach.

The feature issues' comments, from 2026-05-24 and 2026-05-25, are status notes. Most slices were first marked
blocked on pd-ui Phase 2, then ready once pd-ui shipped stage-level exports such as
`@concavetrillion/pd-ui/stages/Source`, `stages/Grayscale`, and `stages/PageWorkbench`. The app never adopted
those exports; it built the stage surfaces as local pipeline tools instead.

## Verbatim archive

All 179 issues on `pdomain/pdomain-prep-for-pgdp`, 48 open and 131 closed, were exported on 2026-11-09 with
their bodies, comments, labels, milestones, dates, and GraphQL node IDs. Issue numbers missing from #1–#198
are the 19 pull requests, which were not touched.

- Archive commit: `17d3dcb`. Removal commit: `95795ca`.
- Full-file SHA-256: `ba9fb61a5a3d04f1f91c8bd72530cc96bdf6034ba80e51c5d0df264fc29b8459`.
- Section digest: SHA-256 of each issue's section, starting with the newline before its `## #N` heading and
  ending just before the next issue's newline.
- Trailing whitespace was stripped from each line so the repo's whitespace hook would not rewrite the file.
  Nothing else was changed.

```bash
git show 17d3dcb:docs/decisions/2026-11-09-github-issues-archive.md
```

The closed issues were archived but not re-checked against the code. A closed state on GitHub is not proof
that the work shipped.

## Deletion journal

Rows are written before deletion and updated after it. Deletion uses `gh issue delete`.

| Former GH | Node ID | Section digest | Deleted |
| --- | --- | --- | --- |
| #131 | `I_kwDOSUyCB88AAAABDItoUw` | `2811995adf54010e66dcdf8c3b571785ff92f309f1f8b2c9099d9656b7dde490` | pending |
| #132 | `I_kwDOSUyCB88AAAABDItoiA` | `2b282709aba89121e18d258d7e1186219604d2fa7ca2a678295e4cdba495b70c` | pending |
| #135 | `I_kwDOSUyCB88AAAABDItpSQ` | `89f87bb44f32c750d3fcb6d0c57bec3063a27415c1114b0f98ecf7061de89276` | pending |
| #146 | `I_kwDOSUyCB88AAAABDItr4g` | `d23ea7076079dcb2f5039f2048d5a618320844186e5129187b5cdd34649b5e83` | pending |
| #152 | `I_kwDOSUyCB88AAAABDPhoGQ` | `db60705296044de76877dd73804bdc446142a8216dfa7c2d27a557515f939b77` | pending |
| #156 | `I_kwDOSUyCB88AAAABDPhstg` | `4cc309be634f4accac175b594d87d18db6d81cac29cac18a730dc819dd1e0f5f` | pending |
| #157 | `I_kwDOSUyCB88AAAABDPhs9g` | `7a3861b08c262cf20f91f67aed69005ef530d7a322ba6e888816064a31abf192` | pending |
| #158 | `I_kwDOSUyCB88AAAABDPhtOA` | `3685f484e8299243cca252cdab18155b76e02dcb17a77c3c198a064ffeb4d761` | pending |
| #159 | `I_kwDOSUyCB88AAAABDPhtdg` | `1b29aa4db0d7c92ab9641b550ef8c1b1a28e1177305919740b4160d332eec239` | pending |
| #160 | `I_kwDOSUyCB88AAAABDPhttw` | `049d027bcd65b61558c075f2e10922a065cc546a606e3f97939071d60070afdf` | pending |
| #161 | `I_kwDOSUyCB88AAAABDPhuCQ` | `4146d7149379b83310e980279a9e9c91eb268a4bcdaaeb3aad9477dcb7a39377` | pending |
| #162 | `I_kwDOSUyCB88AAAABDPhumg` | `526fdbb7fc62b6ee203788b11f0b23edc31f446fedd4b0dac0c7ac17ed97d5f8` | pending |
| #163 | `I_kwDOSUyCB88AAAABDPhvDA` | `f80a8d67b1717310db0086cadabb8b3b473bcf1913d277c4583f6de261c933fd` | pending |
| #164 | `I_kwDOSUyCB88AAAABDPhvPg` | `e5b0ea075f5251c222e83d45d47d8efdd76ac18fe475c1a4485c84e37098c5b0` | pending |
| #165 | `I_kwDOSUyCB88AAAABDPhvbw` | `ca455ff40938a74c5fae6bb9c3ba1f95eecdcb2a696995ef387503b2be27757e` | pending |
| #166 | `I_kwDOSUyCB88AAAABDPhvqQ` | `eff8e4f8d7e102edfca78701db6cebfadc5dc4be570b2f2305bfd9994b351b56` | pending |
| #167 | `I_kwDOSUyCB88AAAABDPhv4g` | `5278f5091f8f2b41980c7f94333619c976f7585faa5da8e78d453320f130d48d` | pending |
| #168 | `I_kwDOSUyCB88AAAABDPhwJQ` | `082b6a094eab89beae55d2cee6efe7aec5e35d26bab51f9cf458a04e0775a55e` | pending |
| #169 | `I_kwDOSUyCB88AAAABDPhwWA` | `771fc4fdbbdc90b3bb6c3e1d80e8e268515819b9a6fc83b3cae6372798fc085b` | pending |
| #170 | `I_kwDOSUyCB88AAAABDPhwjQ` | `6a70480870ef659992736f0206a073752715ad240e245c0cd02517393fa44c56` | pending |
| #171 | `I_kwDOSUyCB88AAAABDPhwzA` | `42c1e66d24d7393e3a339c518c2fd238c2ca359d4c4b5ed60625a80f447a038d` | pending |
| #172 | `I_kwDOSUyCB88AAAABDPhxjw` | `9a41c8dc1308f79d93ba894186375586f967243acc3e90d7eadb6cd61b5fe267` | pending |
| #173 | `I_kwDOSUyCB88AAAABDPhx2g` | `5341274bec6bb0c167da2872f3048018f4ecc13d2b4551964194fffa6e68d945` | pending |
| #174 | `I_kwDOSUyCB88AAAABDPhyDg` | `d1acfef2d7a69a67f5d37478098a5eac519131dc8f1f9cb9cceeaccfff2d9043` | pending |
| #175 | `I_kwDOSUyCB88AAAABDPhyYA` | `de772f913c290d614bcb0612edb25b143141acfd087f2f387db2712eb190938b` | pending |
| #176 | `I_kwDOSUyCB88AAAABDPhylQ` | `181909175c00d84ac50b0cf10a22090dfcc76527f64919b661530fb6fb2d1d3b` | pending |
| #177 | `I_kwDOSUyCB88AAAABDPhyxg` | `f759f1155c935e28c3964db921e0ebf97f2328cad9c4c42c55edf9d20e460e94` | pending |
| #178 | `I_kwDOSUyCB88AAAABDPhy_A` | `ed6e204d7a634a6620c6ef05ac84bf35a8a682aceb0bc1c487ba8f700d7e632a` | pending |
| #179 | `I_kwDOSUyCB88AAAABDPhzPA` | `84a707f43fe564437756d7ae28c0f533a3eb04549d954e76da9727e41013dfa3` | pending |
| #180 | `I_kwDOSUyCB88AAAABDPhzfQ` | `b124d789b3984681e527fff8412e5d07cfe559c9c4357ad469088a0a1e0d7d40` | pending |
| #181 | `I_kwDOSUyCB88AAAABDPh0Sw` | `b80cbcbbec2535c16504dbf64743357b48f4aca429065e61afb85e1920435415` | pending |
| #182 | `I_kwDOSUyCB88AAAABDPh0fw` | `9229dd0202514867091223e52225dc70fb992ee74ef769c63235cab2f90b83fb` | pending |
| #183 | `I_kwDOSUyCB88AAAABDPh0rg` | `dbacdf8bad342c23876e9db8e8a0844c657a21fe3aa0977edec34583a8b6a285` | pending |
| #184 | `I_kwDOSUyCB88AAAABDPh01Q` | `7edcfb833ee243508d69fd418aa17c58d65c5bef99ac0aba9a81c6f217b6c4c5` | pending |
| #185 | `I_kwDOSUyCB88AAAABDPh1Fg` | `d951861e2eeb73119f9352eae272f83daee12c0412242bd2cae0b9b848485f31` | pending |
| #186 | `I_kwDOSUyCB88AAAABDPh1Ww` | `e56fb6c4d9c4c7f90f368ddfc3bbbdadc2b7c504bf8b1fd7efefc6fc3ff9b26c` | pending |
| #187 | `I_kwDOSUyCB88AAAABDPh1kw` | `6f5558179a678578f6817168849265a47af45a41690d663e21ab4fa5b42fb937` | pending |
| #188 | `I_kwDOSUyCB88AAAABDPh1xQ` | `71f01e885be8b6b24ccf4c57da7326697c137754abcb647e85528c41119b09a2` | pending |
| #189 | `I_kwDOSUyCB88AAAABDPh1_A` | `3f089fb4e7cd577fdb702f8ccf782d95e569fca4edb2db109971bd0981f52528` | pending |
| #190 | `I_kwDOSUyCB88AAAABDPh2PA` | `2dd55c0ffcffe5d9e2bfaa15ac97aca50ef188abbb123c420d809c5df9fe4651` | pending |
| #191 | `I_kwDOSUyCB88AAAABDPh3Aw` | `87a9171b2d6092f1560d24ff9ddc4ff4ed014ad78498b75c381adff344c4d201` | pending |
| #192 | `I_kwDOSUyCB88AAAABDPh3SQ` | `03a3f1f3b49a8ec5a345df946bc4cc0fd753417de8001817e556edc337ef0ac3` | pending |
| #193 | `I_kwDOSUyCB88AAAABDPh3fA` | `1881f3b09baba6439a4afc85edce5f3b413e535e2b1fd34040f15f658c653062` | pending |
| #194 | `I_kwDOSUyCB88AAAABDPh3tw` | `9730c30445652f1895336ca0d63c280e05b691195dcf7d70e91141d632801c0e` | pending |
| #195 | `I_kwDOSUyCB88AAAABDPh3-Q` | `6af3e401f3f0ed1fddcd1c482cc6912fb7b93fc4663c3cac8929e2872f9ba9ea` | pending |
| #196 | `I_kwDOSUyCB88AAAABDPh4Og` | `8e309879ca108326babc654d5f2f938f9cf4b7ac2cfd8897ca81190f0cc7f596` | pending |
| #197 | `I_kwDOSUyCB88AAAABDPh4dg` | `e1750df6a378dc3f4b2706f7a3ace4a73938ad2fa7b1039cbdf804d361d8d4ab` | pending |
| #198 | `I_kwDOSUyCB88AAAABDPh4ug` | `90bf547980ff21f808f386c301bf66bba990246d4d424a471b45868f5ff733e9` | pending |

## Migration manifest

```text
GITHUB ISSUE MIGRATION MANIFEST
  Repository: pdomain/pdomain-prep-for-pgdp
  Branch: worktree-docs-github-issue-migration (merged to master)
  Code checked at: 14f0ba8
  Open issues discovered: 48
  Governed issue reports created: 4 (#131, #132, #135, #146)
  Roadmap items: #152 and #156–#198 (new work in H1, pointers in H2)
  Verbatim archive: 179 issues with comments, 17d3dcb (removed in 95795ca)
  Closed issues: 131, archived, still on GitHub pending a separate owner go
  GitHub issues deleted: see the deletion journal
```
