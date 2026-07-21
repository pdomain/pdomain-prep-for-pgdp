"""W0.2 — project-stage job kwargs adapter (B2).

Issue: docs/issues/2026-07-21-w02-project-stage-job-adapter.md

The job runner must not pass a single generic kwargs bag. Per-stage kwargs
must match each callable and load parent artifacts for zip / submit_check.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from pdomain_prep_for_pgdp.core.pipeline.project_stage_kwargs import (
    ProjectStageArtifactError,
    build_project_stage_call_kwargs,
    project_stage_artifact_path,
)
from pdomain_prep_for_pgdp.core.pipeline.steps.archive_stage import archive_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_package_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.steps.proof_pack import proof_pack_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.steps.submit_check import submit_check_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validation_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.steps.zip_stage import zip_v2_cpu


def _base_args(tmp_path: Path) -> dict[str, object]:
    return {
        "project_id": "proj1",
        "page_ids": ["0000"],
        "data_root": tmp_path,
        "book_name": "Book",
        "started_at_iso": "2026-07-21T12:00:00+00:00",
        "cfg": None,
    }


def test_validation_kwargs_exclude_book_name(tmp_path: Path) -> None:
    kw = build_project_stage_call_kwargs(
        stage_id="validation",
        impl_callable=validation_v2_cpu,
        **_base_args(tmp_path),  # type: ignore[arg-type]
    )
    assert "book_name" not in kw
    # Must not raise TypeError
    out = validation_v2_cpu(**kw)  # type: ignore[arg-type]
    assert isinstance(out, bytes)


def test_proof_pack_kwargs_exclude_book_name(tmp_path: Path) -> None:
    kw = build_project_stage_call_kwargs(
        stage_id="proof_pack",
        impl_callable=proof_pack_v2_cpu,
        **_base_args(tmp_path),  # type: ignore[arg-type]
    )
    assert "book_name" not in kw
    out = proof_pack_v2_cpu(**kw)  # type: ignore[arg-type]
    assert isinstance(out, bytes)


def test_archive_kwargs_exclude_page_ids_and_book_name(tmp_path: Path) -> None:
    kw = build_project_stage_call_kwargs(
        stage_id="archive",
        impl_callable=archive_v2_cpu,
        **_base_args(tmp_path),  # type: ignore[arg-type]
    )
    assert "page_ids" not in kw
    assert "book_name" not in kw
    out = archive_v2_cpu(**kw)  # type: ignore[arg-type]
    assert isinstance(out, bytes)


def test_zip_kwargs_load_build_package_bytes(tmp_path: Path) -> None:
    project_id = "proj1"
    zip_bytes = b"PK\x03\x04fake-zip-payload"
    bp_path = project_stage_artifact_path(tmp_path, project_id, "build_package")
    bp_path.parent.mkdir(parents=True, exist_ok=True)
    bp_path.write_bytes(zip_bytes)

    kw = build_project_stage_call_kwargs(
        stage_id="zip",
        impl_callable=zip_v2_cpu,
        project_id=project_id,
        page_ids=["0000"],
        data_root=tmp_path,
        book_name="Book",
        started_at_iso="2026-07-21T12:00:00+00:00",
    )
    assert kw["zip_bytes"] == zip_bytes
    assert "page_ids" not in kw
    assert "book_name" not in kw
    assert "built_at" not in kw
    assert kw.get("recorded_at") == "2026-07-21T12:00:00+00:00"

    out = zip_v2_cpu(**kw)  # type: ignore[arg-type]
    manifest = json.loads(out.decode("utf-8"))
    assert manifest["sha256"] == hashlib.sha256(zip_bytes).hexdigest()
    assert manifest["size_bytes"] == len(zip_bytes)


def test_zip_kwargs_missing_build_package_raises(tmp_path: Path) -> None:
    with pytest.raises(ProjectStageArtifactError, match="build_package"):
        build_project_stage_call_kwargs(
            stage_id="zip",
            impl_callable=zip_v2_cpu,
            **_base_args(tmp_path),  # type: ignore[arg-type]
        )


def test_submit_check_kwargs_from_zip_manifest(tmp_path: Path) -> None:
    project_id = "proj1"
    sha = "a" * 64
    manifest = {
        "project_id": project_id,
        "sha256": sha,
        "size_bytes": 42,
        "file_count": 3,
        "recorded_at": "2026-07-21T12:00:00+00:00",
    }
    zpath = project_stage_artifact_path(tmp_path, project_id, "zip")
    zpath.parent.mkdir(parents=True, exist_ok=True)
    zpath.write_bytes(json.dumps(manifest).encode("utf-8"))

    kw = build_project_stage_call_kwargs(
        stage_id="submit_check",
        impl_callable=submit_check_v2_cpu,
        project_id=project_id,
        page_ids=["0000", "0001"],
        data_root=tmp_path,
        book_name="Book",
        started_at_iso="2026-07-21T12:00:00+00:00",
    )
    assert kw["zip_sha256"] == sha
    assert kw["zip_size_bytes"] == 42
    assert kw["page_count"] == 2
    assert "book_name" not in kw
    assert "page_ids" not in kw

    out = submit_check_v2_cpu(**kw)  # type: ignore[arg-type]
    report = json.loads(out.decode("utf-8"))
    assert report["zip_sha256"] == sha


def test_pack_chain_via_adapter_no_typeerror(tmp_path: Path) -> None:
    """validation → proof_pack → build_package → zip → submit_check via adapted kwargs.

    Seeds page artifacts + page_order naming so build_package can assemble a zip.
    """
    project_id = "proj-pack"
    data_root = tmp_path
    page_id = "0000"
    started = "2026-07-21T12:00:00+00:00"
    book_name = "Pack Book"
    page_ids = [page_id]

    # Page proofing artifacts for build_package
    page_stages = data_root / "projects" / project_id / "pages" / page_id / "stages"
    (page_stages / "canvas_map").mkdir(parents=True)
    (page_stages / "canvas_map" / "output.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 50)
    (page_stages / "text_review").mkdir(parents=True)
    (page_stages / "text_review" / "output.txt").write_text("Hello world.\n", encoding="utf-8")
    (page_stages / "text_review" / "attestation.json").write_text(
        json.dumps({"status": "clean"}), encoding="utf-8"
    )

    # Naming manifest (page_order output)
    po_dir = data_root / "projects" / project_id / "stages" / "page_order"
    po_dir.mkdir(parents=True)
    (po_dir / "output.json").write_text(
        json.dumps(
            {
                "version": 2,
                "pages": [
                    {"page_id": page_id, "idx0": 0, "role": "normal", "prefix": "p001"},
                ],
                "skip_ids": [],
            }
        ),
        encoding="utf-8",
    )

    common = {
        "project_id": project_id,
        "page_ids": page_ids,
        "data_root": data_root,
        "book_name": book_name,
        "started_at_iso": started,
        "cfg": None,
    }

    # validation
    v_kw = build_project_stage_call_kwargs(
        stage_id="validation",
        impl_callable=validation_v2_cpu,
        **common,  # type: ignore[arg-type]
    )
    v_out = validation_v2_cpu(**v_kw)  # type: ignore[arg-type]
    v_path = project_stage_artifact_path(data_root, project_id, "validation")
    v_path.parent.mkdir(parents=True, exist_ok=True)
    v_path.write_bytes(v_out)

    # proof_pack
    p_kw = build_project_stage_call_kwargs(
        stage_id="proof_pack",
        impl_callable=proof_pack_v2_cpu,
        **common,  # type: ignore[arg-type]
    )
    p_out = proof_pack_v2_cpu(**p_kw)  # type: ignore[arg-type]
    p_path = project_stage_artifact_path(data_root, project_id, "proof_pack")
    p_path.parent.mkdir(parents=True, exist_ok=True)
    p_path.write_bytes(p_out)

    # build_package
    b_kw = build_project_stage_call_kwargs(
        stage_id="build_package",
        impl_callable=build_package_v2_cpu,
        **common,  # type: ignore[arg-type]
    )
    assert "book_name" in b_kw
    assert "built_at" in b_kw
    zip_bytes = build_package_v2_cpu(**b_kw)  # type: ignore[arg-type]
    assert isinstance(zip_bytes, bytes) and len(zip_bytes) > 0
    bp_path = project_stage_artifact_path(data_root, project_id, "build_package")
    bp_path.parent.mkdir(parents=True, exist_ok=True)
    bp_path.write_bytes(zip_bytes)

    # zip
    z_kw = build_project_stage_call_kwargs(
        stage_id="zip",
        impl_callable=zip_v2_cpu,
        **common,  # type: ignore[arg-type]
    )
    z_out = zip_v2_cpu(**z_kw)  # type: ignore[arg-type]
    manifest = json.loads(z_out.decode("utf-8"))
    assert len(manifest["sha256"]) == 64
    assert manifest["sha256"] == hashlib.sha256(zip_bytes).hexdigest()
    z_path = project_stage_artifact_path(data_root, project_id, "zip")
    z_path.parent.mkdir(parents=True, exist_ok=True)
    z_path.write_bytes(z_out)

    # submit_check
    s_kw = build_project_stage_call_kwargs(
        stage_id="submit_check",
        impl_callable=submit_check_v2_cpu,
        **common,  # type: ignore[arg-type]
    )
    s_out = submit_check_v2_cpu(**s_kw)  # type: ignore[arg-type]
    assert isinstance(s_out, bytes)
    report = json.loads(s_out.decode("utf-8"))
    # report should reference the zip hash in some form
    report_s = json.dumps(report)
    assert manifest["sha256"] in report_s or report.get("zip_sha256") == manifest["sha256"]
