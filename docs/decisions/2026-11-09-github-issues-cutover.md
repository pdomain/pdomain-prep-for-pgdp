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
   undone, and the go given for the 48 open issues does not cover them. The owner gave that go on 2026-11-09.

## Consequences

- Agents plan from the roadmap, the intent map, and `docs/issues/`. GitHub issue numbers are provenance only.
- After deletion, former issue URLs under `github.com/pdomain/pdomain-prep-for-pgdp/issues/N` stop resolving.
  The 131 closed issues are deleted too, so no issue URL in this repository resolves.
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

Rows are written before deletion and updated after it. Deletion uses `gh issue delete`. After the 48 deletions
on 2026-11-09, GitHub reported 0 open and 131 closed issues, and `gh issue view 131` no longer resolved. After
the 131 closed deletions the same day, `gh issue list --state all` returned 0 issues and `gh issue view 1` no
longer resolved.

| Former GH | Node ID | Section digest | Deleted |
| --- | --- | --- | --- |
| #131 | `I_kwDOSUyCB88AAAABDItoUw` | `2811995adf54010e66dcdf8c3b571785ff92f309f1f8b2c9099d9656b7dde490` | 2026-11-09 |
| #132 | `I_kwDOSUyCB88AAAABDItoiA` | `2b282709aba89121e18d258d7e1186219604d2fa7ca2a678295e4cdba495b70c` | 2026-11-09 |
| #135 | `I_kwDOSUyCB88AAAABDItpSQ` | `89f87bb44f32c750d3fcb6d0c57bec3063a27415c1114b0f98ecf7061de89276` | 2026-11-09 |
| #146 | `I_kwDOSUyCB88AAAABDItr4g` | `d23ea7076079dcb2f5039f2048d5a618320844186e5129187b5cdd34649b5e83` | 2026-11-09 |
| #152 | `I_kwDOSUyCB88AAAABDPhoGQ` | `db60705296044de76877dd73804bdc446142a8216dfa7c2d27a557515f939b77` | 2026-11-09 |
| #156 | `I_kwDOSUyCB88AAAABDPhstg` | `4cc309be634f4accac175b594d87d18db6d81cac29cac18a730dc819dd1e0f5f` | 2026-11-09 |
| #157 | `I_kwDOSUyCB88AAAABDPhs9g` | `7a3861b08c262cf20f91f67aed69005ef530d7a322ba6e888816064a31abf192` | 2026-11-09 |
| #158 | `I_kwDOSUyCB88AAAABDPhtOA` | `3685f484e8299243cca252cdab18155b76e02dcb17a77c3c198a064ffeb4d761` | 2026-11-09 |
| #159 | `I_kwDOSUyCB88AAAABDPhtdg` | `1b29aa4db0d7c92ab9641b550ef8c1b1a28e1177305919740b4160d332eec239` | 2026-11-09 |
| #160 | `I_kwDOSUyCB88AAAABDPhttw` | `049d027bcd65b61558c075f2e10922a065cc546a606e3f97939071d60070afdf` | 2026-11-09 |
| #161 | `I_kwDOSUyCB88AAAABDPhuCQ` | `4146d7149379b83310e980279a9e9c91eb268a4bcdaaeb3aad9477dcb7a39377` | 2026-11-09 |
| #162 | `I_kwDOSUyCB88AAAABDPhumg` | `526fdbb7fc62b6ee203788b11f0b23edc31f446fedd4b0dac0c7ac17ed97d5f8` | 2026-11-09 |
| #163 | `I_kwDOSUyCB88AAAABDPhvDA` | `f80a8d67b1717310db0086cadabb8b3b473bcf1913d277c4583f6de261c933fd` | 2026-11-09 |
| #164 | `I_kwDOSUyCB88AAAABDPhvPg` | `e5b0ea075f5251c222e83d45d47d8efdd76ac18fe475c1a4485c84e37098c5b0` | 2026-11-09 |
| #165 | `I_kwDOSUyCB88AAAABDPhvbw` | `ca455ff40938a74c5fae6bb9c3ba1f95eecdcb2a696995ef387503b2be27757e` | 2026-11-09 |
| #166 | `I_kwDOSUyCB88AAAABDPhvqQ` | `eff8e4f8d7e102edfca78701db6cebfadc5dc4be570b2f2305bfd9994b351b56` | 2026-11-09 |
| #167 | `I_kwDOSUyCB88AAAABDPhv4g` | `5278f5091f8f2b41980c7f94333619c976f7585faa5da8e78d453320f130d48d` | 2026-11-09 |
| #168 | `I_kwDOSUyCB88AAAABDPhwJQ` | `082b6a094eab89beae55d2cee6efe7aec5e35d26bab51f9cf458a04e0775a55e` | 2026-11-09 |
| #169 | `I_kwDOSUyCB88AAAABDPhwWA` | `771fc4fdbbdc90b3bb6c3e1d80e8e268515819b9a6fc83b3cae6372798fc085b` | 2026-11-09 |
| #170 | `I_kwDOSUyCB88AAAABDPhwjQ` | `6a70480870ef659992736f0206a073752715ad240e245c0cd02517393fa44c56` | 2026-11-09 |
| #171 | `I_kwDOSUyCB88AAAABDPhwzA` | `42c1e66d24d7393e3a339c518c2fd238c2ca359d4c4b5ed60625a80f447a038d` | 2026-11-09 |
| #172 | `I_kwDOSUyCB88AAAABDPhxjw` | `9a41c8dc1308f79d93ba894186375586f967243acc3e90d7eadb6cd61b5fe267` | 2026-11-09 |
| #173 | `I_kwDOSUyCB88AAAABDPhx2g` | `5341274bec6bb0c167da2872f3048018f4ecc13d2b4551964194fffa6e68d945` | 2026-11-09 |
| #174 | `I_kwDOSUyCB88AAAABDPhyDg` | `d1acfef2d7a69a67f5d37478098a5eac519131dc8f1f9cb9cceeaccfff2d9043` | 2026-11-09 |
| #175 | `I_kwDOSUyCB88AAAABDPhyYA` | `de772f913c290d614bcb0612edb25b143141acfd087f2f387db2712eb190938b` | 2026-11-09 |
| #176 | `I_kwDOSUyCB88AAAABDPhylQ` | `181909175c00d84ac50b0cf10a22090dfcc76527f64919b661530fb6fb2d1d3b` | 2026-11-09 |
| #177 | `I_kwDOSUyCB88AAAABDPhyxg` | `f759f1155c935e28c3964db921e0ebf97f2328cad9c4c42c55edf9d20e460e94` | 2026-11-09 |
| #178 | `I_kwDOSUyCB88AAAABDPhy_A` | `ed6e204d7a634a6620c6ef05ac84bf35a8a682aceb0bc1c487ba8f700d7e632a` | 2026-11-09 |
| #179 | `I_kwDOSUyCB88AAAABDPhzPA` | `84a707f43fe564437756d7ae28c0f533a3eb04549d954e76da9727e41013dfa3` | 2026-11-09 |
| #180 | `I_kwDOSUyCB88AAAABDPhzfQ` | `b124d789b3984681e527fff8412e5d07cfe559c9c4357ad469088a0a1e0d7d40` | 2026-11-09 |
| #181 | `I_kwDOSUyCB88AAAABDPh0Sw` | `b80cbcbbec2535c16504dbf64743357b48f4aca429065e61afb85e1920435415` | 2026-11-09 |
| #182 | `I_kwDOSUyCB88AAAABDPh0fw` | `9229dd0202514867091223e52225dc70fb992ee74ef769c63235cab2f90b83fb` | 2026-11-09 |
| #183 | `I_kwDOSUyCB88AAAABDPh0rg` | `dbacdf8bad342c23876e9db8e8a0844c657a21fe3aa0977edec34583a8b6a285` | 2026-11-09 |
| #184 | `I_kwDOSUyCB88AAAABDPh01Q` | `7edcfb833ee243508d69fd418aa17c58d65c5bef99ac0aba9a81c6f217b6c4c5` | 2026-11-09 |
| #185 | `I_kwDOSUyCB88AAAABDPh1Fg` | `d951861e2eeb73119f9352eae272f83daee12c0412242bd2cae0b9b848485f31` | 2026-11-09 |
| #186 | `I_kwDOSUyCB88AAAABDPh1Ww` | `e56fb6c4d9c4c7f90f368ddfc3bbbdadc2b7c504bf8b1fd7efefc6fc3ff9b26c` | 2026-11-09 |
| #187 | `I_kwDOSUyCB88AAAABDPh1kw` | `6f5558179a678578f6817168849265a47af45a41690d663e21ab4fa5b42fb937` | 2026-11-09 |
| #188 | `I_kwDOSUyCB88AAAABDPh1xQ` | `71f01e885be8b6b24ccf4c57da7326697c137754abcb647e85528c41119b09a2` | 2026-11-09 |
| #189 | `I_kwDOSUyCB88AAAABDPh1_A` | `3f089fb4e7cd577fdb702f8ccf782d95e569fca4edb2db109971bd0981f52528` | 2026-11-09 |
| #190 | `I_kwDOSUyCB88AAAABDPh2PA` | `2dd55c0ffcffe5d9e2bfaa15ac97aca50ef188abbb123c420d809c5df9fe4651` | 2026-11-09 |
| #191 | `I_kwDOSUyCB88AAAABDPh3Aw` | `87a9171b2d6092f1560d24ff9ddc4ff4ed014ad78498b75c381adff344c4d201` | 2026-11-09 |
| #192 | `I_kwDOSUyCB88AAAABDPh3SQ` | `03a3f1f3b49a8ec5a345df946bc4cc0fd753417de8001817e556edc337ef0ac3` | 2026-11-09 |
| #193 | `I_kwDOSUyCB88AAAABDPh3fA` | `1881f3b09baba6439a4afc85edce5f3b413e535e2b1fd34040f15f658c653062` | 2026-11-09 |
| #194 | `I_kwDOSUyCB88AAAABDPh3tw` | `9730c30445652f1895336ca0d63c280e05b691195dcf7d70e91141d632801c0e` | 2026-11-09 |
| #195 | `I_kwDOSUyCB88AAAABDPh3-Q` | `6af3e401f3f0ed1fddcd1c482cc6912fb7b93fc4663c3cac8929e2872f9ba9ea` | 2026-11-09 |
| #196 | `I_kwDOSUyCB88AAAABDPh4Og` | `8e309879ca108326babc654d5f2f938f9cf4b7ac2cfd8897ca81190f0cc7f596` | 2026-11-09 |
| #197 | `I_kwDOSUyCB88AAAABDPh4dg` | `e1750df6a378dc3f4b2706f7a3ace4a73938ad2fa7b1039cbdf804d361d8d4ab` | 2026-11-09 |
| #198 | `I_kwDOSUyCB88AAAABDPh4ug` | `90bf547980ff21f808f386c301bf66bba990246d4d424a471b45868f5ff733e9` | 2026-11-09 |

The 131 closed issues were added after the owner's go on 2026-11-09, before any was deleted.

| Former GH | Node ID | Section digest | Deleted |
| --- | --- | --- | --- |
| #1 | `I_kwDOSUyCB88AAAABB0zNbg` | `a66ad969394b28b5323d6f89e7d130de7730ef66236a39b335ec199c8ff84afd` | 2026-11-09 |
| #2 | `I_kwDOSUyCB88AAAABB0z6hg` | `7730fa860c63df5ce716b04fd6a2ec8fb3bdac48adf942dcca32d43a322fb7d5` | 2026-11-09 |
| #4 | `I_kwDOSUyCB88AAAABB3JIGg` | `ca6d2c328eaf8facfdbcfe29f0aee93678ccd6a6eea34eb26b17f4e3d990ae08` | 2026-11-09 |
| #5 | `I_kwDOSUyCB88AAAABB7GbEg` | `70737b5718a6d35406ac4f4d808c9869bece3964c6124a10a8762e8705d1fb85` | 2026-11-09 |
| #6 | `I_kwDOSUyCB88AAAABB7Gc6Q` | `6bb7b28466a1df8ce38c40b020152eca2765d991f381e013296e70dd20b366e1` | 2026-11-09 |
| #7 | `I_kwDOSUyCB88AAAABB7Gfew` | `ec8b0c3055fa4fdeea035fd7ffa548381781265d01c82e77e82b06eab5af8b2f` | 2026-11-09 |
| #8 | `I_kwDOSUyCB88AAAABB7GjbQ` | `7fab44ce134132610c0be57d22736eb142312069a48af927bd4f5a8ab5104c58` | 2026-11-09 |
| #9 | `I_kwDOSUyCB88AAAABB7G4NQ` | `52f980c3d0e40a5788c01df15462a83e6aef0cf8521e8b784ba35796c643f06a` | 2026-11-09 |
| #10 | `I_kwDOSUyCB88AAAABB7G58Q` | `6e6d2105390c54edc3289a3fb1f8bc8cedf3330b49cffcdf09b23c3bf8f5a275` | 2026-11-09 |
| #11 | `I_kwDOSUyCB88AAAABB7G7Og` | `1bb720ae8cd52c26d6d0324b3df13b08f108e1d2df0a2292272b39fb6803a68c` | 2026-11-09 |
| #12 | `I_kwDOSUyCB88AAAABB7G_nQ` | `2185eb436f5c3b02bbb7c63dc9f1392a32bc0d5ed268c5eda40dbb3498187885` | 2026-11-09 |
| #13 | `I_kwDOSUyCB88AAAABB7HAhA` | `50bc74c7ce79692640ab798709cfea51d7f938f00330e766a59905c87247d719` | 2026-11-09 |
| #14 | `I_kwDOSUyCB88AAAABB7HBAw` | `9a80d5a94bcad7a7bd069fca1219b3bca40820a55d5141d641ace6f5e4c8022e` | 2026-11-09 |
| #15 | `I_kwDOSUyCB88AAAABB7HBXQ` | `bd6438a90a3652592fd8f9d7d05bdb2d3e5378994eaaecc4ad83d3ed7759b368` | 2026-11-09 |
| #16 | `I_kwDOSUyCB88AAAABB7HBvw` | `b91e324e855f649c0dbad656fd79c8ceac5647071faab563a9c365b1e4cca06a` | 2026-11-09 |
| #17 | `I_kwDOSUyCB88AAAABB7NV-w` | `1e1f1e7f908d19b55f37a9a91bde41ab2abb3450d76ae4119b5fd7e4700394f5` | 2026-11-09 |
| #18 | `I_kwDOSUyCB88AAAABB7QoZw` | `26d2671e37a1f70576ff54f022624489f93a289ce50d688c13c45ef77cb5e491` | 2026-11-09 |
| #19 | `I_kwDOSUyCB88AAAABB7QqFQ` | `afe8838aca2dcb89b760f1660202a8343fe430d2b1fd1d6fa6476a510d406661` | 2026-11-09 |
| #20 | `I_kwDOSUyCB88AAAABB7Qqsw` | `7050372fa8e82f2b90349fe363282dc3845f1bda3fb27a0345961e966e6894bd` | 2026-11-09 |
| #21 | `I_kwDOSUyCB88AAAABB7QrTw` | `00d775f143db01d19a6e1689965378117a9f9fe9740e40b396c5142368ead346` | 2026-11-09 |
| #22 | `I_kwDOSUyCB88AAAABB7Qr8Q` | `2f36df542f1751576eac32bfdb0b4538a882f4abea1bf20a1b1568fc71e93805` | 2026-11-09 |
| #23 | `I_kwDOSUyCB88AAAABB7S7Iw` | `a56ec454c50f13ff0816df6474776fec8e12bd687336f8c2ffadb5bf0f9cc351` | 2026-11-09 |
| #24 | `I_kwDOSUyCB88AAAABB7S8bA` | `c1347e9b8507f38ea7c58164f730e48d98144134f3c52023e70f741280bf8d39` | 2026-11-09 |
| #25 | `I_kwDOSUyCB88AAAABB7S-qg` | `bfacab7edf6d345183fcf2f14c10c0ef7f67d00009e803f132571ca03140e9e6` | 2026-11-09 |
| #26 | `I_kwDOSUyCB88AAAABB7TAqQ` | `007a8a48f6854aff6270a6d1085d9e652c02386d1d8ec6ea7d45b3e695514cb5` | 2026-11-09 |
| #27 | `I_kwDOSUyCB88AAAABB7TDGA` | `a305f7a2159d0b3618b22047f36c7ec98d6dfd933c38b04367ad16714a5ddb00` | 2026-11-09 |
| #28 | `I_kwDOSUyCB88AAAABB7TFHA` | `89318c485bf1c2e5621bb75ac83073907ffba6cbbd3d149133729a78eba58f1f` | 2026-11-09 |
| #29 | `I_kwDOSUyCB88AAAABB7THhw` | `2a08779a44bbc03499826978707dac74d0ecde70a5789bf542585234a78dd47d` | 2026-11-09 |
| #30 | `I_kwDOSUyCB88AAAABB7TJKQ` | `20e5c7afed1679fa2b0a2854449cfa02be3893d968e0ce6af4773150b62d1bb3` | 2026-11-09 |
| #31 | `I_kwDOSUyCB88AAAABB7TNZA` | `0a97725702ae5a8ea6319b642291d56f09ae6530bb3a0d1b0cf782b47a12eaf3` | 2026-11-09 |
| #32 | `I_kwDOSUyCB88AAAABB7TQjg` | `00ef7dce698540c55b29c4cecc8670aee62bf621466026a22b50b2a92eb1cfb7` | 2026-11-09 |
| #33 | `I_kwDOSUyCB88AAAABB7TVpg` | `602db245952dce421f172c30ad8d551b6a3341271a4fc86da0507abd480bc6d7` | 2026-11-09 |
| #34 | `I_kwDOSUyCB88AAAABB7TVug` | `11881b6f0213d375ad8a94ce052f77400fcfabaaaeb8b91dac075a554d2e3911` | 2026-11-09 |
| #35 | `I_kwDOSUyCB88AAAABB7TYOQ` | `7156b6379b213c085548a675ca9e084d9ae9a240e53c61fa6c278d825efdc05e` | 2026-11-09 |
| #36 | `I_kwDOSUyCB88AAAABB7TZCw` | `ce6d2d1dd9ee968bf3ffe23687f02ca264c7e8666b1be2d74c4228b39001ebba` | 2026-11-09 |
| #37 | `I_kwDOSUyCB88AAAABB7TbPA` | `ae0ece0693cad414976c4044a76b46103945369d203b9f327147904c7de5faea` | 2026-11-09 |
| #38 | `I_kwDOSUyCB88AAAABB7TiZg` | `1db42669f8c48d87b72ab4991d9b9d742671a0dd3096a3927908ea99e561165b` | 2026-11-09 |
| #39 | `I_kwDOSUyCB88AAAABB7TitQ` | `f71d58704f30f8ce3d8f24e9f2b402fa0093c785d4561f5b64abfe82d619cb56` | 2026-11-09 |
| #40 | `I_kwDOSUyCB88AAAABB7TnMw` | `c6a7ff804e62802f8af6e4a72870ef42372b2d0e8da3602d85e097bd14f7920e` | 2026-11-09 |
| #41 | `I_kwDOSUyCB88AAAABB7TqTw` | `dde20ca0936fd4a97bb624ebc4cae3180a6670ed18d46086383789f33f14e712` | 2026-11-09 |
| #42 | `I_kwDOSUyCB88AAAABB7Tvsw` | `7c54206b06c18ff39634be6ed5cd1f53e707c7eeda95e213e00ec9322dfdacc9` | 2026-11-09 |
| #44 | `I_kwDOSUyCB88AAAABB7jmQw` | `9c6c227fe4a69ccda95e141c875a1d25fd90ba48355df40f96410d58ccb74df6` | 2026-11-09 |
| #45 | `I_kwDOSUyCB88AAAABB7jqww` | `531202b19a98fc09e4f9fa5361a48c7eef9329aad7cf3bf45758a60a2c8b719d` | 2026-11-09 |
| #46 | `I_kwDOSUyCB88AAAABB7jvBA` | `bbf658289118c0ce127b66cda0b4c585a134ed37040b14778142efc86c59e9fb` | 2026-11-09 |
| #47 | `I_kwDOSUyCB88AAAABB7j9Mg` | `6fd683b2b88399ba2d218f230bf8cd42574e0e9c57cfb82753bec914696d1cdb` | 2026-11-09 |
| #52 | `I_kwDOSUyCB88AAAABB8MkqA` | `87faaa8db23a9821494ffb5fa5444837afce6f8f8b13531e9d9830d0396974e8` | 2026-11-09 |
| #53 | `I_kwDOSUyCB88AAAABB8Mk8Q` | `e491dbd425f102923d397ab29ae5f677d1befd194760a965b3bea28fd55fbb7c` | 2026-11-09 |
| #54 | `I_kwDOSUyCB88AAAABB8MlNQ` | `560fa68883351e4a7deab6b0da40bac142ab37f7c4019fffe9053d6d1de34233` | 2026-11-09 |
| #55 | `I_kwDOSUyCB88AAAABB8Mlfw` | `6b118c7ff1eef9f69b8b8c47346a49efa2e91a8d31300cb0340c640879e51f11` | 2026-11-09 |
| #56 | `I_kwDOSUyCB88AAAABB8MmYQ` | `54dd2972d1cf65d20646b0d6f8aedc26cda46e9b921fc35ef9a738d4969b4719` | 2026-11-09 |
| #57 | `I_kwDOSUyCB88AAAABB8Mmsw` | `439ace9b6c36e7c0b41a2fcedce78ec4ff00b7d3ac52282a82d556965f037693` | 2026-11-09 |
| #58 | `I_kwDOSUyCB88AAAABB8MnAQ` | `cde9488edfd96a27f8f67f6ee7d450625a36df4bc8e91278a445f3619cfd7b1d` | 2026-11-09 |
| #59 | `I_kwDOSUyCB88AAAABB8MnTg` | `a8cb054c22804a78b03adbd4769e351a80cc788c8f7f37bb3fe7de547f464f82` | 2026-11-09 |
| #60 | `I_kwDOSUyCB88AAAABB8MnlQ` | `98c52fd1651a22e1fdde6ac43a744ad677aba6c8465ec8bb5b3fe555d31953b8` | 2026-11-09 |
| #61 | `I_kwDOSUyCB88AAAABB8Mn_Q` | `61b0bdb35592e37a7a1d3f9058899d5a28f60e4407b541bb8c8b968836dc20b2` | 2026-11-09 |
| #62 | `I_kwDOSUyCB88AAAABB8NZuw` | `34e774fe62f9b947489d913b20ba13368fd5013e958c3b695590e7a67acc7965` | 2026-11-09 |
| #63 | `I_kwDOSUyCB88AAAABB8NanQ` | `36939d52f9f1792379be26ecc4739ff4263265fb86808b3c8c49f7dc1024c123` | 2026-11-09 |
| #64 | `I_kwDOSUyCB88AAAABB8Na6g` | `bae2565036c4548ba92452e6c1b21feb193751e438181151dbafdfa26b96f909` | 2026-11-09 |
| #65 | `I_kwDOSUyCB88AAAABB8NbNw` | `5e8a815b38998979bdd7a3b47ed8b3b8c01e0e57c71a5b80602973da381c7ccb` | 2026-11-09 |
| #66 | `I_kwDOSUyCB88AAAABB8Nbjw` | `bfea1edc08ba9529e4eddc4e0d2edbc1fa44fc8e17619bf3b6d0bbade8ea2073` | 2026-11-09 |
| #67 | `I_kwDOSUyCB88AAAABB8N4Iw` | `3e9c17bc52073d1dfdc67840d1171fcbd83a617eca4c8355711b1789c870e9aa` | 2026-11-09 |
| #68 | `I_kwDOSUyCB88AAAABB8N5Cw` | `c3735d4d3d00b10d9d3a790c0131539ea670de6fd9d86370448e9ad3db5724a6` | 2026-11-09 |
| #69 | `I_kwDOSUyCB88AAAABB8N5SA` | `edc6494514a3a01d4dddc10439c12c96a330e15d613a74cb1b8c66df580153d7` | 2026-11-09 |
| #70 | `I_kwDOSUyCB88AAAABB8N5jg` | `14b7e26d0a966e59229da1a7502722f02bfda5c7c813ca09afc06dd5e2fffe82` | 2026-11-09 |
| #71 | `I_kwDOSUyCB88AAAABB8N55A` | `3fd3ad4daef5ae8a0474d3e78e52e24ad1d02df17f029d0eedc3d5ca47e00815` | 2026-11-09 |
| #72 | `I_kwDOSUyCB88AAAABB8N6Kg` | `30bd596678fe9777f063f964687a52c03928ab63b547d0a97a63669cc97bd0c7` | 2026-11-09 |
| #73 | `I_kwDOSUyCB88AAAABB8OTlw` | `d96be3a0fdf20ae3ec93041ebb4bb2b6727c1032a96c67517fd09d62159852bf` | 2026-11-09 |
| #74 | `I_kwDOSUyCB88AAAABB8OURA` | `91916bea0b39f38aab71d024f42bebb59f8bd4a0fb86628b2fa33624fae0f72a` | 2026-11-09 |
| #75 | `I_kwDOSUyCB88AAAABB8OVVQ` | `183dc63d8279471963be8e38ebfe7b9508e6bba3bc01a2389d3a81c8db8f2ee0` | 2026-11-09 |
| #76 | `I_kwDOSUyCB88AAAABB8OVpg` | `42c55f052f1bdf362f082fa87d177e0cce98a1805573457e90fe44b22933abfc` | 2026-11-09 |
| #77 | `I_kwDOSUyCB88AAAABB8OV-A` | `e6a726f2227aed98d3358db7fb32aed97b0f31a3435b138eaad4ed7a7b56cef7` | 2026-11-09 |
| #79 | `I_kwDOSUyCB88AAAABB_5Zbg` | `8e8dca9c3f476d970a5e9c8b76e4da89815f8897ba016c726b8121ba19c7e310` | 2026-11-09 |
| #80 | `I_kwDOSUyCB88AAAABCHk_BQ` | `af847dc45f41cb6568d47a9cace914461acd712aecedef096d8ae33dd41d2288` | 2026-11-09 |
| #81 | `I_kwDOSUyCB88AAAABCHk_aQ` | `8c046eaa472c605d655dc24db86643ed70fe68c3f94977770dbf727a3c757873` | 2026-11-09 |
| #82 | `I_kwDOSUyCB88AAAABCHlHUg` | `2ec085e37b840172d336a68cce9f83cee76c6b6becf8c189e2029cfc6d207c7f` | 2026-11-09 |
| #83 | `I_kwDOSUyCB88AAAABCHlHwg` | `6e7e03ef5ad5d67c237c13857f1df7ef82c03b44ba7b58a7467da985a570598c` | 2026-11-09 |
| #84 | `I_kwDOSUyCB88AAAABCHlQCQ` | `9fa07cbe804f117c1f92eff8b68f78a6206667b753a0266a5aed27b843be658b` | 2026-11-09 |
| #85 | `I_kwDOSUyCB88AAAABCHlROQ` | `9790ecf67f2f96ef496a665304d8d3a5db9efe547270a3a3e1d23b56c59ef4e8` | 2026-11-09 |
| #86 | `I_kwDOSUyCB88AAAABCHlkdA` | `989c8e1e3a4970f77a802d89171d5e87b6e1e83a60da312c85262332e247aac1` | 2026-11-09 |
| #87 | `I_kwDOSUyCB88AAAABCHl59g` | `be6653f860c94b600e6d37195a7fca571d680ef4f87bff5613a11aa8c8e2aeb7` | 2026-11-09 |
| #88 | `I_kwDOSUyCB88AAAABCHmAZw` | `04776d579b64116afff916bac655fcd66dc95b465fab0cb47bae2e4d3fc0d7fa` | 2026-11-09 |
| #89 | `I_kwDOSUyCB88AAAABCHmJWw` | `0dfc2c7f740bcdfe31f5876dbffbfffb1485689f47d08ee863eb9e210ce0bc6e` | 2026-11-09 |
| #90 | `I_kwDOSUyCB88AAAABCHmPMg` | `91c221964c533409836f6e5c9958a9132a4e2add89af6951322c76f3a52c31e0` | 2026-11-09 |
| #91 | `I_kwDOSUyCB88AAAABCHmWkg` | `79e0ae5defc7b605e2254604c1ece2fad92538d9540046e7a3bb491c6f9be850` | 2026-11-09 |
| #95 | `I_kwDOSUyCB88AAAABCHsPZQ` | `dbe7327213c4a06536ab4721d7487cef5e9ecda38d5736cb148b63706c4db9f9` | 2026-11-09 |
| #96 | `I_kwDOSUyCB88AAAABCHsP9Q` | `2fb303722c7022db6f2e09f368ddea19e6cce98eb14430005320085e9104e497` | 2026-11-09 |
| #97 | `I_kwDOSUyCB88AAAABCHsRNQ` | `e7213b3695c4c559c8a069d1f2b5da053b86680d6c4acce1969f537b1b57ed2d` | 2026-11-09 |
| #98 | `I_kwDOSUyCB88AAAABCHsSvA` | `d02c19fe1c9cef4e94ed3e846a4155dc481f3fc2a52c6db20e5379ea53b28995` | 2026-11-09 |
| #99 | `I_kwDOSUyCB88AAAABCHsTUA` | `1f76f1e3e764455e85f67a268fd8dab19b4a1af897aac63487d973f20c427fd8` | 2026-11-09 |
| #100 | `I_kwDOSUyCB88AAAABCHsU-w` | `fe63a0b75254d4132fa1f2f1d085f49072a3c4e3ce049cc185917f9158c1d415` | 2026-11-09 |
| #101 | `I_kwDOSUyCB88AAAABCHsWGA` | `0239411bff691b200fda11efee8ead79c29805376339a327ec74dd00afed14e6` | 2026-11-09 |
| #102 | `I_kwDOSUyCB88AAAABCHsW_g` | `675c300fc43ca89181f9b648e67694a1190ab8601e381c4d96d42772a0852041` | 2026-11-09 |
| #103 | `I_kwDOSUyCB88AAAABCHsXmA` | `8adfa548223aa5b0785a2380a60d224a1ba5b0c1c3a75f9bb666fb4a3968ee26` | 2026-11-09 |
| #106 | `I_kwDOSUyCB88AAAABCILRxg` | `b718d0898ea1ff9a68c6fdd8115eb35255922b94b69a09b11aa6013961776e59` | 2026-11-09 |
| #107 | `I_kwDOSUyCB88AAAABCS6oZQ` | `ec690dc588e927432292f07b26bbbe3503137060fce71d1aaceb61484d434c03` | 2026-11-09 |
| #110 | `I_kwDOSUyCB88AAAABCapERg` | `e7248b7f7013fd45f897cfabdce57bc86eb9ece6b49eebc2cfcc1127306cd9dc` | 2026-11-09 |
| #111 | `I_kwDOSUyCB88AAAABCapGkQ` | `1c588fe9227ffe273ba775787d4dfad1e025adcfdb8438f68af6fb50563c7eda` | 2026-11-09 |
| #112 | `I_kwDOSUyCB88AAAABCgW33A` | `3d92a4cd7b2507fe11c647b2c332f02208011bb41b215ecb2e09f6cdb858b6ad` | 2026-11-09 |
| #113 | `I_kwDOSUyCB88AAAABCgbYPQ` | `df1142fd7b0081a916919c66233f29c67408da22e3ad1a4fe92191b52f79ec99` | 2026-11-09 |
| #114 | `I_kwDOSUyCB88AAAABCgcDtg` | `0a99a4bb3f3b737273996e05e96cabd17c6b491b087a900fdcdeeafb4c3651b2` | 2026-11-09 |
| #115 | `I_kwDOSUyCB88AAAABCgcDxA` | `6976f9fa1d69099a998d458edeb6ec02665d2f3dd0d27bbf420bfbec4f6acbf2` | 2026-11-09 |
| #116 | `I_kwDOSUyCB88AAAABCgcD4Q` | `77e4fae23b65380288e4d6bd48ff189b218b47dd119ae8551e6c5407e108d29f` | 2026-11-09 |
| #117 | `I_kwDOSUyCB88AAAABCgcD9w` | `804ac1f32eb50202f512274f69b592ff8d60678ab53f54f05b258bae72cb1747` | 2026-11-09 |
| #118 | `I_kwDOSUyCB88AAAABCgcEGw` | `46f033f83a66f5fafc4a0ada4382e603b08b1055479f47b9507be7cb0fca0c53` | 2026-11-09 |
| #119 | `I_kwDOSUyCB88AAAABCgcENQ` | `5f7cd16b67df5bde54ae7738cfcfe96934783d2cee2fd5ac0398e91617fb8270` | 2026-11-09 |
| #120 | `I_kwDOSUyCB88AAAABCgcEVA` | `070939283eb009e7d82ebd37aab1eae7d6da5d7420f42da8795bd4c1ab4208cc` | 2026-11-09 |
| #121 | `I_kwDOSUyCB88AAAABCgcEdg` | `30fd3bce79ac0633abcfa60cf0e8eae0c1ffb39d054ae816fed59039d3d970ef` | 2026-11-09 |
| #122 | `I_kwDOSUyCB88AAAABC_chLg` | `fd7ee98421a3de33841206ab2638858a1018e32aecdf7328ce6fd534394e338d` | 2026-11-09 |
| #123 | `I_kwDOSUyCB88AAAABDItmcA` | `fc6ba329c3aa6f165677eb26021ca8cd77dd16825feae097f82a9de128aa8fcd` | 2026-11-09 |
| #124 | `I_kwDOSUyCB88AAAABDItmqQ` | `2cca7426a65d8079366e78cea4a85fe6e6f5bfac869d9f66976435f88baf27c4` | 2026-11-09 |
| #125 | `I_kwDOSUyCB88AAAABDItm9Q` | `f5cfbc256222e42dfc94c92ce29adf7b2d0f40c8ef3bcaefbd8b42cc95e82000` | 2026-11-09 |
| #126 | `I_kwDOSUyCB88AAAABDItnOw` | `cc69a39a52f3562d2af030ce7bf6121c7d778eba4544a47bf0820ef8d769f71d` | 2026-11-09 |
| #127 | `I_kwDOSUyCB88AAAABDItnbQ` | `3e02c99f1d02f9db7c20647822fa62e86e627fd9650f173fd09fefd45ff0904b` | 2026-11-09 |
| #128 | `I_kwDOSUyCB88AAAABDItnow` | `1c9fa3898cc91e1182d0f3cec3db307a88c264a3f9ba2c46d00dc84a23aef2e9` | 2026-11-09 |
| #129 | `I_kwDOSUyCB88AAAABDItn7w` | `af3a732525d218c645bedbec42841a65e6523e58cc7eedc15baa6cfcb37802e1` | 2026-11-09 |
| #130 | `I_kwDOSUyCB88AAAABDItoJw` | `fbcd621c791ee924a1e3f26bf949c4c41871973b250b618c1507674df0513fcb` | 2026-11-09 |
| #133 | `I_kwDOSUyCB88AAAABDItoxg` | `5120f7fa0ffaa1c218833c05e7f5b6dea3d8cade13849956b6f4a8d85b95d321` | 2026-11-09 |
| #134 | `I_kwDOSUyCB88AAAABDItpAg` | `1fd698eacc2a97d4e783ee7076a10ead87e059d5093d6812241468daac109cf2` | 2026-11-09 |
| #136 | `I_kwDOSUyCB88AAAABDItpiA` | `0d76496a3b60824d9f3e7091a0fb33ac525058adfd9e08d957f122db47053bae` | 2026-11-09 |
| #137 | `I_kwDOSUyCB88AAAABDItpxg` | `8e45c424554c8c4e2903a574d5bf4773702cd5fd06cc5524d94534f0a48cc89c` | 2026-11-09 |
| #138 | `I_kwDOSUyCB88AAAABDItqAg` | `729ae98cda7b2a2b8e02017cae5a736ea7fbcf191a255a46d1439468ce3325ff` | 2026-11-09 |
| #139 | `I_kwDOSUyCB88AAAABDItqQA` | `43ed6e2a6616a4808773914e3d49430576a9393652fe1ea22d3ea465f9532818` | 2026-11-09 |
| #140 | `I_kwDOSUyCB88AAAABDItqew` | `df6e32d4c8053dd8446a871ad144a25778caa8fdd0fc7e855f85420d17001a04` | 2026-11-09 |
| #141 | `I_kwDOSUyCB88AAAABDItqrg` | `a46d78a87496f67016937de75b327d35d2c817a7cb8bf6c5b710ac4a43e86bfc` | 2026-11-09 |
| #142 | `I_kwDOSUyCB88AAAABDItq8A` | `73773463bea9ef8dceb90b888dfa67b0f2509622305fa9d6b17ca170dbb69ec0` | 2026-11-09 |
| #143 | `I_kwDOSUyCB88AAAABDItrKg` | `79e89e2a105e7d746a9da4df6c90ab5b6cebe45e9f63de22d8e50265093d3a88` | 2026-11-09 |
| #144 | `I_kwDOSUyCB88AAAABDItrZw` | `9f2c3419a70430bbd467909999b40ecc5e7b30bcfa307e3ca9de60d9e25c31ad` | 2026-11-09 |
| #145 | `I_kwDOSUyCB88AAAABDItroA` | `c236551c833951dc16ac36e5e0cac2eaead27edad0046f64b39c78ed7f819ba9` | 2026-11-09 |
| #153 | `I_kwDOSUyCB88AAAABDPhsAA` | `680e35a0348753558290ca461836fa358d12e76815f0da91b4ad65f0c280adb5` | 2026-11-09 |
| #154 | `I_kwDOSUyCB88AAAABDPhsRw` | `62f8594eea6e0e07b0b548a78c413d3d545c1b8ae2988e88272d363af94f5324` | 2026-11-09 |
| #155 | `I_kwDOSUyCB88AAAABDPhsfA` | `105c3f70aee90e5e7ae9e6b76e2fa4ed309b45e0c63aa2860cc0128b7604f4bd` | 2026-11-09 |

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
  Closed issues: 131, archived, not re-checked against the code
  GitHub issues deleted: 48 open and 131 closed, 2026-11-09 (see the deletion journal)
  GitHub issues remaining: 0
```
