"""M4 disk-cost banner — backend unit tests.

Spec: docs/specs/2026-05-13-m4-migration-disk-cost-design.md §Disk-cost banner

Tests assert:
- _compute_stage_artifacts_bytes returns 0 for fresh project (no stages dir).
- _compute_stage_artifacts_bytes sums all files under pages/*/stages/ recursively.
- _compute_source_zip_bytes returns 0 when source.zip absent.
- _compute_source_zip_bytes returns correct size when source.zip present.
- GET /api/data/projects/{id} includes stage_artifacts_bytes and source_zip_bytes.
- stage_artifacts_bytes is 0 for a project with no stage artifacts.
- FULL_DAG_RATIO constant is 12.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from pd_prep_for_pgdp.api.data.projects import (
    FULL_DAG_RATIO,
    _compute_source_zip_bytes,
    _compute_stage_artifacts_bytes,
)
from pd_prep_for_pgdp.settings import Settings

# ─── Unit tests for filesystem helpers ──────────────────────────────────────


def test_stage_artifacts_bytes_no_pages_dir(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    data_root.mkdir()
    result = _compute_stage_artifacts_bytes(data_root, "proj1")
    assert result == 0


def test_stage_artifacts_bytes_empty_stages(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    pages_dir = data_root / "projects" / "proj1" / "pages" / "0000" / "stages"
    pages_dir.mkdir(parents=True)
    result = _compute_stage_artifacts_bytes(data_root, "proj1")
    assert result == 0


def test_stage_artifacts_bytes_sums_files(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    # Page 0000: grayscale stage with a 200-byte output
    stage_dir = data_root / "projects" / "proj1" / "pages" / "0000" / "stages" / "grayscale"
    stage_dir.mkdir(parents=True)
    (stage_dir / "output.png").write_bytes(b"x" * 200)
    # Page 0001: threshold stage with a 300-byte output
    stage_dir2 = data_root / "projects" / "proj1" / "pages" / "0001" / "stages" / "threshold"
    stage_dir2.mkdir(parents=True)
    (stage_dir2 / "output.png").write_bytes(b"y" * 300)
    result = _compute_stage_artifacts_bytes(data_root, "proj1")
    assert result == 500


def test_stage_artifacts_bytes_nested(tmp_path: Path) -> None:
    """Compound output stages have subdirs — these should also be counted."""
    data_root = tmp_path / "data"
    stage_dir = data_root / "projects" / "proj1" / "pages" / "0000" / "stages" / "ocr"
    stage_dir.mkdir(parents=True)
    (stage_dir / "words.json").write_bytes(b"a" * 100)
    (stage_dir / "raw.txt").write_bytes(b"b" * 50)
    result = _compute_stage_artifacts_bytes(data_root, "proj1")
    assert result == 150


def test_source_zip_bytes_absent(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    data_root.mkdir()
    result = _compute_source_zip_bytes(data_root, "proj1")
    assert result == 0


def test_source_zip_bytes_present(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source_zip = data_root / "projects" / "proj1" / "source.zip"
    source_zip.parent.mkdir(parents=True)
    source_zip.write_bytes(b"z" * 1024)
    result = _compute_source_zip_bytes(data_root, "proj1")
    assert result == 1024


def test_full_dag_ratio_constant() -> None:
    assert FULL_DAG_RATIO == 12


def test_stage_artifacts_bytes_oserror_returns_partial_sum(tmp_path: Path, caplog) -> None:
    """When Path.stat() raises OSError on one file, the function returns a partial
    sum (not zero, not raising), and logs exactly one warning for the first failure.
    """
    import logging
    from unittest.mock import patch

    data_root = tmp_path / "data"
    # Create two files: the first will stat fine (100 bytes), the second will fail.
    stage_dir = data_root / "projects" / "proj1" / "pages" / "0000" / "stages" / "grayscale"
    stage_dir.mkdir(parents=True)
    good_file = stage_dir / "good.png"
    good_file.write_bytes(b"g" * 100)
    bad_file = stage_dir / "bad.png"
    bad_file.write_bytes(b"b" * 50)

    _real_stat = Path.stat
    # Track how many times stat has been called for bad_file.
    # is_file() internally calls stat() too, so we only raise on the *second*
    # call for bad_file (the explicit .stat().st_size call inside the try block).
    _bad_file_stat_calls = 0

    def _mock_stat(self, *args, **kwargs):
        nonlocal _bad_file_stat_calls
        if self == bad_file:
            _bad_file_stat_calls += 1
            if _bad_file_stat_calls >= 2:
                # Raise on the explicit stat() inside the try block (not is_file).
                raise OSError("permission denied")
        return _real_stat(self, *args, **kwargs)

    with caplog.at_level(logging.WARNING, logger="pd_prep_for_pgdp"), patch.object(Path, "stat", _mock_stat):
        result = _compute_stage_artifacts_bytes(data_root, "proj1")

    # Function must not raise; returns partial sum (100 bytes from good file only).
    assert result == 100

    # Exactly one WARNING must be logged for the first OSError (not one per file).
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and "disk cost scan" in r.message]
    assert len(warnings) == 1


# ─── Integration tests via TestClient ────────────────────────────────────────


def _make_project(project_id: str) -> dict:
    now = datetime.now(UTC).isoformat()
    return {
        "id": project_id,
        "owner_id": "default",
        "name": "test",
        "created_at": now,
        "updated_at": now,
        "status": "complete",
        "page_count": 1,
        "proof_page_count": 1,
        "config": {
            "book_name": "test",
            "source_uri": "",
            "frontmatter_is_roman": True,
            "frontmatter_page_nbr_start": 1,
            "body_page_nbr_start": 1,
            "proofer_id": None,
            "global_notes": "",
            "chapter_headings": [],
            "initial_crop_all": [0, 0, 0, 0],
            "ocr_crop": [0, 0, 0, 0],
        },
        "pipeline_state": {},
        "storage_prefix": f"projects/{project_id}/",
        "archived": False,
    }


def test_get_project_returns_disk_cost_fields(client, settings: Settings) -> None:
    """GET /api/data/projects/{id} returns stage_artifacts_bytes and source_zip_bytes."""
    # Create a project via the API
    resp = client.post(
        "/api/data/projects",
        json={"name": "disk-cost-test", "source_type": "zip"},
    )
    assert resp.status_code == 200
    project_id = resp.json()["project"]["id"]

    # GET it back — fresh project has no stage artifacts
    resp = client.get(f"/api/data/projects/{project_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert "stage_artifacts_bytes" in body
    assert "source_zip_bytes" in body
    assert body["stage_artifacts_bytes"] == 0
    assert body["source_zip_bytes"] == 0


def test_get_project_stage_artifacts_counted(client, settings: Settings) -> None:
    """stage_artifacts_bytes reflects actual files on disk."""
    resp = client.post(
        "/api/data/projects",
        json={"name": "disk-cost-with-stages", "source_type": "zip"},
    )
    project_id = resp.json()["project"]["id"]

    # Manually plant a stage artifact
    stage_dir = settings.data_root / "projects" / project_id / "pages" / "0000" / "stages" / "grayscale"
    stage_dir.mkdir(parents=True)
    (stage_dir / "output.png").write_bytes(b"x" * 512)

    resp = client.get(f"/api/data/projects/{project_id}")
    assert resp.status_code == 200
    assert resp.json()["stage_artifacts_bytes"] == 512


def test_get_project_source_zip_bytes_counted(client, settings: Settings) -> None:
    """source_zip_bytes reflects actual source.zip on disk."""
    resp = client.post(
        "/api/data/projects",
        json={"name": "disk-cost-with-zip", "source_type": "zip"},
    )
    project_id = resp.json()["project"]["id"]

    # Plant a fake source.zip
    source_zip = settings.data_root / "projects" / project_id / "source.zip"
    source_zip.parent.mkdir(parents=True, exist_ok=True)
    source_zip.write_bytes(b"z" * 2048)

    resp = client.get(f"/api/data/projects/{project_id}")
    assert resp.status_code == 200
    assert resp.json()["source_zip_bytes"] == 2048
