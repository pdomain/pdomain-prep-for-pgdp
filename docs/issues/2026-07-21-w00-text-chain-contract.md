---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Wordcheck flags JSON vs text DAG; OCR compound parent load only reads output.*

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — silent wrong page `.txt` or load-fail on wordcheck
- **Affected version:** pdomain-prep-for-pgdp master
- **Read when:** fixing OCR → wordcheck → hyphen_join → text_review chain, dual-write keys, or Wave 0 book path
- **Search terms:** wordcheck flags, output_type text, words.json, raw.txt, compound parent load, hyphen_join UTF-8,
  text-chain contract, B0, B1, W0.0, W0.1
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md) (W0.0 + W0.1, B0 +
  B1); [golden-path CI](2026-07-21-w06-golden-path-ci.md)

## Summary

The live text DAG assumes page text flows `ocr → wordcheck → hyphen_join → regex → text_review`. Wordcheck returns
flags-only JSON, not UTF-8 prose. OCR writes `words.json` + `raw.txt`, but the page runner loads compound parents by
scanning only for `output.*`. Wordcheck therefore fails dependency load. A naive load fix that still feeds one blob can
make hyphen_join treat flags JSON as page text.

## Impact

- Wordcheck cannot open the OCR compound dir under the current loader.
- After a partial B1-only fix, pack can emit silent wrong `.txt` files (flags JSON as page text).
- text_review `output.txt` cannot hold real prose until the chain contract is fixed.
- Blocks Wave 0 book completion and golden-path CI (W0.6).

## Environment / versions

```text
repo: pdomain-prep-for-pgdp
branch: master (docs baseline 2026-07-21)
scope: core/pipeline stage_dag, stage_runner, stage_registry, steps/wordcheck, steps/hyphen_join
```

## Evidence

### 1. DAG claims wordcheck emits text

`src/pdomain_prep_for_pgdp/core/pipeline/stage_dag.py` registers wordcheck with `input_type="words+text"` and
`output_type="text"`. hyphen_join depends on wordcheck with `input_type="text"`. OCR is `output_type="words+text"`.

### 2. Wordcheck impl is flags-only

`src/pdomain_prep_for_pgdp/core/pipeline/steps/wordcheck.py` `wordcheck_v2_cpu` takes `words_json` bytes and returns
JSON:

```text
{"flags": [...], "flagged_count": int, "total_words": int}
```

No pass-through of OCR page text. No `output.txt` side product.

### 3. hyphen_join expects UTF-8 prose

`src/pdomain_prep_for_pgdp/core/pipeline/steps/hyphen_join.py` `hyphen_join_v2_cpu` does `text_bytes.decode("utf-8")`
and returns joined text bytes. Feeding flags JSON produces garbled "text," not prose.

### 4. OCR writes words.json + raw.txt, not output.*

`src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py` `_ocr_cpu` returns:

```python
return {"words.json": words_json, "raw.txt": raw_txt}
```

### 5. Compound parent load only scans output.*

`src/pdomain_prep_for_pgdp/core/pipeline/stage_runner.py` ~468–485: for `COMPOUND_OUTPUT_TYPES`, the loader looks for
the first file whose name starts with `output.`. If none exist, it raises `StageDependenciesNotMet` ("compound artifact
directory empty"). OCR's real keys never match.

## Root-cause hypotheses

1. **(Most likely) Contract drift between DAG, OCR multi-artifact keys, wordcheck flags product, and single-blob parent
   load** — each piece was built for a different consumer model; the runner still assumes one `output.*` blob per
   parent.
2. **Wordcheck treated as final text stage by mistake** — flags were designed as a UI product; DAG still types the stage
   as `text` for the pack chain.
3. **Loader fallback intended for legacy v1 text_postprocess** — comment mentions text_postprocess consuming text from
   ocr; keys were never updated for words.json/raw.txt.

## Defects to fix

1. **Choose and implement one text-chain design** (primary):
   - **Compound wordcheck** — emit `flags.json` + `output.txt` (pass-through or lightly edited OCR text); dual-write
     both; hyphen_join loads text; or
   - **DAG rewire** — hyphen_join depends on ocr text (and optionally wordcheck flags as a parallel input); or
   - **Runner fan-in** — load parent artifacts by consumer need (`words.json` vs `raw.txt` / `output.txt`), not a single
     `output.*`.
2. **Load-by-consumer-need** — never prefer `raw.txt` into wordcheck (JSON expected) or flags JSON into hyphen_join
   (text expected).
3. **Keep wordcheck flags for UI** — flags remain a side product; they must not replace package page text.

## Next steps

1. Confirm design choice with CT (compound wordcheck vs DAG rewire vs runner fan-in).
2. TDD runner chain: ocr → wordcheck → hyphen_join → regex → text_review asserts UTF-8 prose in text_review
   `output.txt`, not flags JSON.
3. Assert wordcheck still emits flags for the workbench.
4. Land W0.1 compound loader as part of this work, not a standalone "prefer raw.txt first" change.
5. Wire assertions into golden-path CI (W0.6).

## What is NOT broken (to scope the fix)

- OCR engine path itself (`_ocr_cpu` + multi-artifact write of words.json/raw.txt).
- Pure hyphen_join / regex transforms when given real UTF-8 text.
- Dual-write writer support for compound stages (`commit_stage_artifacts_multi`).
- UI mock/SSE gaps (B5) — separate from this artifact contract.

## Done when

Runner chain produces UTF-8 prose in text_review `output.txt`, not flags. Wordcheck still has flags for UI. Wordcheck
receives JSON words; hyphen_join receives text.

## Resolution

*Open.*
