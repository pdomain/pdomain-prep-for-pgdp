---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Text-review attestation never becomes status clean on disk

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — pack gate always blocks without hand-seeded files
- **Affected version:** pdomain-prep-for-pgdp master
- **Read when:** unblocking validation / build_package, text_review gate, or per-page attest UX
- **Search terms:** attestation.json, status clean, unattested_text_review, text_review/confirm, text_review/clean
  phantom, B3, W0.3
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md) (W0.3, B3);
  [golden-path CI](2026-07-21-w06-golden-path-ci.md); [project-stage job
  adapter](2026-07-21-w02-project-stage-job-adapter.md)

## Summary

`text_review` writes `attestation.json` as empty `{}`. Validation requires `attestation.status == "clean"`. Project
`POST …/project-stages/text_review/confirm` only marks the project review/stage row; it does not rewrite each page's
`attestation.json`. Registry docs mention `POST …/text_review/clean`, but that route is phantom. Pack stays gate-blocked
unless files are hand-seeded.

## Impact

- Validation always emits `unattested_text_review` blockers for real runs.
- `build_package` stays 409 gate-blocked (see also e2e stopping at 409).
- No API path produces attested pages for a multi-page book.
- Blocks Wave 0 exit criteria 3 and golden-path CI (W0.6).

## Environment / versions

```text
repo: pdomain-prep-for-pgdp
branch: master (docs baseline 2026-07-21)
scope: stage_registry `_text_review_cpu`; steps/validation.py; api/data/project_stages.py confirm; missing pages attest route
```

## Evidence

### 1. Stage writes empty attestation

`src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py` `_text_review_cpu` ~1052–1068:

```python
attestation = json.dumps({}).encode()
return {"output.txt": text, "attestation.json": attestation}
```

Docstring claims Mark clean via `POST .../text_review/clean` short-circuits the DB row; that route is not implemented
under pages or project_stages (only mentioned in registry comments ~940 and ~1053).

### 2. Validation requires status clean

`src/pdomain_prep_for_pgdp/core/pipeline/steps/validation.py` ~104–113:

```python
if not attestation or attestation.get("status") != "clean":
    issues.append({..., "code": "unattested_text_review", ...})
```

Empty `{}` always fails.

### 3. Project confirm does not rewrite per-page attestation

`src/pdomain_prep_for_pgdp/api/data/project_stages.py`:

- Route `POST …/project-stages/text_review/confirm` ~1124–1146 calls `_confirm_stage_impl`.
- `_confirm_stage_impl` ~935–1000 marks ProjectStageStore or StageReviewStore and records a ReviewDecision event.
- It does **not** open or rewrite `pages/{id}/stages/text_review/attestation.json`.

Because `text_review` is page-scoped (`V2_PAGE_STAGE_IDS`), confirm uses StageReviewStore "project-wide review decision"
semantics, not per-page artifact rewrite.

### 4. Phantom text_review/clean

Repo search under `src/` finds `text_review/clean` only in `stage_registry.py` comments. No FastAPI route implements it.
OpenAPI has project `/clean` (artifact reclaim), unrelated to text_review attest.

## Root-cause hypotheses

1. **(Most likely) Gate writer was deferred; confirm reused for project-level review only** — docs still describe a
   per-page clean route that was never built.
2. **Empty attestation was intentional "not yet reviewed" marker** — correct as a default, but no second write path
   exists to flip status to clean.
3. **Confusion between page_stages row clean and attestation artifact clean** — runner can mark the stage row clean
   while validation still reads empty JSON.

## Defects to fix

1. **Implement a real per-page attest route/event** (primary), for example:
   - `POST …/pages/{idx0}/stages/text_review/attest`, or
   - expand project confirm to rewrite every page's `attestation.json` with `{"status": "clean", …}` under an explicit
     contract.
2. **Dual-write attestation** — disk `attestation.json` + consistent page_stages / events so reindex stays coherent.
3. **Remove or replace phantom `text_review/clean` doc references** in registry comments once the real route ships.
4. **API test** — attest N pages → validation has zero `unattested_text_review` without hand-seeding files.

## Next steps

1. Spec the route body (actor, timestamp, optional note) and dual-write shape.
2. Failing API test: seed text_review `output.txt` + empty attestation → attest → validation passes attestation rule.
3. Implement route + event; update FE Mark clean / confirm to call it.
4. Delete or rewrite phantom clean references.
5. Cover in golden-path CI (W0.6).

## What is NOT broken (to scope the fix)

- text_review copying parent text into `output.txt` when given real bytes.
- Validation pure rules once attestation JSON is correct on disk.
- Project-stage confirm infrastructure for truly project-scoped stages (page_order, source, etc.).

## Done when

API test: attest N pages → validation has zero `unattested_text_review` without hand-seeding files. Each page
`attestation.json` has `status: "clean"`.

## Resolution

*Open.*
