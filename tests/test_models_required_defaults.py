"""Fields with `default_factory=...` must be marked `required` in JSON Schema.

Otherwise `openapi-typescript` codegen produces optional (`?:`) frontend
properties, forcing every consumer to write `if (x !== undefined)` defensively
even though the API always populates the field. See iter-15 of the /loop work
on pdomain-prep-for-pgdp's roadmap for the precipitating discovery.
"""

from __future__ import annotations

from pdomain_ops.gpu import (
    BatchJobItem,
    BatchJobResult,
    OcrPageResponse,
)

from pdomain_prep_for_pgdp.core.models import (
    Job,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    StepState,
    SystemDefaults,
)


def _required(model_cls: type) -> set[str]:
    # Use the *serialization* schema — that's what FastAPI emits for response
    # models in /openapi.json, and what the frontend codegen consumes.
    return set(model_cls.model_json_schema(mode="serialization").get("required", []))


def test_system_defaults_required_includes_default_factory_fields() -> None:
    req = _required(SystemDefaults)
    assert "standard_scannos" in req
    assert "hyphenation_join_list" in req


def test_project_config_required_includes_default_factory_fields() -> None:
    req = _required(ProjectConfig)
    for name in (
        "custom_regex_passes",
        "custom_scannos",
        "layout_category_overrides",
        "default_overrides",
    ):
        assert name in req, f"{name} missing from required: {req}"


def test_page_record_required_includes_default_factory_fields() -> None:
    req = _required(PageRecord)
    for name in ("config_overrides", "splits", "illustration_regions", "outputs"):
        assert name in req, f"{name} missing from required: {req}"


def test_step_state_required_includes_default_factory_fields() -> None:
    req = _required(StepState)
    assert "pages_complete" in req
    assert "pages_error" in req


def test_pipeline_state_required_includes_default_factory_fields() -> None:
    assert "steps" in _required(PipelineState)


def test_job_required_includes_default_factory_fields() -> None:
    req = _required(Job)
    for name in ("progress", "created_at", "payload"):
        assert name in req, f"{name} missing from required: {req}"


def test_project_required_includes_nested_default_factory_fields() -> None:
    # Project itself doesn't use default_factory, but it nests PipelineState
    # — its serialization must still produce schemas with the inner fields required.
    schema = Project.model_json_schema(mode="serialization")
    pipeline_schema = schema["$defs"]["PipelineState"]
    assert "steps" in pipeline_schema.get("required", [])


def test_ocr_page_response_required_includes_default_factory_fields() -> None:
    assert "words" in _required(OcrPageResponse)


def test_batch_job_item_required_includes_default_factory_fields() -> None:
    assert "payload" in _required(BatchJobItem)


def test_batch_job_result_required_includes_default_factory_fields() -> None:
    assert "payload" in _required(BatchJobResult)
