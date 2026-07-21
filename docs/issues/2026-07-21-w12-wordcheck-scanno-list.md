---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Wordcheck ships a tiny hardcoded bad-word list; scanno research not productized (W1.2)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — scanno recall near floor on real books
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21 pipeline review)
- **Read when:** expanding wordcheck lists, productizing scanno research, or defining the flags-vs-text contract after
  W0.0.
- **Search terms:** wordcheck, bad_words, `_DEFAULT_BAD_WORDS`, scanno, findings-scannos, pptext, hebelist, W1.2, flags
  side product
- **Relates to:** [Pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

`wordcheck_v2_cpu` uses a hard-coded `_DEFAULT_BAD_WORDS` set of ~24 common
OCR misspellings. The research report
`docs/research/findings-scannos.md` recommends licence-clean seed lists
(pptext scannos, hebelist, confusion rules) and a flag-only three-level model;
none of that is shipped as a system list. Separately, Wave 0 must fix the
text-chain contract so wordcheck **flags remain a side product** — not the
sole runner artifact — so list expansion does not re-introduce “flags JSON as
page text.”

## Impact

- Real books produce empty or near-empty flag reports; proofer queue is useless.
- Research investment is stranded; roadmap already parks “scanno research
  productization” as deferred, but W1.2 is the product step for a starter list.
- Risk if flags-only is treated as the runner contract: packaging wrong text
  (B0). This issue assumes W0.0 text pass-through is already in place or
  co-shipped.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
path under test: src/pdomain_prep_for_pgdp/core/pipeline/steps/wordcheck.py
research: docs/research/findings-scannos.md
parent: docs/plans/2026-07-21-pipeline-completion-review.md §W1.2 / B0 note
```

## Evidence

### 1. Tiny default bad-word set

```233:266:src/pdomain_prep_for_pgdp/core/pipeline/steps/wordcheck.py
# Default bad-words list (common scannos for PGDP books).
# In production, this is loaded from the project/system word list store.
...
`_DEFAULT_BAD_WORDS`: frozenset[str] = frozenset(
    {
        "teh",
        "adn",
        "nw",
        "ot",
        "fi",
        "ii",
        "llie",
        "llis",
        "thc",
        "ihe",
        # ... ~24 entries total, no external list load
        "bee",
    }
)
```

### 2. Stage returns flags JSON only (text contract is W0.0)

```269:304:src/pdomain_prep_for_pgdp/core/pipeline/steps/wordcheck.py
def wordcheck_v2_cpu(words_json: bytes, cfg: Any = None) -> bytes:
    ...
    result: dict[str, Any] = {
        "flags": flags,
        "flagged_count": len(flags),
        "total_words": total,
    }
    return json.dumps(result).encode("utf-8")
```

Plan B0 / Architecture: do **not** keep flag-only as the live runner contract;
flags are a side product after the text DAG is fixed.

### 3. Research not productized

`docs/research/findings-scannos.md` (active research, last verified 2026-07-14)
names adopt-ready seeds: `pptext/scannos.txt` + `hebelist.txt` (MIT),
confusion maps from `ocr-stringdist` / SubtitleEdit, Hunspell World layer.
No shipped system list or loader wires those into `wordcheck_bad_words`.

### 4. Plan places list work in Wave 1 after text contract

W1.2 done-when: “Flags non-empty on known bad OCR fixture; package text still
correct.” Explicit: flags remain side product; text pass-through from W0.0.

## Root-cause hypotheses

1. **(Most likely) Scaffold defaults only** — comment says “loaded from
   project/system word list store” but no store or asset path was built.
2. **Licence caution delayed shipping** — research correctly rejects
   non-redistributable wiki lists; starter MIT seeds were never committed.
3. **Blocked on W0.0** — expanding flags without text pass-through would make
   wrong-text packaging worse; list work was correctly sequenced after B0.

## Defects to fix

1. **Ship a real system scanno/bad-word starter list** (research-backed,
   licence-clean) loaded by wordcheck defaults. (Primary)
2. **Keep flags as side product** after W0.0 — do not redefine runner output
   as flags-only.
3. **Hook for project good/bad words** already partially present via
   `cfg.wordcheck_bad_words` / `wordcheck_good_words`; ensure product path
   populates them.

## Next steps

1. Confirm W0.0 text-chain contract is implemented or implement list loading
   without changing “flags JSON as sole artifact” into the package path.
2. Commit starter list (e.g. MIT pptext scannos subset) + loader into
   system defaults or package data files.
3. **Done when (falsifiable):** known bad OCR fixture yields non-empty
   `flags` / `flagged_count > 0`; package / text_review `output.txt` is still
   UTF-8 page prose (not flags JSON); `make ci AI=1` green.

## Resolution

*Open.*
