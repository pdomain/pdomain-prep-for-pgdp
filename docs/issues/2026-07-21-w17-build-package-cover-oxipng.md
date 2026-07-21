---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# v2 build_package lacks cover.png + oxipng that legacy packaging has (W1.7 / B9)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — PGDP fidelity gap on submission zip
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21 pipeline review)
- **Read when:** finishing pack fidelity, comparing v2 build_package to core/packaging.py, or deciding CT defer for
  cover/oxipng.
- **Search terms:** cover.png, oxipng, optimize_png, build_package_v2, build_submission_zip, PackagingResult, B9, W1.7
- **Relates to:** [Pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Legacy `core/packaging.py` `build_package` aliases the cover page as
`cover.png` and optionally runs pyoxipng (level 4) on proofing PNGs via
`project.config.optimize_png`. The v2 stage path
`core/pipeline/steps/build_package.py` `build_submission_zip` writes only
prefix PNG/TXT (+ illustration crops when present) and `pgdp.json` — no
cover alias, no oxipng. Plan marks build_package PARTIAL† for this fidelity
gap; product decision is port cover+oxipng into v2 or CT-signed defer.

## Impact

- Submission zips miss PGDP’s automatic cover pickup (`cover.png`).
- Proofing images may be larger than legacy-optimised packages.
- Tests for cover/oxipng exercise legacy packaging only; v2 path can ship
  without those properties unnoticed.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
legacy: src/pdomain_prep_for_pgdp/core/packaging.py
v2:     src/pdomain_prep_for_pgdp/core/pipeline/steps/build_package.py
config: ProjectConfig.optimize_png (core/models.py, default True)
tests (legacy): tests/test_cover_title_packaging.py, tests/test_packaging.py,
                tests/test_png_optimize.py
parent: docs/plans/2026-07-21-pipeline-completion-review.md §B9 / W1.7
dep: pyoxipng>=9.1.1 (pyproject.toml)
```

## Evidence

### 1. Legacy cover.png + oxipng

```119:141:src/pdomain_prep_for_pgdp/core/packaging.py
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for page in sorted(pages, key=lambda p: p.idx0):
            ...
                    if run_optimize:
                        img_bytes = `_optimize_png`(img_bytes, skip_counter=`_skip_counter`)
                    zf.writestr(f"{output.full_prefix}.png", img_bytes)
                # Cover page: first reading-order output of the cover page is
                # aliased as `cover.png` so PGDP picks it up automatically.
                if (
                    page.page_type == `_PageType`.cover
                    ...
                ):
                    zf.writestr("cover.png", img_bytes)
```

`_optimize_png` uses `oxipng.optimize_from_memory` at level 4 with fallback
on failure.

### 2. v2 zip writer: prefix + txt + images + pgdp.json only

```210:251:src/pdomain_prep_for_pgdp/core/pipeline/steps/build_package.py
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for page_id in effective_page_ids:
            ...
            img_path = page_base / "canvas_map" / "output.png"
            if img_path.exists():
                zf.writestr(f"{prefix}.png", img_path.read_bytes())
            ...
            txt_path = page_base / "text_review" / "output.txt"
            ...
            crops = `_collect_illustration_crops`(page_base, prefix)
            ...
        zf.writestr("pgdp.json", json.dumps(manifest, indent=2))
```

No `cover.png`, no call to oxipng / `optimize_png`.

### 3. Config default still expects optimization

`ProjectConfig.optimize_png: bool = True` with docstring “Run lossless oxipng
optimisation on proofing images before packaging” — true for legacy path only
today.

## Root-cause hypotheses

1. **(Most likely) v2 pure-zip rewrite** focused on dual-write artifact
   assembly and naming; cover/oxipng left on the legacy `for_zip` path.
2. **Missing cover identity on v2** — stage may not pass page_type/role into
   `build_submission_zip`, so cover alias needs numbering/role inputs first.
3. **Intentional defer** — plan allows CT-signed “deferred” note instead of
   port; not yet recorded as product decision.

## Defects to fix

1. **Port `cover.png` alias** into v2 `build_submission_zip` when a cover page
   is set (page_type/role from page_order). (Primary for PGDP UX)
2. **Port optional oxipng** honouring `optimize_png` / stage cfg; count skips
   like legacy `PackagingResult`.
3. **Or** record CT-signed explicit defer in the parent plan with owner and
   acceptance of fidelity gap (W1.7 alternative).

## Next steps

1. Decide port vs defer with CT (plan W1.7 allows either).
2. If port: failing tests on v2 zip — cover page set ⇒ `cover.png` in archive
   equal to cover page PNG; `optimize_png=True` ⇒ optimised bytes ≤ input
   (or skip counter behaviour); `optimize_png=False` ⇒ untouched.
3. **Done when (falsifiable):** zip has cover alias when cover page set **or**
   parent plan carries explicit deferred note with owner; oxipng behaviour
   matches decision; `make ci AI=1` green. Matches plan W1.7 done-when.

## Resolution

*Open.*
