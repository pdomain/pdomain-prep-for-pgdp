---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Project-stage job runner kwargs do not match stage callables

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — pack chain TypeError via job path; zip/submit_check never get real inputs
- **Affected version:** pdomain-prep-for-pgdp master
- **Read when:** running validation → proof_pack → build_package → zip → submit_check → archive through the job runner
- **Search terms:** job_runner kwargs, book_name TypeError, zip_bytes, submit_check sha256, archive signature, project
  stage adapter, B2, W0.2
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md) (W0.2, B2);
  [text-chain contract](2026-07-21-w00-text-chain-contract.md); [golden-path CI](2026-07-21-w06-golden-path-ci.md)

## Summary

The project-stage job path always passes the same kwargs (`project_id`, `page_ids`, `data_root`, `book_name`, `cfg`).
Comments claim impls ignore extras. Python does not ignore unexpected kwargs. Several pack-chain callables reject those
extras or require parent artifacts the adapter never loads. Unit tests often call pure functions directly, so CI stays
green while the live job path fails.

## Impact

- `validation` and `proof_pack` raise TypeError on unexpected `book_name`.
- `zip` needs `zip_bytes` from build_package; job runner never supplies them.
- `submit_check` needs zip sha256 / size / page_count; not injected.
- `archive` and `source` signatures also mismatch the generic kwargs bag.
- End-to-end pack via jobs is dead until an adapter maps parent artifacts and accepted kwargs.

## Environment / versions

```text
repo: pdomain-prep-for-pgdp
branch: master (docs baseline 2026-07-21)
scope: core/job_runner.py; core/pipeline/steps/{validation,proof_pack,zip_stage,submit_check,archive_stage,build_package}; stage_registry source
```

## Evidence

### 1. Job runner always builds one kwargs bag

`src/pdomain_prep_for_pgdp/core/job_runner.py` ~577–600:

```python
call_kwargs: dict[str, object] = {
    "project_id": project_id,
    "page_ids": page_ids,
    "data_root": data_root,
    "book_name": project.config.book_name if project.config else "",
    "cfg": None,
}
# ...
result_raw = await ... run_in_executor(..., lambda: impl_callable(**call_kwargs))
```

Comment: "pass common kwargs and let the impl ignore extras." That is false for Python callables without `**kwargs`.

### 2. Stage signatures that reject or require different args

| Stage | Signature (actual) | Problem with job kwargs |
|-------|--------------------|-------------------------|
| validation | `project_id, page_ids, data_root, cfg=None` | Extra `book_name` → TypeError |
| proof_pack | `project_id, page_ids, data_root, cfg=None` | Extra `book_name` → TypeError |
| build_package | accepts `book_name` among project kwargs | OK-ish; still needs clean upstreams |
| zip | `zip_bytes, project_id, data_root, recorded_at=None, cfg=None` | Needs `zip_bytes`; gets generic bag |
| submit_check | `project_id, zip_sha256, zip_size_bytes, page_count, data_root, cfg=None` | Needs zip stats not present |
| archive | `project_id, data_root, cfg=None` | Extra `page_ids` / `book_name` → TypeError |
| source | `_source_cpu(source_bytes, cfg=None)` | Expects source bytes, not project kwargs |

Sources: `steps/validation.py` ~206–211; `steps/proof_pack.py` ~112–117; `steps/zip_stage.py` ~99–105;
`steps/submit_check.py` ~126–133; `steps/archive_stage.py` ~131–135; `stage_registry.py` `_source_cpu` ~1194–1201.

### 3. CI blind spot

Pure-function unit tests call `validation_v2_cpu(...)` / `zip_v2_cpu(zip_bytes=...)` with correct args. They never
exercise `impl_callable(**call_kwargs)` from the job runner.

## Root-cause hypotheses

1. **(Most likely) One shared kwargs bag was a temporary scaffold** — comments assumed "ignore extras" from a
   language/runtime that does; Python does not.
2. **Parent artifacts never loaded for project stages** — zip and submit_check need prior stage outputs on disk, not
   only scalar kwargs.
3. **page_order accepts `book_name` and discards it** — that pattern was generalized without updating other signatures.

## Defects to fix

1. **Stage-specific project job adapter** (primary) — load parent artifacts; pass only accepted kwargs per stage.
2. **Feed `zip_bytes` into zip** — read build_package zip bytes (or path) and pass as `zip_bytes`.
3. **Feed zip stats into submit_check** — pass `zip_sha256`, `zip_size_bytes`, `page_count` from zip manifest.
4. **Align source re-run path** — either do not dispatch source through this kwargs bag, or map to the bytes/path
   contract the callable expects.
5. **Job-path tests** that call through the runner, not only pure functions.

## Next steps

1. Write failing tests: job path validation → proof_pack → build_package → zip → submit_check without TypeError; zip
   manifest has sha256.
2. Implement per-stage kwargs adapter (inspect signature or explicit registry map).
3. Load parent project-stage artifacts for zip and submit_check.
4. Re-run `make ci AI=1`.

## What is NOT broken (to scope the fix)

- Pure `build_package_v2_cpu` / `make_deterministic_zip` logic when called with correct args.
- Project stage dual-write row updates after a successful callable return.
- page_order's intentional `book_name` accept-and-ignore pattern.

## Done when

Job-path tests: validation → proof_pack → build_package → zip → submit_check complete without TypeError; zip manifest
has sha256.

## Resolution

*Open.*
