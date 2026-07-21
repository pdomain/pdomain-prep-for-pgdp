---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# No golden-path book regression in default CI

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — Wave 0 correctness has no failing-then-passing CI gate
- **Affected version:** pdomain-prep-for-pgdp master
- **Read when:** adding CI coverage for full pipeline, or closing Wave 0 exit criteria
- **Search terms:** golden path, make ci, test_e2e_pipeline, stage_gate_blocked 409, dual-write, package zip png txt,
  W0.6
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md) (W0.6); depends on
  [W0.0/W0.1](2026-07-21-w00-text-chain-contract.md), [W0.2](2026-07-21-w02-project-stage-job-adapter.md),
  [W0.3](2026-07-21-w03-text-review-attestation.md); multi-page covered with
  [W0.4](2026-07-21-w04-multi-page-stage-run.md)

## Summary

Default `make ci` never runs a full source → text → pack golden book path. `tests/test_e2e_pipeline.py` stops when
`build_package` is gate-blocked (409). Pure packaging and per-stage unit tests stay green while the live dual-write
chain cannot produce attested real text and a matched png/txt zip. W0.6 belongs in default CI, not a deferred Wave 3
item.

## Impact

- Regressions in text-chain contract, attestation, and job kwargs can ship with green CI.
- No falsifiable "book path works" signal for Wave 0 exit.
- Playwright e2e is excluded from `make ci` and does not substitute for this API golden path.
- Depends on W0.0–W0.3; the test should fail before those land and pass after.

## Environment / versions

```text
repo: pdomain-prep-for-pgdp
branch: master (docs baseline 2026-07-21)
make ci: setup frontend-install pre-commit typecheck openapi frontend-build test frontend-*
make test: uv run pytest tests/ -v --ignore=tests/e2e
```

## Evidence

### 1. make ci does not run a golden book path

`Makefile` `ci` target runs `test` (pytest under `tests/` ignoring `tests/e2e`). There is no dedicated golden-path
target or DocTR-real book job in that chain.

### 2. Existing e2e pipeline test stops at gate 409

`tests/test_e2e_pipeline.py` ~109–113:

```python
# build_package will be gate-blocked (validation not yet clean) → 409, not 404.
pkg = client.post(f"/api/data/projects/{project_id}/project-stages/build_package/run")
assert pkg.status_code == 409, ...
assert pkg.json()["error"] == "stage_gate_blocked"
```

That asserts the gate exists. It does not attest pages, run text stages, or open a zip.

### 3. Plan requires content assertions, not only "stages ran"

Parent plan W0.6 / Wave 0 exit: 3-page synthetic book; hermetic OCR mock or tesseract that dual-writes real keys; topo
stages through build_package. Assert:

1. Page `.txt` is real text, not wordcheck flags JSON.
2. Each page `attestation.status == "clean"` after attest.
3. Dual-write rows clean for N pages.
4. Zip contains matched png/txt pairs.

### 4. Blockers that make a honest golden test red today

- W0.0/W0.1 text-chain + compound load ([issue](2026-07-21-w00-text-chain-contract.md))
- W0.2 project job kwargs ([issue](2026-07-21-w02-project-stage-job-adapter.md))
- W0.3 per-page attestation writer ([issue](2026-07-21-w03-text-review-attestation.md))

Multi-page shell run (W0.4) is part of Wave 0 exit criterion 4; golden test may drive the API per page if shell is not
ready.

## Root-cause hypotheses

1. **(Most likely) Coverage optimized for unit and partial e2e scaffolds** — full dual-write book path was expensive and
   blocked on B0–B3, so CI never gained a failing golden test first.
2. **Gate-blocked 409 treated as success for route existence** — useful for W0.1 route wiring, insufficient for product
   readiness.
3. **Golden path parked as W3.1 then moved to W0.6** — plan now forbids re-deferring.

## Defects to fix

1. **Add a failing-then-passing golden API test to `make test` / `make ci`** (primary).
2. **Hermetic OCR** — mock or fixture that dual-writes real `words.json` + `raw.txt` (or equivalent keys after contract
   fix); no network DocTR required in default CI.
3. **Assert content correctness** — real text not flags; clean attestation; N-page dual-write; matched png/txt in zip.
4. **Keep the test red until W0.0–W0.3 land** — do not weaken assertions to match broken behavior.

## Next steps

1. Skeleton golden test first (TDD): 3-page synthetic book; expect failure on current master.
2. Implement W0.0–W0.3 until the test goes green (or land test + xfail only if process requires; plan prefers
   red-then-green).
3. Ensure `make ci AI=1` runs the test without Playwright or GPU.
4. Document fixture location and how to extend to more pages later.

## What is NOT broken (to scope the fix)

- Pure `build_package` zip assembly tests with pre-seeded artifacts.
- Playwright suite under `tests/e2e/` (still optional; W3.2 is separate smoke promotion).
- Stage registry unit completeness tests.

## Done when

Golden-path API test is in `make test` / `make ci` and green after W0.0–W0.3. It asserts: real text not flags;
attestation clean; N pages dual-write; matched png/txt in zip. Test fails on master before those fixes.

## Resolution

*Open.*
