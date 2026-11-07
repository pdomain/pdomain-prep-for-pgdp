# Lint-rule deviations

## Agent Index

- **Kind:** process
- **Status:** active
- **Last verified:** 2026-11-07
- **Read when:** adding or reviewing a lint or type-check suppression.
- **Search terms:** Ruff, basedpyright, suppression, noqa, pyright ignore.

This guide records configured rules and the reasons for source-local suppression classes.
The configuration table below was checked against pyproject.toml on 2026-11-07.
It is not an exhaustive list of changing source line numbers. The existing
[conventions](../../CONVENTIONS.md#rule-document-every-lint-rule-suppression) govern justification and preferred fixes.

## Global Ruff deviations

| Rules | Existing rationale |
|---|---|
| `B008` | FastAPI dependency defaults use calls |
| `UP042` | Existing string-enum models avoid a semantic-neutral rewrite |
| `E501` | Long errors, URLs, and legacy docstrings use formatter-controlled layout |
| `D203`, `D212` | Conflicting docstring style alternatives are excluded |
| `D100`, `D104`, `D107`, `D105` | Existing module/package/magic-method documentation debt |
| `D205` | Existing docstring spacing debt |
| `PLR0913` | Route and pipeline signatures need many inputs |
| `PLR2004` | Geometry and threshold comparisons use numeric constants |
| `TRY003` | Existing service exceptions construct detailed messages |
| `COM812` | Trailing-comma behavior follows the formatter |
| `PLC0415` | Deferred heavy/optional imports and cycle-breaking imports |
| `PLR0912`, `PLR0911`, `PLR0915` | Pipeline branch, return, and statement complexity |
| `ANN401` | Dynamic JSON, generic dispatch, and application-state boundaries |

## Configured per-file Ruff deviations

Patterns can overlap; the configuration is the authoritative combined rule set.

| Pattern | Configured ignores |
|---|---|
| `tests/*` | `E741`, `N806`, `S101`, `S104`, `S105`, `S106`, `S301`, `S311`, `S603`, `S607`, `T201`, `ANN`, `D`, `PLR2004`, `PT011`, `PT018`, `S108`, `PLR0133`, `PLW2901`, `PLW1510`, `PERF401`, `PERF402`, `TRY`, `BLE001`, `TC` |
| `tests/test_s3_storage.py` | `N803`, `N805` |
| `scripts/*.py` | `T201`, `D`, `ANN`, `S603`, `S607`, `PLW1510` |
| `**/__init__.py` | `D104`, `F401`, `TC` |
| `**/_*.py` | `D` |
| `src/pdomain_prep_for_pgdp/core/illustrations.py` | `E741`, `N806`, `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `PLW0603` |
| `src/pdomain_prep_for_pgdp/core/pipeline/*.py` | `E741`, `N806`, `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `PERF401`, `S101` |
| `src/pdomain_prep_for_pgdp/core/models.py` | `E741`, `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/core/prep_extension.py` | `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/core/page_store_factory.py` | `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/core/split_ops.py` | `ANN`, `D`, `BLE001`, `TRY` |
| `src/pdomain_prep_for_pgdp/api/data/pages.py` | `E741`, `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC`, `S110`, `S112` |
| `src/pdomain_prep_for_pgdp/core/ocr.py` | `N806`, `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |
| `src/pdomain_prep_for_pgdp/api/gpu/jobs.py` | `E402`, `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/core/job_runner.py` | `E402`, `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `PERF401`, `TC` |
| `src/pdomain_prep_for_pgdp/core/ingest.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `PERF401`, `S101`, `TC` |
| `src/pdomain_prep_for_pgdp/core/auto_detect.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |
| `src/pdomain_prep_for_pgdp/bootstrap.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |
| `src/pdomain_prep_for_pgdp/adapters/**/*.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |
| `src/pdomain_prep_for_pgdp/adapters/database/sqlite.py` | `S101`, `S608` |
| `src/pdomain_prep_for_pgdp/api/**/*.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |
| `src/pdomain_prep_for_pgdp/core/config_resolver.py` | `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/core/text_postprocess.py` | `ANN`, `D`, `G003`, `G004`, `TC` |
| `src/pdomain_prep_for_pgdp/dispatcher/*.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `PERF401`, `TC` |
| `src/pdomain_prep_for_pgdp/core/job_events.py` | `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/core/logging_config.py` | `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/core/packaging.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |
| `src/pdomain_prep_for_pgdp/core/queue/single_executor.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |
| `src/pdomain_prep_for_pgdp/core/stage_events.py` | `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/settings.py` | `ANN`, `D`, `TC` |
| `src/pdomain_prep_for_pgdp/cli/*.py` | `ANN`, `D`, `G003`, `G004`, `BLE001`, `TRY`, `TC` |

The broad annotation/docstring groups record existing debt. Logging/exception groups cover older boundary code;
they do not establish that swallowing every exception is safe. Tests use assertions, synthetic credentials,
temporary paths, mocks, and command fixtures. Pydantic runtime model files retain imports that type-only
rewrites can break. SQLite's scoped SQL exception applies to its enum/parameter-controlled query construction.

## Inline Python rationale classes

- `ERA001` in `core/models.py` preserves JobType payload-schema comments; these describe live payload shapes,
  rather than commented-out executable code.
- `E731` in `tests/test_stage_runner.py` keeps the coercion-test lambda aligned with the production expression.
  This exception is local to that test, not part of the general test ignore bundle.

- CLI output uses scoped print suppressions where stdout is part of the interface.
- Exception names use `N818` suppressions for domain names such as missing manifests and dependency failures.
- Coordinate/model adapters use narrow argument, attribute, return, and assignment-type suppressions where
  external or dynamic structures exceed static inference. Current sites include registry GPU returns and page routes.
- Optional CuPy imports and availability sentinels appear in segment and stage-write executors.
  The optional extra is `cuda`, not `gpu`. Missing type metadata differs from an absent runtime dependency.
- Lazy constants and enum members use scoped redefinition/assignment suppressions.
  Examples include illustration caches and model `continue_`/alignment members.
- Private shared-library interactions and dynamic `Any` boundaries retain source-local explanations.
- Legacy mypy-style `type: ignore` annotations still exist, including stage-settings routes.
  Their presence is documentation of debt, not a waiver of the native-basedpyright convention.

Current native diagnostics include missing imports/stubs, argument/call/attribute/return/assignment typing,
constant redefinition, private usage, and dynamic `Any`.
The former incompatible-method, optional-member, missing-type-argument, and general-type-issue inventory
entries no longer describe current native suppression sites.

## Frontend rationale classes

- Runtime environment/query-event bridges use `no-explicit-any` at the API/App/login boundary.
- Some effects intentionally control subscription or hydration lifetimes. Current exhaustive-deps suppressions
  occur in useActiveBatchJob, ProjectsPage, GrayscaleTool, PagesGridTool, and PageOrderTool.
  Their safety depends on the individual effect, not a universal guarantee that omitted inputs are stable.
- XState setup/context bridges and tests use scoped type-assertion exceptions.
- A test exercises an unnecessary-condition branch; draft saving has a guarded non-null assertion.
- Login deliberately focuses its input. ProjectsPage's Input wrapper needs a label-analysis exception.
- ArtifactViewer retains `jsx-a11y/label-has-associated-control` exceptions because its Radix Select wraps a
  button and the rule cannot inspect the component boundary. ProjectsPage has a similar Input-wrapper exception.
- DiskCostBanner uses scoped click/interaction-rule exceptions for backdrop close and inner-panel propagation;
  Escape handling belongs to the dialog. Its rules include `click-events-have-key-events`,
  `no-noninteractive-element-interactions`, and `no-static-element-interactions` under `jsx-a11y`.
  The removed standalone PageWorkbench is not a current suppression location.
- SourceToolFiles uses click/static-interaction exceptions for a hover-only insertion gap;
  keyboard users have the adjacent toolbar button.
- The test constructor exception is scoped to its constructor shape.
- `jsx-a11y/heading-has-content` in the Card heading wrapper permits caller content forwarded through props.
- `react-refresh/only-export-components` covers shared Radix aliases in Dialog, AlertDialog, and Select,
  plus SourceToolFiles' component-adjacent helper export. These are scoped export boundaries, not a global exception.

## Finding the current sites

Use repository search rather than historical line-number counts:

```sh
rg -n 'noqa|type: ignore|pyright: ignore' src tests scripts
rg -n 'eslint-disable' frontend/src
```

Configured rule names and rationale classes were reviewed against pyproject.toml and current inline sites.
This update changes documentation only; it does not add, remove, or approve a code suppression.
