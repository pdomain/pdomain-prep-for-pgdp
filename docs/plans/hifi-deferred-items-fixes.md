---
title: Hi-fi redesign — deferred-items fidelity fixes
repo: pdomain-prep-for-pgdp
status: shipped
created: 2026-06-14
shipped: 2026-06-14 (origin/main 0aa532f)
parent: hifi-loader-source-grayscale-complete.md
---

# Deferred-items fixes (follow-up to the Loader+Source+Grayscale arc)

The complete-pass arc shipped to main @ 6fa6673 (book-tools v0.20.0 + the three
slices, live-verified). These are the honest deferrals it left, now being fixed.

## Items

1. **OQ-5 — grayscale "before" pane is synthetic.** The workbench before/after
   shows `<SyntheticPage isColor />` for "before" instead of the real color source.
   FIX: render the real source image via `GET /api/data/projects/{id}/pages/{idx0}/thumbnail`
   (ingest color thumbnail) — full-res source artifact if a better key exists.
   Worktree: feat/deferred-grayscale-fidelity.

2. **OQ-4 — grayscale Pages-grid mini-thumbnails are synthetic gradients.** FIX:
   real per-page thumbnail — grayscale stage thumbnail (`.../pages/{idx0}/stages/grayscale/thumbnail`)
   where grayscale ran, else fall back to the ingest source thumbnail. `GrayscalePage`
   already carries idx0. Worktree: feat/deferred-grayscale-fidelity.

3. **back/duplicate roles collapse to backend `skip`.** The frontend offers "back"
   and "duplicate" roles but `PageType` = {normal,blank,plate_b,plate_p,plate_r,skip,cover}
   has no distinct values, so both persist as `skip` and lose their label on reload.
   FIX: make them survive distinctly — add the least-invasive DURABLE mechanism
   (PageType enum values + packaging/assign_prefixes/event handling, OR a separate
   durable page role-tag that round-trips). Event-logged. Worktree: feat/deferred-source-roles.

4. **S2 — cover/blank chip visual render** unconfirmed (state proven; Playwright
   screenshot timed out). Confirm/fix the chip renders in the Files grid.
   Folded into the source-roles worktree + final live-verify.

5. **L3 — archived "Save a copy"** is a `comingSoon` stub (real export deferred).
   A future feature, correctly stubbed. NOT in scope here.

## Flow
Two parallel worktrees (grayscale fidelity / source roles) → recombine onto an
integration branch → live-verify on the 233-page sample (real before/after images;
back/duplicate survive reload; chips render) → ff-merge to main → push (CT-authorized
for this arc) → cleanup.
