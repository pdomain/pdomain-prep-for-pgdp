# 07 — Testing

## What's covered

130 test files in `tests/` collecting ~805 tests (run
`uv run pytest tests/ --collect-only -q --ignore=tests/e2e` for an exact
count). The Vitest SPA suite (`make frontend-test`) sits alongside the
Python suite with ~22 test files covering helpers, API clients, and
mount-level page tests; both are wired into `make ci`.

| Area | Representative files |
|---|---|
| Smoke / wiring | `test_smoke.py`, `test_entry_point.py`, `test_bootstrap_builders.py`, `test_dependencies.py`, `test_healthz.py`, `test_server_info.py` |
| Models / resolver / prefix | `test_config_resolver.py`, `test_assign_prefixes.py`, `test_models_required_defaults.py`, `test_resolved_config_plumbing.py` |
| Pipeline core | `test_blank_proof.py`, `test_crop_for_ocr*.py`, `test_text_postprocess.py`, `test_packaging.py`, `test_cover_title_packaging.py`, `test_illustrations*.py` |
| Stage DAG (AD-1, M1–M6) | `test_pipeline_dag.py`, `test_stage_registry.py`, `test_stage_runner*.py`, `test_stage_write_executor.py`, `test_page_stage_writer.py`, `test_page_stages_schema.py`, `test_stage_events.py`, `test_stage_config_fields.py`, `test_stage_fields_route.py`, `test_stage_thumbnail.py`, `test_async_run_stage_route.py`, `test_run_page_stage_route.py`, `test_list_page_stages_route.py`, `test_get_stage_artifact_route.py`, `test_split_decode_source.py` |
| OCR / detection | `test_auto_detect*.py`, `test_ocr_engine_override.py`, `test_ocr_crop_skip_idxs.py`, `test_ocr_words_persistence.py` |
| Ingest | `test_ingest*.py`, `test_peek_zip_image_names.py`, `test_source_preview*.py` |
| Job runner / events / dispatcher | `test_job_runner*.py`, `test_job_handlers.py`, `test_job_handler_errors.py`, `test_concurrent_jobs.py`, `test_dispatcher_*.py`, `test_job_events*.py`, `test_job_event_types.py`, `test_job_retry.py`, `test_job_cancel.py`, `test_jobs_filter.py`, `test_priority_queue.py`, `test_single_executor_async_cm.py`, `test_cancelled_job_protected.py` |
| Project orchestration (M5) | `test_project_fanout.py`, `test_project_action_routes.py`, `test_project_archive.py`, `test_project_review_status.py`, `test_awaiting_review.py`, `test_review_queue.py` |
| Routes / authz | `test_apikey_auth.py`, `test_jwt_auth.py`, `test_auth_me.py`, `test_projects_route_authz.py`, `test_get_page_route.py`, `test_update_page_route.py`, `test_page_text_route.py`, `test_split_page_route.py`, `test_unsplit_page_route.py`, `test_reorder_pages_route.py`, `test_delete_page_words.py`, `test_assets_routes.py`, `test_gpu_illustration_routes.py`, `test_cdn_upload*.py`, `test_env_js.py`, `test_misc_404_paths.py`, `test_spa_fallback.py`, `test_error_handler.py`, `test_delete_project.py`, `test_project_rename.py` |
| Adapter contracts | `test_filesystem_storage.py`, `test_s3_storage.py`, `test_sqlite_adapter.py`, `test_postgres_adapter.py` (importorskip psycopg), `test_managed_backends.py`, `test_modal_backend.py`, `test_modal_app_import.py`, `test_search_adapter_contract.py` |
| Search (FTS5) | `test_search_route.py`, `test_search_adapter_contract.py`, `test_fts_search.py` |
| Disk-cost / migration (M4) | `test_disk_cost_banner.py`, `test_migrate_projects_cli.py`, `test_reindex_cli.py` |
| Thumbnail pool (AD-9) | `test_thumbnail_pool.py` |
| Dev-local / Makefile guards | `test_detect_dev_local.py`, `test_makefile_ci_target.py`, `test_makefile_openapi_target.py`, `test_openapi_spec_committed.py`, `test_operation_ids_explicit.py` |
| Process management | `test_main_entrypoint.py`, `test_main_env_passthrough.py`, `test_port_autoselect.py`, `test_port_persistence.py`, `test_bootstrap_frontend_dev_mode.py`, `test_logging_structured.py` |
| End-to-end | `test_e2e_ingest.py`, `test_e2e_pipeline.py`, `test_three_page_book_fixture.py`, `test_text_review_alignment.py`, plus the Playwright suite under `tests/e2e/` |

## How to run

```sh
make test AI=1   # uv run pytest tests/ -v --ignore=tests/e2e
make ci AI=1     # full pipeline (lint, openapi-export, frontend-build, pytest, vitest)
make e2e AI=1    # Playwright (separate uv group)
```

`AI=1` captures verbose output to `.ci-ai.log`; stdout shows `✅` on pass
or filtered failure sections on error.

For one targeted file: `uv run pytest -k <pattern>`. Never
`python -m pytest` — bare `python` / `python3` miss the venv.

## Conventions

**TDD-first** for pure-function additions and route handlers. Pattern:
write the test with concrete expected output, run it (red), implement,
run it (green). Examples:

- `test_text_postprocess.py` — exact expected output for each transform.
- `test_packaging.py` — assert specific files in the zip + manifest fields.
- `test_assign_prefixes.py` — assert specific prefixes (with the `f000`
  off-by-one noted in AD-5).
- `test_pipeline_dag.py` — assert DAG parent/child structure stage-by-stage.

**Stub-shaped work** (route stubs, adapter Protocols) is exempt — just
write the stub when no behaviour exists yet.

**Pipeline modules** that depend on cv2 / pdomain-book-tools get
integration-shaped tests on synthetic inputs (e.g. the proofing-chain
stages get a black-on-white round-trip asserting canonical aspect ratio).

## Fixtures (`conftest.py`)

- `settings(tmp_path)` — `Settings(...)` pointing at `tmp_path` for both
  `data_root` and the SQLite database. Filesystem storage, none auth, cpu
  GPU, immediate dispatch.
- `client(settings)` — `TestClient(build_app(settings))`. The TestClient
  enters the FastAPI lifespan, so jobs created in tests actually run (the
  `InProcessJobRunner` is alive while the client is open).
- `PGDP_THUMBNAIL_WORKERS=1` is pinned in tests so the
  `ProcessPoolExecutor` in `core/ingest.generate_thumbnails` (AD-9)
  stays single-process.

A few async tests construct their own `SqliteDatabase` directly (e.g.
`test_text_review_alignment.py`) to seed state before the TestClient
opens. Those use `asyncio.run(_seed())` — using
`get_event_loop().run_until_complete` hijacks the test loop and was the
cause of a historical flake.

## What's deliberately not tested

- **Real DocTR / cv2 model loads** — cost too much per test run. The OCR
  layer mocks `_ocr_page_tesseract` for engine-override testing; the
  Modal layer mocks the `modal` module via
  `monkeypatch.setitem(sys.modules, ...)`.
- **Real Modal dispatch** — no Modal account in the devcontainer.
  `test_modal_backend.py` injects a `FakeFunctionRegistry` so the wire
  shapes are still verified.
- **Live Postgres** — `test_postgres_adapter.py` `importorskip`s
  `psycopg`. Wiring a Postgres service into the dev container is parked
  under roadmap §D2.
- **install.sh end-to-end** — would need internet + a clean shell.
  Parked under §D3.

## Stability notes

Three known sensitive areas, all stable today:

1. **`test_text_review_alignment.py`** seeds via a throwaway `asyncio.run`
   *before* opening the TestClient — using a shared loop caused flakes.
2. **`test_concurrent_jobs.py`** passes `max_concurrency=N` to the runner
   and mocks the ingest handler to sleep deterministically. The SQLite
   cursor lock was needed to make this stable.
3. **`test_ingest_progress.py`** subscribes to the broker BEFORE
   submitting the job, then awaits `listener` after `run_pending`. The
   progress events are guaranteed because the runner publishes
   synchronously from the ingest callback; no `asyncio.sleep` race.
