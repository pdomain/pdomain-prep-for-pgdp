# Lint-rule Deviations — pd-prep-for-pgdp

Standing suppressions and per-file rule overrides in this repo.
Each entry records: the rule, the tool, the file(s) affected, and
the justification. Update this file whenever a new suppression is added.

---

## Python — ruff

### 1. `B008` — ruff (function-call-in-default-argument)

**Config:** `pyproject.toml` `[tool.ruff.lint] ignore = ["B008"]` (project-wide)

**Justification.** FastAPI's canonical dependency-injection pattern uses
`Depends(...)` as a default argument value. This is idiomatic FastAPI and
has no actionable alternative; suppressing the rule globally avoids
hundreds of false positives across all route handlers.

---

### 2. `UP042` — ruff (use-StrEnum)

**Config:** project-wide ignore.

**Justification.** `Foo(str, Enum)` is used widely in the spec and Pydantic
model layer. `StrEnum` is the newer alternative but is semantically
equivalent; switching would be pure churn.

---

### 3. `E501` — ruff (line-too-long)

**Config:** project-wide ignore.

**Justification.** Many long docstrings, error messages, and URLs; enforcing
88-char wrapping everywhere adds noise without improving readability.

---

### 4. `D203`, `D212` — ruff (docstring style conflicts)

**Config:** project-wide ignore.

**Justification.** `D203` (1-blank-before-class-docstring) conflicts with
`D211` (no-blank-before-class-docstring). `D212`
(multi-line-summary-first-line) conflicts with `D213`
(multi-line-summary-second-line). ruff requires picking one of each pair;
the selected alternatives (`D211`, `D213`) are what the Google convention
implies.

---

### 5. `D100`, `D104`, `D107` — ruff (missing docstrings)

**Config:** project-wide ignore.

**Justification.** Missing docstrings on public modules, packages, and
magic methods. Large existing codebase; docstrings are being added
incrementally — a single global enforcement sweep would be invasive.

---

### 6. `PLR0913` — ruff (too-many-arguments)

**Config:** project-wide ignore.

**Justification.** FastAPI route handlers and pipeline stage functions
legitimately need many parameters. Enforcing this rule would require
invasive config-object refactors not warranted by the linting rollout.

---

### 7. `PLR2004` — ruff (magic-value-comparison)

**Config:** project-wide ignore.

**Justification.** Common in OCR geometry and image-threshold code where
literal values (pixel intensities, coordinate offsets) are semantically
clear from context.

---

### 8. `TRY003` — ruff (long-message-outside-exception-class)

**Config:** project-wide ignore.

**Justification.** The service uses f-string error messages everywhere;
requiring a custom exception class per message would be invasive without
readability gain.

---

### 9. `COM812` — ruff (missing-trailing-comma)

**Config:** project-wide ignore.

**Justification.** Conflicts with the ruff formatter's auto-style. Both
cannot be on simultaneously; the formatter wins.

---

### 10. `PLC0415` — ruff (import-not-at-top-level)

**Config:** project-wide ignore.

**Justification.** Deferred imports are a legitimate pattern here: used to
break circular dependency chains (FastAPI dependencies, bootstrap↔adapters)
and to avoid loading optional-heavy modules (`cv2`, `torch`, `cupy`,
`numpy`, `pd_book_tools`) until the pipeline stage that needs them actually
runs. Loading all of these at import time would make the CLI sluggish on
CPU-only installs where most GPU/vision modules are absent.

---

### 11. `PLR0912`, `PLR0911`, `PLR0915` — ruff (complexity)

**Config:** project-wide ignore.

**Justification.** Pipeline functions and OCR adapters legitimately have
high branch/return counts. Enforcing these would require invasive
config-object refactors not warranted by the linting rollout.

---

### 12. `ANN401` — ruff (dynamically-typed-expressions)

**Config:** project-wide ignore.

**Justification.** Some functions legitimately accept or return `Any` —
JSON deserialisers, generic dispatch helpers, FastAPI `app.state` accessors.
The specific sites are documented in the inline comments where they occur.

---

### 13. `D205`, `D105` — ruff (docstring style)

**Config:** project-wide ignore.

**Justification.** `D205` (1-blank-line required between summary and
description) is too noisy across the existing codebase. `D105`
(missing-docstring-in-magic-method) is suppressed because `__repr__`,
`__eq__`, etc. are self-documenting; docstrings will be added
incrementally on new code only.

---

### 14. `T201` — ruff (print)

**Suppression form:** `# noqa: T201` inline.

**Files:** `src/pd_prep_for_pgdp/__main__.py` — three call sites:

- line 147: CLI fallback notice when browser cannot open.
- line 209: `--version` flag; version output goes to stdout by convention.
- line 242: startup banner `Listening on <url>`; intentionally goes to stdout.

**Justification.** These are user-facing CLI messages. Using a logger would
route them through the structured logging pipeline and away from stdout,
breaking the convention for version flags and startup notices.

---

### 15. `N818` — ruff (exception-name-should-be-Error)

**Suppression form:** `# noqa: N818` inline.

**Files:**

- `src/pd_prep_for_pgdp/core/ingest.py` — `ZipImageEntryNotFound(LookupError)`
- `src/pd_prep_for_pgdp/core/pipeline/stage_registry.py` — `StageNotImplemented(RuntimeError)`

**Justification.** These exception names are intentionally non-`Error`
suffixed: `ZipImageEntryNotFound` maps semantically to HTTP 404 (not an
error state); `StageNotImplemented` signals "not yet wired" (a development
marker, not a runtime error). The names are more descriptive than the
`Error`-suffixed alternatives.

---

### 16. `ERA001` — ruff (commented-out code)

**Suppression form:** `# noqa: ERA001` inline.

**Files:** `src/pd_prep_for_pgdp/core/models.py` (3 occurrences, lines 417, 420, 423)

**Justification.** These are inline payload-schema comments for the
`JobType` enum variants — they document what `payload` dict structure each
job type expects. They are load-bearing documentation, not dead code
awaiting deletion.

---

### 17. `E731` — ruff (lambda-assignment)

**Suppression form:** `# noqa: E731` inline.

**Files:** `tests/test_stage_runner.py:88`

**Justification.** A single-expression `lambda` is assigned to `coerce` to
mirror, inline, the exact coercion expression used inside `run_stage` — the
test asserts that the helper reproduces the production behaviour verbatim.
Promoting it to a `def` would obscure the one-to-one correspondence with the
runner code under test. `E731` is not in the `tests/*` per-file-ignore
bundle because lambda assignment is rare in this suite; the inline `noqa`
keeps the suppression narrowly scoped to this one site.

---

### 18. Per-file rule bundles — ruff

**Config:** `[tool.ruff.lint.per-file-ignores]` in `pyproject.toml`.

| File(s) | Rules suppressed | Reason |
|---------|-----------------|--------|
| `tests/*` | `E741, N806, S101, S104, S105, S106, S301, S311, S603, T201, ANN, D, PLR2004, PT011, PT018, S108, PLR0133, PLW2901, PLW1510, PERF401, PERF402, TRY, BLE001` | Test idioms: assert, magic numbers, no annotation/docstring requirement; coordinate names (E741/N806); security rules relaxed; S301 pickle in fixtures; BLE001 in e2e |
| `tests/test_s3_storage.py` | `N803, N805` | Mock class mimics boto3's uppercase keyword argument names (`Params`, `ExpiresIn`) |
| `scripts/*.py` | `T201, D, ANN, S603, S607, PLW1510` | Developer-only helper scripts: print() is the output mechanism; no docstrings/annotations required; partial executable paths fine |
| `**/__init__.py` | `D104, F401, TC` | Re-export modules; `F401` is the public API surface mechanism |
| `**/_*.py` | `D` | Private modules; docstring debt deferred |
| `src/pd_prep_for_pgdp/core/illustrations.py` | `E741, N806, ANN, D, G003, G004, BLE001, TRY, PLW0603` | Coord names; annotation/docstring debt; `PLW0603` global lazy-cache memoisation pattern |
| `src/pd_prep_for_pgdp/core/pipeline/*.py` | `E741, N806, ANN, D, G003, G004, BLE001, TRY, PERF401, S101` | Coord names; annotation/docstring debt; S101 asserts used as guard preconditions |
| `src/pd_prep_for_pgdp/core/models.py` | `E741, ANN, D, TC` | Coord names; annotation debt; TC suppressed (Pydantic models need runtime imports — see entry §18) |
| `src/pd_prep_for_pgdp/api/data/pages.py` | `E741, ANN, D, G003, G004, BLE001, TRY, TC` | Coord names; annotation/docstring debt; TC (Pydantic) |
| `src/pd_prep_for_pgdp/core/ocr.py` | `N806, ANN, D, G003, G004, BLE001, TRY, TC` | L/R/T/B coord locals adapting arbitrary bbox shapes from pd-book-tools |
| `src/pd_prep_for_pgdp/api/gpu/jobs.py` | `E402, ANN, D, TC` | Lazy imports inside functions (cycle-breaking + optional-dep) |
| `src/pd_prep_for_pgdp/core/job_runner.py` | `E402, ANN, D, G003, G004, BLE001, TRY, PERF401, TC` | Same pattern |
| `src/pd_prep_for_pgdp/core/ingest.py` | `ANN, D, G003, G004, BLE001, TRY, PERF401, S101, TC` | Annotation/docstring debt; S101 precondition guards |
| `src/pd_prep_for_pgdp/core/auto_detect.py` | `ANN, D, G003, G004, BLE001, TRY, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/bootstrap.py` | `ANN, D, G003, G004, BLE001, TRY, TC` | Adapter bootstrap wiring; annotation/docstring debt |
| `src/pd_prep_for_pgdp/adapters/**/*.py` | `ANN, D, G003, G004, BLE001, TRY, TC` | Adapter layer annotation/docstring debt |
| `src/pd_prep_for_pgdp/adapters/database/sqlite.py` | `S101, S608` | S101 precondition guard; S608 SQL uses enum literals (not user input) |
| `src/pd_prep_for_pgdp/api/**/*.py` | `ANN, D, G003, G004, BLE001, TRY, TC` | API layer annotation/docstring debt |
| `src/pd_prep_for_pgdp/core/config_resolver.py` | `ANN, D, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/core/text_postprocess.py` | `ANN, D, G003, G004, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/dispatcher/*.py` | `ANN, D, G003, G004, BLE001, TRY, PERF401, TC` | Protocol-like classes; docstring/annotation debt |
| `src/pd_prep_for_pgdp/core/job_events.py` | `ANN, D, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/core/logging_config.py` | `ANN, D, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/core/packaging.py` | `ANN, D, G003, G004, BLE001, TRY, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/core/queue/single_executor.py` | `ANN, D, G003, G004, BLE001, TRY, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/core/stage_events.py` | `ANN, D, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/settings.py` | `ANN, D, TC` | Annotation/docstring debt |
| `src/pd_prep_for_pgdp/cli/*.py` | `ANN, D, G003, G004, BLE001, TRY, TC` | CLI subcommands; docstrings serve as help text (not Google-style) |

---

### 19. `TC` — ruff (type-checking imports)

**Config:** suppressed on all `src/pd_prep_for_pgdp/**/*.py` that define
Pydantic models or are in the adapter/API/core layers.

**Justification.** ruff's `TC` auto-fix moves runtime imports into
`TYPE_CHECKING` blocks. When `from __future__ import annotations` is active,
Pydantic v2 evaluates annotations lazily as strings, and type-checking-only
imports are not present at runtime — this breaks model validation. The
correct fix is to use `model_rebuild()` or remove `from __future__ import
annotations`, neither of which is done globally yet. `TC` is suppressed
until the Pydantic models are migrated. See inline comment in `pyproject.toml`.

---

## Python — basedpyright

### 20. `reportMissingImports` — basedpyright

**Suppression form:** `# pyright: ignore[reportMissingImports]` inline.

**Files:**

- `src/pd_prep_for_pgdp/bootstrap.py` — `import cupy`
- `src/pd_prep_for_pgdp/adapters/auth/jwt_.py` — `import jwt as pyjwt`, `from jwt import PyJWKClient`
- `src/pd_prep_for_pgdp/adapters/storage/s3.py` — `import boto3`
- `src/pd_prep_for_pgdp/adapters/database/postgres.py` — `from psycopg import AsyncConnection`
- `src/pd_prep_for_pgdp/core/illustrations.py` — `pd_book_tools.layout.types`, `numpy`, `cv2`
- `src/pd_prep_for_pgdp/core/ocr.py` — `torch`, `torch.backends.mps`, `pd_book_tools.*`, `pytesseract`, `PIL.Image`
- `src/pd_prep_for_pgdp/core/ingest.py` — `numpy`, `cv2`
- `src/pd_prep_for_pgdp/core/auto_detect.py` — `numpy`, `cv2`
- `src/pd_prep_for_pgdp/core/pipeline/blank_proof.py` — `numpy`, `cv2`
- `src/pd_prep_for_pgdp/core/pipeline/crop_for_ocr.py` — `numpy`, `cv2`
- `src/pd_prep_for_pgdp/core/pipeline/stage_registry.py` — `pd_book_tools.image_processing.cv2_processing`

**Justification.** These are optional-extra or deployment-specific
dependencies:

- `cupy` — GPU extra (`[gpu]`); guarded by `require_cupy()`.
- `jwt` / `boto3` / `psycopg` / `modal` — deployment-specific extras
  (`[jwt]`, `[s3]`, `[postgres]`, `[modal]`). Each adapter import is wrapped
  in a `try/except ImportError` with a clear diagnostic.
- `pd_book_tools`, `numpy`, `cv2`, `torch`, `PIL`, `pytesseract` —
  not installed in the basedpyright dev venv (49 such suppressions, as
  noted in the `pyproject.toml` comment). These are runtime deps that
  work fine when the full package is installed; the stubs are absent only
  during type-checking.

basedpyright does not accept `# type: ignore[import-not-found]` (a mypy
code); `# pyright: ignore[reportMissingImports]` is the correct form.

---

### 21. `reportReturnType` — basedpyright

**Suppression form:** `# pyright: ignore[reportReturnType]` inline.

**Files:**

- `src/pd_prep_for_pgdp/bootstrap.py:73` — `PostgresDatabase` partial impl;
  `page_stage` methods are pending.
- `src/pd_prep_for_pgdp/bootstrap.py:146` — `_NoOpGPUBackend` partial stub;
  never called in the real pipeline.
- `src/pd_prep_for_pgdp/api/data/pages.py:919` — `JSONResponse` wraps a
  `JobState` but the route return type is `JobState`; the `JSONResponse`
  short-circuit path carries the same payload shape.

**Justification.** Partial stub implementations that satisfy the Protocol at
runtime but where the type narrowing does not flow through to pyright. The
stubs are placeholders for real implementations.

---

### 22. `reportIncompatibleMethodOverride` — basedpyright

**Suppression form:** `# pyright: ignore[reportIncompatibleMethodOverride]` inline.

**Files:**

- `src/pd_prep_for_pgdp/adapters/storage/filesystem.py:64`
- `src/pd_prep_for_pgdp/adapters/storage/s3.py:67`

**Justification.** Both override `list_prefix` which is typed as returning
`AsyncIterator[ObjectInfo]`. The implementations use `AsyncGenerator` (which
is an `AsyncIterator`), but basedpyright flags the override as incompatible
due to the generator-vs-iterator type widening. At runtime the types are
compatible.

---

### 23. `reportOptionalMemberAccess` — basedpyright

**Suppression form:** `# pyright: ignore[reportOptionalMemberAccess]` inline.

**Files:**

- `src/pd_prep_for_pgdp/adapters/database/postgres.py:84`

**Justification.** `self._conn` may be `None` in the Protocol interface but
is guaranteed to be set before any method that uses it is called, via
`__aenter__`. Pyright does not narrow across the async-context-manager entry.

---

### 24. `reportMissingTypeArgument` — basedpyright

**Suppression form:** `# pyright: ignore[reportMissingTypeArgument]` inline.

**Files:**

- `src/pd_prep_for_pgdp/bootstrap.py:125` — `_NoOpGPUBackend.run_batch`
  `items: list` (no type argument).
- `src/pd_prep_for_pgdp/adapters/database/sqlite.py:668` —
  `_row_to_page_stage(row: tuple)`.

**Justification.** Both are stub/adapter implementations where the concrete
element type is not meaningful (the stub discards the list; the sqlite row
uses positional access). Adding a type argument would require a protocol
change; deferred to the annotation backlog.

---

### 25. `reportConstantRedefinition` — basedpyright

**Suppression form:** `# pyright: ignore[reportConstantRedefinition]` inline.

**Files:**

- `src/pd_prep_for_pgdp/core/illustrations.py:41` — `_REGION_TYPE_MAP`
  reassigned inside a lazy-init `if` block.

**Justification.** Module-level `_REGION_TYPE_MAP = {}` is initialised as an
empty sentinel, then replaced with the real mapping on first use. This is the
standard lazy-init pattern where the name looks like a constant but is
intentionally reassigned once. `PLW0603` is also suppressed via
per-file-ignores for the same module.

---

### 26. `reportAttributeAccessIssue` — basedpyright

**Suppression form:** `# pyright: ignore[reportAttributeAccessIssue]` inline.

**Files:**

- `src/pd_prep_for_pgdp/core/logging_config.py:139` — `handler._pgdp_managed = True`

**Justification.** Dynamic attribute injected onto a `StreamHandler` to mark
it as managed by this logging config (so it can be idempotently removed on
reconfigure). `StreamHandler` has no `_pgdp_managed` slot in the stubs;
the injection is intentional and narrowly scoped.

---

### 27. `reportArgumentType` — basedpyright

**Suppression form:** `# pyright: ignore[reportArgumentType]` inline.

**Files:** `src/pd_prep_for_pgdp/core/illustrations.py:90` and
`src/pd_prep_for_pgdp/core/ocr.py` (multiple lines, 324–356).

**Justification.**

- `illustrations.py`: `region.type` from `pd_book_tools` stubs is typed
  as a wider union than `_map_region_type` accepts; at runtime only valid
  values reach that call.
- `ocr.py`: `pytesseract.image_to_data` returns `bytes|str|dict` in the
  stubs but `str` is the concrete return for `image_to_string`. The
  individual field accesses (`data["text"]`, `data["conf"]`, etc.) are typed
  as `Any` in the stubs; the suppression covers the argument-narrowing gap.

---

### 28. `reportGeneralTypeIssues` — basedpyright

**Suppression form:** `# pyright: ignore[reportGeneralTypeIssues]` inline.

**Files:** `src/pd_prep_for_pgdp/core/ingest.py:378`

**Justification.** `storage.list_prefix(prefix)` returns `AsyncIterator` but
the concrete implementations return `AsyncGenerator`. basedpyright flags the
`async for` iteration as a general type issue; this is a false positive —
`AsyncGenerator` is a subtype of `AsyncIterator` and is valid in an
`async for`. See also §21 (`reportIncompatibleMethodOverride`).

---

### 29. `reportAssignmentType` — basedpyright

**Suppression form:** `# pyright: ignore[reportAssignmentType]` inline.

**Files:** `src/pd_prep_for_pgdp/core/models.py:118` — `center = "center"`
in a `str, Enum` subclass.

**Justification.** The enum member `center = "center"` shadows `str.center`
(a built-in string method). At runtime, the enum member wins and `str.center`
is not accessible on enum instances. Pyright flags the assignment as a type
mismatch because it sees `str.center` (a method) in scope. The suppression is
correct and intentional: the enum semantics are unambiguous.

---

### 30. `type: ignore[no-any-return]` and `type: ignore[no-untyped-def]` — mypy-style (annotation backlog)

**Suppression form:** `# type: ignore[no-any-return]` and
`# type: ignore[no-untyped-def]` inline.

**Files:**

- `src/pd_prep_for_pgdp/__main__.py:191` — `return mod.main(argv[1:])`
- `src/pd_prep_for_pgdp/adapters/database/sqlite.py:199` — `_run` helper
- `src/pd_prep_for_pgdp/api/server_info.py:42` — `install_server_info`
- `src/pd_prep_for_pgdp/api/healthz.py:78` — `install_healthz`
- `src/pd_prep_for_pgdp/api/env_js.py:50` — `install_env_js`
- `src/pd_prep_for_pgdp/api/dependencies.py` — six `get_*` accessors and two
  `get_job_*` functions
- `src/pd_prep_for_pgdp/api/gpu/__init__.py:10` — `install_gpu_routes`
- `src/pd_prep_for_pgdp/api/cdn.py:43` — `install_cdn_upload`
- `src/pd_prep_for_pgdp/api/data/__init__.py:14` — `install_data_routes`
- `src/pd_prep_for_pgdp/api/auth/__init__.py:8` — `install_auth_routes`
- `src/pd_prep_for_pgdp/bootstrap.py:117` — `_NoOpGPUBackend.name`

**Status — needs review / annotation backlog.** These are mypy-style
suppressions (`# type: ignore[...]` with mypy rule codes). basedpyright uses
`# pyright: ignore[...]` with its own diagnostic names; the mypy codes are
not recognized by basedpyright and are therefore silencing nothing in CI.
These suppressions should be audited in a future pass: either replace with
the appropriate `# pyright: ignore[reportReturnType]` form, or fix the
underlying annotation and remove the suppression entirely.

The `install_*` functions and `get_*` accessors take an untyped `app`
parameter or return `app.state.*` without a declared return type. These are
annotation backlog items in the API wiring layer. Priority: medium.

The `_run` helper in `sqlite.py` takes `*args` with no type annotations —
a signature that would need `*args: Any` plus a return type; deferred to
the sqlite adapter annotation pass.

---

## TypeScript/ESLint (frontend)

### 31. `@typescript-eslint/no-explicit-any` — ESLint

**Suppression form:** `// eslint-disable-next-line @typescript-eslint/no-explicit-any` inline.

**Files:**

- `frontend/src/App.tsx` (lines 303, 312) — `__ENV__` runtime injection from `env.js`
- `frontend/src/App.tsx` (line 318) — `QueryCacheNotifyEvent` type not exported from `@tanstack/react-query`
- `frontend/src/components/shell/UserMenu.tsx:40` — `__ENV__` runtime injection
- `frontend/src/api/client.ts` (lines 10, 22) — `__ENV__` runtime injection
- `frontend/src/pages/LoginPage.tsx:31` — `__ENV__` runtime injection

**Justification.** `__ENV__` is injected at runtime by the backend-served
`env.js` script (see `src/pd_prep_for_pgdp/api/env_js.py`). It is an untyped
global that varies per deployment; there is no compile-time type for it.
The `QueryCacheNotifyEvent` suppression covers a type that is internal to
`@tanstack/react-query` and not re-exported in its public API.

---

### 32. `react-hooks/exhaustive-deps` — ESLint

**Suppression form:** `// eslint-disable-next-line react-hooks/exhaustive-deps` (or `// eslint-disable-line`) inline.

**Files:**

- `frontend/src/hooks/useActiveBatchJob.ts:70`
- `frontend/src/pages/TextReviewPage.tsx:154`
- `frontend/src/components/ArtifactViewer.tsx:152`

**Justification.** These hooks intentionally omit certain dependencies to
avoid infinite re-render loops or because the value is guaranteed stable
by the calling context. Each site should carry an inline explanation of
which dep is omitted and why.

---

### 33. `jsx-a11y/heading-has-content` — ESLint

**Suppression form:** `// eslint-disable-next-line jsx-a11y/heading-has-content` inline.

**Files:** `frontend/src/components/ui/Card.tsx:38`

**Justification.** This is a forwarding component that passes `{...props}` to
the heading element. The content is provided by the caller; ESLint cannot see
through the spread.

---

### 34. `jsx-a11y/click-events-have-key-events`, `jsx-a11y/no-noninteractive-element-interactions`, `jsx-a11y/no-static-element-interactions` — ESLint

**Suppression form:** `// eslint-disable-next-line` inline.

**Files:**

- `frontend/src/components/DiskCostBanner.tsx` (lines 79, 87) — modal dialog
  backdrop/inner panel click handling.
- `frontend/src/pages/PageWorkbenchPage.tsx:1039` — rotate widget arrow-key
  capture.

**Justification.**

- `DiskCostBanner.tsx`: the outer element is `role=dialog`; keyboard close
  is handled by an Escape listener elsewhere. The backdrop click-to-close
  is a UX convenience; ARIA requirements are satisfied by the dialog role
  and the keyboard handler.
- `PageWorkbenchPage.tsx`: the rotate widget is `tabIndex=-1`
  (programmatically focusable only). Adding a full ARIA role would be
  redundant given the widget's visual context.

---

### 35. `jsx-a11y/label-has-associated-control` — ESLint

**Suppression form:** `// eslint-disable-next-line jsx-a11y/label-has-associated-control` inline.

**Files:**

- `frontend/src/components/ArtifactViewer.tsx` (lines 194, 223)
- `frontend/src/pages/ProjectListPage.tsx:304`

**Justification.** Radix UI `Select` wraps a `<button>`, not a native
`<input>`. ESLint cannot see through the component boundary to verify the
label association. The `Input` component in `ProjectListPage.tsx` similarly
wraps a native `<input>` but is opaque to the rule.

---

### 36. `react-refresh/only-export-components` — ESLint

**Suppression form:** `// eslint-disable-next-line react-refresh/only-export-components` inline.

**Files:**

- `frontend/src/components/ui/Dialog.tsx:88`
- `frontend/src/components/ui/AlertDialog.tsx` (lines 80, 82, 84, 86)
- `frontend/src/components/ui/Select.tsx:75`

**Justification.** These files export both React components and non-component
values (context, hooks, or helper constants) from the same module.
`react-refresh` requires component-only exports to enable fast-refresh
boundaries; splitting the exports into separate files would fragment the
module organization without meaningful benefit.

---

### 37. `@typescript-eslint/no-useless-constructor` — ESLint

**Suppression form:** `// eslint-disable-next-line @typescript-eslint/no-useless-constructor` inline.

**Files:** `frontend/src/test/setup.ts:31`

**Justification.** The constructor is required by the test mock class
structure to satisfy the base class signature, even though it delegates to
`super()` with no additional logic.
