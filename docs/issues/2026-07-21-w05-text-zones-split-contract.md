---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# text_zones APPLY_SPLIT body mismatch between frontend and backend

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — split UI 422s at runtime; sibling pages never created from FE
- **Affected version:** pdomain-prep-for-pgdp master
- **Read when:** fixing text_zones split, APPLY_SPLIT, or page sibling creation
- **Search terms:** APPLY_SPLIT, SplitPageRequest, bboxes, bbox, split_at_stage, textZonesTool, B7, W0.5
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md) (W0.5, B7)

## Summary

Backend split accepts `{ bbox, split_at_stage, suffixes }`. Frontend `applySplit` posts `{ suffixes, bboxes }` without
`split_at_stage`. The OpenAPI/generated client and live route agree with the backend model. APPLY_SPLIT from the text
zones tool fails validation (422) at runtime.

## Impact

- Users cannot split multi-column pages from the text_zones tool.
- Sibling pages with `parent_page_id` / crop bbox / split_index never appear via UI.
- Backend split tests that call the API with the correct body still pass; FE integration does not.

## Environment / versions

```text
repo: pdomain-prep-for-pgdp
branch: master (docs baseline 2026-07-21)
scope: api/data/pages.py SplitPageRequest; frontend/src/services/tools/textZonesTool.ts
```

## Evidence

### 1. Backend request model

`src/pdomain_prep_for_pgdp/api/data/pages.py` ~1299–1302:

```python
class SplitPageRequest(BaseModel):
    bbox: tuple[int, int, int, int]  # x, y, w, h in parent source-image coords
    split_at_stage: str
    suffixes: list[str]
```

Route rejects unknown `split_at_stage` with 422 (`not in V2_PAGE_STAGE_IDS`). Missing required fields also 422.

### 2. Frontend posts a different shape

`frontend/src/services/tools/textZonesTool.ts` ~102–113:

```typescript
// At I1 the endpoint accepts { suffixes, bboxes } where bboxes is a list.
await api.post(..., {
  suffixes: ["a", "b"],
  bboxes: [bboxA, bboxB],
});
```

No `split_at_stage`. Uses `bboxes` (plural list of normalized 0–1 boxes) instead of a single integer `bbox`. Comment at
top of file still says backend expects `{ suffixes, bbox }` — already inconsistent with the live body.

### 3. Generated types match backend

`frontend/src/api/types.gen.ts` `SplitPageRequest` includes `split_at_stage: string` (and backend-shaped fields). The
tool does not use that schema for the POST body.

### 4. Backend unit path works with correct body

`tests/test_b3_ocr_text_stages.py` APPLY_SPLIT cases pass `split_at_stage="text_zones"` and create sibling pages. That
proves the server contract; it does not cover the FE body.

## Root-cause hypotheses

1. **(Most likely) FE service written against an early I1 draft** — body used `bboxes` list; backend settled on one
   `bbox` plus `split_at_stage` per call (or per child via multiple calls).
2. **Normalized vs pixel coordinates** — FE builds 0–1 relative boxes; backend documents parent source-image integer
   coords. Even after field rename, coord space may still be wrong.
3. **One request vs two children** — FE sends two boxes at once; backend may expect one split operation shape (verify
   whether multi-child needs N posts or one call with suffixes only).

## Defects to fix

1. **Align FE POST body with `SplitPageRequest`** (primary) — include `split_at_stage` (e.g. `"text_zones"`), send
   `bbox` as required by the API, drop incorrect `bboxes` key unless the API is extended.
2. **Resolve multi-child API usage** — either two sequential splits or one documented multi-suffix contract matching the
   backend.
3. **Coordinate space** — convert draft gutter to parent image pixel `bbox` if the API expects integers.
4. **Service + API test** — APPLY_SPLIT succeeds end-to-end from the service shape the UI uses.

## Next steps

1. Confirm intended multi-child semantics with backend split helper (`split_page` implementation).
2. Failing service/API test that posts the FE body and expects 2xx today fails with 422.
3. Fix `textZonesTool.ts` body; update stale header comments.
4. Machine tests that mock `applySplit` keep page-set mutation; add one integration-style assert on request payload.

## What is NOT broken (to scope the fix)

- Backend split creating sibling pages when called with a valid `SplitPageRequest`.
- Split event / dirty fan-out tests under v2 (`test_b3_ocr_text_stages.py`).
- Contour zone detection stage depth (separate PARTIAL issue; not this contract).

## Done when

APPLY_SPLIT succeeds in API + service test with the body the text zones tool actually sends.

## Resolution

*Open.*
