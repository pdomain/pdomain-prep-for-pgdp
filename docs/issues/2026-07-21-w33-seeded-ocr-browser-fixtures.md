---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-11-07
Kind: issue
Level: I1
---

# Text-review approval needs fixture-backed browser coverage (W3.3)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-07
- **Resolution:** Open
- **Severity:** Medium — interactive text-chain UI untested in browser preflight
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** closing W6.2 e2e skips, seeding OCR for browser tests, or Wave 3 quality work.
- **Search terms:** W6.2, text_review approval, seeded OCR, browser fixtures, wordcheck e2e, DocTR skip, W3.3
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

The text-review approval browser test is a passing documentation stub, not an executed approval flow or
a pytest-marked skip. Wordcheck already has browser rendering coverage. A fixture-backed review/approval
flow remains absent. Production review hydration reads wordcheck flags from unattested pages;
OCR text artifacts alone do not populate that queue.

## Impact

- Interactive text-chain approval never runs in local preflight e2e.
- The browser gate does not exercise the complete TextReviewTool queue and approval flow.
- Blocks W3.2 from honestly covering text tools beyond “tool slot renders.”

## Environment / versions

```
repo: pdomain-prep-for-pgdp
e2e: tests/e2e/test_w62_gap_tests.py
seed helper: tests/fixtures/seed_pages.py (pages only; no OCR artifact seed)
reference pattern: tests/e2e/test_grayscale_browser.py (`_seed_grayscale_project`)
```

## Evidence

### Current source verification — 2026-11-07

The approval browser test is a passing documentation stub. Production review hydration is live and reads
wordcheck flags from unattested pages, not MOCK_ITEMS. Checked test_w62_gap_tests.py, TextReviewTool.tsx, and
services/tools/textReviewTool.ts.

This is source inspection, not a fresh browser/GPU run. Older source excerpts and July review dates below
are historical snapshots; the current findings above take precedence where implementation changed.

### 1. Historical documentation stub with seed requirement

```
# tests/e2e/test_w62_gap_tests.py ~912–926
def test_text_review_approval_skipped() -> None:
    """SKIP: text_review approval flow.

    The text_review tool requires real OCR output to populate the page list
    (each page needs a .txt artifact from the ocr stage). Running real DocTR
    OCR in e2e tests is too slow for the local preflight suite.

    This flow should be exercised … with:
      1. A prebuilt OCR artifact cache.
      2. A seeded text_review page list.
      3. Approve-low-risk route assert.
    """
```

Module docstring (lines 34–43) also defers wordcheck/naming-related gaps to
seeded or GPU suites.

### 2. Contrast: image stages seed real bytes

`test_grayscale_browser.py` creates a project, seeds a color PNG via
`seed_pages_in_store`, runs grayscale via API, then drives the UI.
No parallel helper writes `pages/<id>/stages/ocr/{raw.txt,words.json}` +
dual-write `page_stages` rows for text tools.

### 3. Production queue hydration is live

`loadTextReviewQueue` in `frontend/src/services/tools/textReviewTool.ts` lists pages, excludes attested pages,
and builds review items from their wordcheck flags. No flags means an empty queue.
`TextReviewTool.tsx` permits test injection but does not invent production items.
The fixture must seed flags, stage rows, and attestation state consumed by this loader.

## Root-cause hypotheses

1. **(Most likely) No hermetic OCR artifact fixture** — authors avoided DocTR
   cost and never added a dual-write seed of known `raw.txt` / `words.json`.
2. **Fixture shape lagged production hydration** — OCR artifacts alone do not provide the flags and review state.

## Defects to fix

1. **Seed a real review queue** — wordcheck flags, page-stage rows, and attestation state for synthetic pages.
   Include OCR prose and words when the tested interaction consumes them; avoid live DocTR. (Primary)
2. **Promote `test_text_review_approval_*`** from documentation stub to real Playwright
   flow using the fixture.
3. **Extend wordcheck interaction coverage** beyond the existing rendering test using the same seeded data.

## Next steps

1. Add a helper alongside `seed_pages_in_store` that creates the flags and review state the live loader reads.
2. Implement the three-step approval assert listed in the skip docstring.
3. Close W6.2 skip notes; keep heavy live-DocTR paths out of default smoke
   (W3.2).

## What is NOT broken

- Unit/API tests for text stages can still hand-seed files.
- Tool-slot presence for text_review is already covered in W6.2 test 2.
- Grayscale / page_order browser seeding patterns are usable as templates.

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link the
fixture + unskipped e2e commit, route retirement through `doc-retirer`.
