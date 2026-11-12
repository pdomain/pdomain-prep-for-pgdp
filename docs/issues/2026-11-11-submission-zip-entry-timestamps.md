---
Status: active
Owner: CT
Created: 2026-11-11
Last verified: 2026-11-11
Kind: issue
Level: I2
---

# Submission zip entries carry the current time, so two identical builds can differ

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I2
- **Last verified:** 2026-11-11
- **Resolution:** Open
- **Severity:** Low — one determinism test can fail intermittently; package contents are correct
- **Affected version:** pdomain-prep-for-pgdp master @ `15d5f3c`
- **Read when:** working on `build_submission_zip`, zip reproducibility, or a failing `test_build_zip_chain_determinism`.
- **Search terms:** `build_submission_zip`, `writestr`, `ZipInfo`, `test_build_zip_chain_determinism`,
  byte-identical, `make_deterministic_zip`
- **Relates to:** [pipeline architecture](../architecture/03-pipeline.md)

## Summary

Two builds of `build_submission_zip` from the same inputs can produce different bytes. The function adds each entry
with `ZipFile.writestr` and a bare filename, so Python stamps the entry with the current time. The two builds differ
when they run in different two-second zip time steps. `test_build_zip_chain_determinism` compares the bytes of two
builds and fails when a build crosses that step.

## Impact

- `test_build_zip_chain_determinism` can fail with no code change, which makes full CI intermittent.
- The `built_at` argument fixes the manifest time only, so a caller cannot get a reproducible archive from this
  function today.

## Environment / versions

```
src/pdomain_prep_for_pgdp/core/pipeline/steps/build_package.py  build_submission_zip
tests/test_b4_tail_stages.py  test_build_zip_chain_determinism
```

## Evidence

### 1. Every entry is written with a bare filename — checked 2026-11-11

These lines are an excerpt. The cover and text writes run only when those files exist.

```python
# core/pipeline/steps/build_package.py build_submission_zip
zf.writestr(f"{prefix}.png", img_bytes)                # line 314
zf.writestr("cover.png", img_bytes)                    # line 317
zf.writestr(f"{prefix}.txt", txt_path.read_bytes())    # line 323
zf.writestr(zip_name, data)                            # line 328
zf.writestr("pgdp.json", json.dumps(manifest, indent=2))  # line 354
```

`zip_name` is `images/<prefix>_<NN>.<ext>` from `_collect_illustration_crops`, so illustration entries are affected
too. No call passes a `ZipInfo` with a fixed `date_time`.

The function's docstring promises a byte-identical archive for the same `built_at`. That promise is not true today.

### 2. The test failed on a single byte during a full CI run on 2026-11-10

```
AssertionError: ZIP archive must be byte-identical
At index 109 diff: b'\xee' != b'\xef'
```

The full output is saved in `/mnt/work/projects/pdomain/.artifacts/handoff-20261110/ci2.txt`. That log also holds an
unrelated `test_delete_page_words` failure. The output shows one byte differing by one, which fits a time field but
does not prove which field it was.

## Root-cause hypotheses

1. **(Most likely) `writestr` uses the current time for each entry.** The call pattern in evidence 1 does this by
   design. Comparing `ZipInfo.date_time` for each entry in two differing archives would confirm it.

## Defects to fix

1. **Give every entry a time taken from `built_at`.** Cover all five `writestr` calls in evidence 1. Parse the ISO
   string and clamp it to 1980 or later, because the zip format cannot store earlier dates. A caller that omits
   `built_at` gets the current time, as the docstring already says. That case stays non-reproducible. (Primary)
2. **Keep what `writestr` sets today.** A bare `ZipInfo` uses `ZIP_STORED` and `external_attr` 0. The helper must set
   `compress_type=ZIP_DEFLATED` and `external_attr = 0o600 << 16`. Otherwise entries stop being compressed and lose
   their permissions.

## Next steps

1. Write a failing test that builds twice with the clock moved between builds and asserts identical bytes.
2. Add a test that entries are still deflated.
3. Replace the five `writestr` filename calls with a helper that builds the `ZipInfo`.
4. Check the `built_at` text in the `build_submission_zip` and `build_package_v2_cpu` docstrings still holds.

## What is NOT broken

- The files and names inside the package.
- The `pgdp.json` manifest time when `built_at` is passed.

## Resolution

_Open._ When fixed: set frontmatter and Agent Index `Status: retired`, add the resolving commit here, move the README
pointer to "Resolved", and route the retirement through `doc-retirer`.
