---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Regex stage only curly quotes + em dash; full postprocess_text unused (W1.1 / B8)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — packaged page text skips scanno/regex postprocess
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21 pipeline review)
- **Read when:** wiring regex stage depth, text-chain product path, or reconciling `text_postprocess.py` with the v2
  registry.
- **Search terms:** regex stage, postprocess_text, curly quotes, em dash, scannos, custom_regex_passes, B8, W1.1,
  `_text_postprocess_cpu`
- **Relates to:** [Pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

The v2 `regex` stage is registered to `_text_postprocess_cpu`, which only runs
`normalize_curly_quotes` and `normalize_em_dash`. The full Step-8 orchestrator
`postprocess_text` in `core/text_postprocess.py` — system scannos, project
scannos, hyphenation join list, and custom regex passes — is never called by
the registry entry. Downstream package `.txt` therefore lacks the
product-level cleanup the module already implements.

## Impact

- Proofers get only quote/dash normalisation on the live text DAG; known
  scanno replacements and project custom rules do not apply.
- Silent quality gap: stage appears “clean” while text still carries OCR
  stealth errors that `postprocess_text` would fix.
- Duplicates logic surface: pure-function postprocess is tested and ready,
  but the stage path ignores it.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
python: >=3.13
path under test: src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py
                 src/pdomain_prep_for_pgdp/core/text_postprocess.py
parent: docs/plans/2026-07-21-pipeline-completion-review.md §B8 / W1.1
```

## Evidence

### 1. Registry wires regex to shallow helper only

`stage_registry.py` maps `"regex": _text_postprocess_cpu`. That function
imports only the two normalisers and documents that full `postprocess_text`
is deferred (“M3 config plumbing”):

```767:793:src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py
def `_text_postprocess_cpu`(text_bytes: object, cfg: StageConfig = None) -> str:
    """Apply step-8 normalisation to OCR text at default config.
    ...
    curly-quote normalisation and em-dash → double-hyphen conversion.
    The full `postprocess_text` function requires `SystemDefaults` and
    `ProjectConfig` which the runner doesn't have yet (M3 config plumbing).
    ...
    """
    from pdomain_prep_for_pgdp.core.text_postprocess import normalize_curly_quotes, normalize_em_dash
    ...
    text = normalize_curly_quotes(text)
    return normalize_em_dash(text)
```

### 2. Full postprocess exists and is broader

```109:131:src/pdomain_prep_for_pgdp/core/text_postprocess.py
def postprocess_text(
    text: str,
    *,
    system: SystemDefaults,
    project: ProjectConfig,
    straight_quotes: bool = True,
    em_dash_to_double_hyphen: bool = True,
) -> str:
    """Run the full Step-8 pipeline.

    Order: quotes -> em dash -> hyphenation join -> system scannos ->
    project scannos -> custom regex passes.
    """
```

### 3. Models already carry scanno / custom regex fields

`ProjectConfig` / `SystemDefaults` in `core/models.py` define
`standard_scannos`, `custom_scannos`, `custom_regex_passes` — the data model
expects full postprocess, but the stage callable never reads them.

## Root-cause hypotheses

1. **(Most likely) Intentional scaffold** — Slice-era `_text_postprocess_cpu`
   deliberately limited to universal transforms until runner passed
   `SystemDefaults` / `ProjectConfig`; full wire never landed. Confirm by
   searching for any call site of `postprocess_text` from stage/job runners
   (expected: none on the v2 path).
2. **Config plumbing gap only** — runner could pass `cfg` with project
   config today; stage simply does not use it. Distinguisher: inject a
   project with non-empty `custom_scannos` and assert stage output unchanged.

## Defects to fix

1. **Wire `regex` to full `postprocess_text`** with system/project scannos and
   custom regex rules from real config. (Primary)
2. **Supply SystemDefaults + ProjectConfig** into the stage callable (or
   equivalent cfg fields the pure function needs).
3. **Runner-chain test** that a known scanno on fixture text is applied in
   regex `output.txt` (and remains correct through text_review package path).

## Next steps

1. Add failing TDD case: fixture text with a system or project scanno pair
   → after `regex` stage, replacement is present (not only quote/dash changes).
2. Implement registry/callable path that calls `postprocess_text` (or
   equivalent ordered steps) with real defaults + project config.
3. **Done when (falsifiable):** runner chain ocr→…→regex asserts scanno
   apply on fixture text; curly-quote and em-dash behaviour still green;
   `make ci AI=1` green. Matches plan W1.1 done-when.

## Resolution

*Open.*
