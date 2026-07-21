---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Illustrations detect-only; crops.json primary mismatch; pack path extract_illustrations vs illustrations (W1.5 / B6)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — packaged zips omit illustration crops
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21 pipeline review)
- **Read when:** implementing illustration extract, fixing package collectors, or GPU extract routes.
- **Search terms:** illustrations, regions.json, crops.json, hi_res_crops, extract_illustrations, extract-illustration,
  NotImplementedError, B6, W1.5
- **Relates to:** [Pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

The v2 `illustrations` stage runs auto-detect only and writes `regions.json`.
The DAG declares `output_type="hi_res_crops"`, whose compound primary filename
is `crops.json` — not what the stage emits. Package collection still scans
legacy `stages/extract_illustrations/` for crop images, while the stage id is
`illustrations`. The GPU `extract-illustration` route raises
`NotImplementedError`. Result: detect UI may show regions, but zip `images/`
stays empty.

## Impact

- PGDP packages lack `images/` crops for pages with detected illustrations.
- Compound dual-write / primary artifact contract is inconsistent
  (`crops.json` expected vs `regions.json` written).
- GPU extract path hard-fails if called.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
stage: illustrations (V2 page stage)
files:
  core/pipeline/stage_registry.py  (`_illustrations_v2_cpu`)
  core/pipeline/stage_dag.py
  core/pipeline/page_stage_writer.py  (COMPOUND_PRIMARY_FILENAME)
  core/pipeline/steps/build_package.py  (`_collect_illustration_crops`)
  api/gpu/illustrations.py
parent: docs/plans/2026-07-21-pipeline-completion-review.md §B6 / W1.5
```

## Evidence

### 1. Detect-only stage output

```1275:1287:src/pdomain_prep_for_pgdp/core/pipeline/stage_registry.py
def `_illustrations_v2_cpu`(image: ImageArray, cfg: StageConfig = None) -> CompoundStageOutput:
    """v2 illustrations stage: auto_detect + extract (placeholder for extract).
    auto_detect_illustrations runs and returns regions; extract_illustrations
    is a B3 placeholder until hi_res_crops wiring lands.
    """
    ...
    return {
        "regions.json": json.dumps(regions).encode(),
    }
```

### 2. DAG / primary filename expect hi_res_crops → crops.json

```235:240:src/pdomain_prep_for_pgdp/core/pipeline/stage_dag.py
    V2Stage(
        id="illustrations",
        ...
        output_type="hi_res_crops",
    ),
```

```103:107:src/pdomain_prep_for_pgdp/core/pipeline/page_stage_writer.py
COMPOUND_PRIMARY_FILENAME: Final[dict[str, str]] = {
    "words+text": "words.json",
    "hi_res_crops": "crops.json",
    "text+attestation": "output.txt",
}
```

### 3. Package collector uses legacy stage directory name

```93:121:src/pdomain_prep_for_pgdp/core/pipeline/steps/build_package.py
def `_collect_illustration_crops`(
    page_base: Path,
    prefix: str,
) -> list[tuple[str, bytes]]:
    """Scan stages/extract_illustrations/ for crop image files.
    ...
    """
    ill_dir = page_base / "extract_illustrations"
    if not ill_dir.is_dir():
        return []
```

v2 stage artifacts live under `pages/{id}/stages/illustrations/`, not
`extract_illustrations/`.

### 4. GPU extract raises NotImplementedError

```68:74:src/pdomain_prep_for_pgdp/api/gpu/illustrations.py
@router.post(
    "/extract-illustration", response_model=ExtractIllustrationResponse, operation_id="extract_illustration"
)
async def extract_illustration(
    ...
) -> ExtractIllustrationResponse:
    raise NotImplementedError("core.illustrations.extract_illustration not yet wired")
```

## Root-cause hypotheses

1. **(Most likely) Absorb-not-finished** — v1 `auto_detect_illustrations` +
   `extract_illustrations` were merged into one stage id; only detect was
   ported; pack path still names the old stage.
2. **Compound writer incomplete** — `hi_res_crops` multi-artifact writer
   expects `crops.json` + crop files; stage returns a single regions JSON.
3. **GPU extract intentionally stubbed** and never connected to CPU extract
   either.

## Defects to fix

1. **Extract hi-res crops to files** under the `illustrations` stage that
   `build_package` can read. (Primary)
2. **Align primary/compound artifacts** (`crops.json` + crop images vs
   detect-only `regions.json`; keep regions if needed as side product).
3. **Fix collector path** `extract_illustrations/` → `illustrations/` (or
   dual-read during migration).
4. **GPU extract:** implement or return a controlled 501/JSON error instead of
   raw `NotImplementedError` once CPU path works.

## Next steps

1. Failing package test: page with a region → after illustrations +
   build_package, zip contains `images/<prefix>_01.*`.
2. Implement crop extract + write under stage dir; fix collector.
3. **Done when (falsifiable):** zip contains `images/` for a page with a
   region; stage dual-write includes crop files (and primary key matches
   compound contract or documented revision); `make ci AI=1` green.
   Matches plan W1.5 done-when.

## Resolution

*Open.*
