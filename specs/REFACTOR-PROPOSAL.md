# Refactor Proposal — From Notebook Config to Project Manager

This document captures proposed changes to the pdomain-prep-for-pgdp specs to reframe
the tool as a project-manager-style application with a simple local install path
and an optional hosted path.

---

## Summary

The current specs have solid bones — the deployment-mode abstraction (local vs
cloud), `IStorage`, and `GPUBackend` interfaces are the right primitives — but
the framing is still notebook-shaped:

1. A single ~150-line `BookConfig` carries per-page override dicts that should
   live on individual pages.
2. Two backend stacks (Hono Node + FastAPI Python) double the local install
   burden in exchange for hosted-mode cold-start savings.
3. Configuration mixes book identity with image-processing tunables that
   shouldn't be book-level at all.

Three changes fix this:

1. **Three-tier config** (system defaults → project config → per-page overrides)
2. **Single Python FastAPI process** (drop Hono)
3. **Three deployment shapes** (local / self-hosted / managed) instead of four

---

## Change 1 — Three-tier configuration

The notebook had one giant config because it had no project model. The new app
has projects and pages — use them.

### Layer A: System defaults

Stored at `~/.config/pgdp-prep/defaults.json` (local) or a `system_defaults`
table (hosted). Editable in a Settings page.

| Field | Notes |
|---|---|
| `text_threshold` | Default fallback when Otsu is bad |
| `page_h_w_ratio` | Default target canvas aspect |
| `default_fuzzy_pct` | Edge-finding smoothing |
| `default_pixel_count_columns` | Edge-finding sensitivity |
| `default_pixel_count_rows` | Edge-finding sensitivity |
| `ocr_engine` | `"doctr"` or `"tesseract"` default |
| `ocr_model_key` | Default DocTR model profile |
| `ocr_dpi` | For Tesseract |
| Standard scanno list | Book-agnostic |
| Hyphenation join list | Book-agnostic (currently `hyphenated-line-join.json`) |

These are the things you tune once and forget. They never need to live inside
a project.

### Layer B: Project config

Stored at `projects/<id>/project.json`. This is what shows in the "Book Settings"
accordion in the Configure page.

| Field | Notes |
|---|---|
| `book_name` | Identity |
| `source_uri` | zip path, S3 prefix, or local folder |
| `proof_start_idx0` / `proof_end_idx0` | Range |
| `cover_idx0`, `title_idx0` | Optional |
| `frontmatter_start/end_idx0` | Range |
| `bodymatter_start/end_idx0` | Range |
| `frontmatter_page_nbr_start` | First `f001` number |
| `bodymatter_page_nbr_start` | First `p001` number |
| `initial_crop_all` | Scanner-frame strip applied to every page |
| `ocr_crop_top/bottom/left/right` | Uniform OCR crop |
| `custom_regex_passes` | Book-specific |
| `custom_scannos` | Merged with system list |
| `default_overrides` *(optional)* | Override of any system default for this project only |

Roughly 12 fields plus optional defaults. Compare to the current ~30+ fields.

### Layer C: Page record

Stored at `projects/<id>/pages/<idx0>.json` (already exists in spec 08, but
many of these fields currently live in `BookConfig` dicts).

| Field | Notes |
|---|---|
| `idx0`, `prefix`, `source_stem` | Identity |
| `page_type` | `normal` / `blank` / `plate_b` / `plate_p` / `plate_r` |
| `alignment` | `default` / `top` / `center` / `bottom` |
| `splits` | `PageSplit[]` (from spec 06) |
| `illustration_regions` | `IllustrationRegion[]` (from spec 05) |
| `config_overrides.initial_crop` | `[L, R, T, B]` or null |
| `config_overrides.threshold_level` | int 0-255 or null (Otsu) |
| `config_overrides.fuzzy_pct` | float or null |
| `config_overrides.pixel_count_columns` | int or null |
| `config_overrides.pixel_count_rows` | int or null |
| `config_overrides.skip_auto_deskew` | bool or null |
| `config_overrides.deskew_before_crop` | float or null |
| `config_overrides.deskew_after_crop` | float or null |
| `config_overrides.do_morph` | bool or null |
| `config_overrides.use_ocr_bbox_edge` | bool or null |
| `config_overrides.skip_denoise` | bool or null |
| `config_overrides.rotated_standard` | bool or null |
| `config_overrides.single_dimension_rescale` | bool or null |

### Fields removed from `BookConfig`

These ten-ish list/dict fields collapse into per-page properties:

- `plate_pages_b`, `plate_pages_p`, `plate_pages_r` → `page.page_type`
- `non_plate_blank_pages` → `page.page_type = "blank"`
- `align_top_pages`, `align_center_pages`, `align_bottom_pages` → `page.alignment`
- `skip_auto_deskew` → `page.config_overrides.skip_auto_deskew`
- `do_morph` → `page.config_overrides.do_morph`
- `rotated_standard_pages` → `page.config_overrides.rotated_standard`
- `single_dimension_rescale` → `page.config_overrides.single_dimension_rescale`
- `skip_denoise` → `page.config_overrides.skip_denoise`
- `initial_crop` (the dict) → `page.config_overrides.initial_crop`
- `white_space_additional` → `page.config_overrides.white_space_additional`
- `edge_finding_adjust` → `page.config_overrides.fuzzy_pct/pixel_counts`
- `threshold_level_adjust` → `page.config_overrides.threshold_level`
- `deskew_before_crop`, `deskew_after_crop` → page overrides
- `ocr_bbox_edge_pages` → `page.config_overrides.use_ocr_bbox_edge`
- `split_page_sections` → `page.splits` (already moving via spec 06)
- `illustration_regions` → `page.illustration_regions` (already on page in spec 08)

### Resolution helper

Anywhere the pipeline needs a parameter:

```python
class ResolvedPageConfig(BaseModel):
    fuzzy_pct: float
    pixel_count_columns: int
    pixel_count_rows: int
    threshold_level: int | None
    skip_auto_deskew: bool
    # ... etc

def resolve_page_config(
    system: SystemDefaults,
    project: ProjectConfig,
    page: PageRecord,
) -> ResolvedPageConfig:
    """Page override > project default override > system default."""
    ...
```

The pipeline calls `resolve_page_config(...)` once per page; downstream code
sees a flat object.

### Why this matters for the UI

The visual page tagger stops being "edit lists in a book config" and becomes
"browse pages, click to set type / alignment / overrides on each." That's what
a project-manager UI looks like.

The `BookSettings` accordion shrinks dramatically. Most user attention shifts
to the page tagger and PageWorkbench, where it belongs.

---

## Change 2 — Drop Hono; one Python FastAPI process

The Hono + Lambda data API was added for fast cold-start on lightweight CRUD.
Its cost: two languages, two dependency trees, two `.env` files, two dev
terminals (plus a static-file server on `:9001`), and a separate
`packages/api-types` workspace just to share types.

For a "simple install" target this is a non-starter.

### New shape

A single FastAPI process serves:

```
/                  → static frontend bundle (built into the wheel)
/api/data/*        → project + page CRUD (was Hono)
/api/gpu/*         → image processing + OCR (unchanged)
/cdn/*             → local image files (replaces the :9001 static server)
```

In **local mode**: `pip install pgdp-prep && pgdp-prep` launches one process
that opens a browser tab. SQLite or JSON files for metadata. Filesystem for
images. Optional CUDA detected at startup; CPU fallback if absent.

In **hosted mode**: same FastAPI app runs in a container behind ALB. S3 +
Postgres. GPU work optionally dispatched to Modal so the API container can be
small/CPU-only.

### What you give up

- ~200 ms cold-start advantage Hono had over FastAPI on Lambda. Mitigations:
  (a) most CRUD happens during active sessions when the container is warm;
  (b) hosted mode runs FastAPI in a container, not Lambda, so cold-start is
  one-time per deploy; (c) if it still matters, keep Hono but make it strictly
  opt-in for hosted — local install never sees it.
- The `packages/api-types` shared TS workspace. Replace with FastAPI's
  generated OpenAPI spec + `openapi-typescript` codegen on the frontend.

### What you gain

- One language for the backend. One install. One process to deploy.
- One `.env` file. One dev command.
- Pydantic models become the source of truth — no dual-definition drift.
- Frontend bundle ships inside the Python wheel; `pip install` is the entire
  install for a personal user.

### Implementation note

Frontend bundle goes into `pdomain_prep_for_pgdp/static/` inside the Python package.
FastAPI mounts:

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory=resources / "static", html=True), name="ui")
```

`vite build` runs in CI before `python -m build` so the wheel includes the
compiled SPA. `window.__ENV__` injection still works — generated at startup
based on the runtime env vars.

---

## Change 3 — Three deployment shapes, not four

Replace Mode A/B/C/D in spec 09 with:

### Local (default)

- Single Python process: `pgdp-prep` (or `uvx pgdp-prep`)
- Storage: filesystem (`~/pgdp-projects/`)
- Database: SQLite or JSON files
- GPU: local CUDA if present, CPU fallback otherwise
- Auth: none (single user)
- Target user: a proofer on their laptop. Zero AWS, zero Docker.

### Self-hosted (single VM)

- Same Python process on a server (systemd unit)
- Storage: filesystem or S3 (configurable)
- Database: SQLite or Postgres
- GPU: local CUDA on the VM, or dispatch to Modal
- Auth: API key
- Target user: a small team on a single GPU box.

### Managed / SaaS

- Container on ECS Fargate (CPU; small)
- Storage: S3 (CloudFront for CDN)
- Database: Postgres (RDS or Aurora Serverless)
- GPU: Modal for bursts (no always-on GPU instance)
- Auth: Cognito or similar JWT
- Target user: hosted offering for many users.

### Mode-aware code

The only mode-aware code is in adapter selection at startup:

| Interface | Local | Self-hosted | Managed |
|---|---|---|---|
| `IStorage` | filesystem | filesystem or S3 | S3 |
| `IDatabase` | SQLite/JSON | SQLite or Postgres | Postgres |
| `GPUBackend` | local CUDA / CPU | local / Modal | Modal |
| `IAuth` | none | api-key | Cognito |

Everything else is shared. No per-mode forks of the same logic.

---

## Per-spec changes

| Spec | Change |
|---|---|
| `00-overview.md` | Replace two-deployment-mode matrix with three-shape table. Remove Hono row. Update architecture diagrams to single backend service. |
| `01-book-config.md` | **Biggest rewrite.** Strip ~70% of fields out into system defaults and `PageRecord`. Add "What stays at the book level vs. what moves to the page" rationale. Keep `compute_prefix` (structural). |
| `02-pipeline-steps.md` | Each step reads from `ResolvedPageConfig` instead of `BookConfig` dicts. Add `resolve_page_config(...)` helper. |
| `03-ui-layout.md` | `BookSettings` accordion shrinks to ranges + identity. Add separate Settings page for system defaults. Page tagger becomes primary editing surface for page-typed fields. |
| `04-gpu-acceleration.md` | Keep algorithm content as-is. Demote Modal to one variant of `GPUBackend`. Make "no GPU" first-class. |
| `05-illustrations.md` | Move `illustration_regions` from `BookConfig` to `PageRecord` (already mostly there). |
| `06-page-workbench.md` | Already aligned. Minor: `PageConfigOverrides` becomes canonical per-page data, not workbench-only. |
| `07-api-design.md` | Collapse Tier 1 + Tier 2 into single API with `/api/data` and `/api/gpu` namespaces but one server. Drop Hono examples. Drop `packages/api-types` (use OpenAPI codegen). |
| `08-data-models.md` | Drop dual TS + Python definitions. FastAPI OpenAPI is source of truth. Move per-page override fields off `BookConfig` onto `PageRecord`. |
| `09-deployment.md` | Replace four modes with three. Local-development section becomes "ran `pgdp-prep`, done." Docker Compose disappears. CI/CD becomes one service deploy (frontend in the wheel). |

---

## Trade-offs

- **Cold start**: FastAPI on Lambda is ~1–2 s vs Hono's ~200 ms. Mitigated by running FastAPI in a container in hosted mode rather than Lambda.
- **Generated API client**: OpenAPI codegen has friction (Pydantic → TS via `openapi-typescript`). Less elegant than a shared TS package, but no monorepo coordination needed.
- **SQLite vs. JSON for local metadata**: JSON matches current spec, debuggable. SQLite handles concurrent writes and search better. Start with JSON, switch later behind `IDatabase` if needed.
- **Killing `plate_pages_p` etc.**: anyone editing `book_config.json` by hand will dislike this. But "stop editing 150-line configs" is the explicit goal — that's the point.

---

## Suggested order of work

1. Lock high-level shape: confirm Hono drop + three deployment shapes.
2. Rewrite `01-book-config.md` — keystone change. Define `SystemDefaults`,
   trimmed `ProjectConfig`, expanded `PageRecord.config_overrides`,
   `resolve_page_config` helper.
3. Rewrite `08-data-models.md` to match. Drop TS dual definitions.
4. Update `02-pipeline-steps.md` to consume `ResolvedPageConfig`.
5. Rewrite `07-api-design.md` for single FastAPI, OpenAPI codegen.
6. Rewrite `09-deployment.md` for three shapes, single-process install.
7. Update `00-overview.md` last (it summarises the others).
8. Touch up `03/04/05/06` for consistency.

Steps 2-3 can stand alone — they're the actual data model change. Steps 5-6
are the install/deployment story. Either half works without the other.
