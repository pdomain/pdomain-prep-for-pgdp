---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# W6.2 text_review / wordcheck browser skips need seeded OCR fixtures (W3.3)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — interactive text-chain UI untested in browser preflight
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** closing W6.2 e2e skips, seeding OCR for browser tests, or Wave 3 quality work.
- **Search terms:** W6.2, text_review approval, seeded OCR, browser fixtures, wordcheck e2e, DocTR skip, W3.3
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Playwright gap tests intentionally skip the text_review approval flow (and
related wordcheck / naming paths that need real page text) because populating
OCR artifacts requires either slow live DocTR or a pre-seeded fixture that
does not yet exist for the browser suite. Grayscale and page_order e2e already
seed disk/API state; the same pattern is missing for OCR → text_review.

## Impact

- Interactive text-chain approval never runs in local preflight e2e.
- Regressions in TextReviewTool queue / approve paths only show up manually.
- Blocks W3.2 from honestly covering text tools beyond “tool slot renders.”

## Environment / versions

```
repo: pdomain-prep-for-pgdp
e2e: tests/e2e/test_w62_gap_tests.py
seed helper: tests/fixtures/seed_pages.py (pages only; no OCR artifact seed)
reference pattern: tests/e2e/test_grayscale_browser.py (`_seed_grayscale_project`)
```

## Evidence

### 1. Explicit skip with seed requirement

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

### 3. Production UI still mock-seeded without OCR

`TextReviewTool.tsx` mounts with `MOCK_ITEMS` when live hydrate is absent —
browser tests cannot assert real queue behavior without disk seeds (see also
W1.4 live SSE work).

## Root-cause hypotheses

1. **(Most likely) No hermetic OCR artifact fixture** — authors avoided DocTR
   cost and never added a dual-write seed of known `raw.txt` / `words.json`.
2. **Tool still mock-first** — even with seeds, TextReviewTool may prefer
   MOCK_ITEMS until hydrate is wired (W1.4 dependency).

## Defects to fix

1. **Seeded OCR fixture helper** — dual-write OCR (and optional wordcheck /
   text_review) artifacts for N synthetic pages without DocTR. (Primary)
2. **Promote `test_text_review_approval_*`** from skip stub to real Playwright
   flow using the fixture.
3. **Optional wordcheck browser path** using same seed (flags + text once
   W0 text-chain contract is fixed).

## Next steps

1. Add `tests/fixtures/seed_ocr_artifacts.py` (or extend `seed_pages_in_store`)
   writing dual-write-shaped OCR outputs and clean stage rows.
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
