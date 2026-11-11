"""build_submission_zip produces identical bytes for identical inputs.

Issue: docs/issues/2026-11-11-submission-zip-entry-timestamps.md
"""

from __future__ import annotations

import json
import time
import zipfile
from io import BytesIO
from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_submission_zip

if TYPE_CHECKING:
    from pathlib import Path

_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02"
    b"\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)
_PROJECT = "proj-reproducible"
_BUILT_AT = "2026-06-10T12:34:56+00:00"


def _make_project(data_root: Path) -> list[str]:
    """Pages with a proofing PNG, reviewed text and one illustration crop."""
    page_ids = ["0001", "0002"]
    for page_id in page_ids:
        stages = data_root / "projects" / _PROJECT / "pages" / page_id / "stages"
        (stages / "canvas_map").mkdir(parents=True)
        (stages / "canvas_map" / "output.png").write_bytes(_PNG)
        (stages / "text_review").mkdir(parents=True)
        (stages / "text_review" / "output.txt").write_text(f"Page {page_id} text.\n" * 20, encoding="utf-8")
        (stages / "illustrations").mkdir(parents=True)
        (stages / "illustrations" / "crop.png").write_bytes(_PNG)
        (stages / "illustrations" / "crops.json").write_text(
            json.dumps({"crops": [{"file": "crop.png"}]}), encoding="utf-8"
        )
    return page_ids


def _build(data_root: Path, page_ids: list[str], built_at: str | None = _BUILT_AT) -> bytes:
    return build_submission_zip(
        project_id=_PROJECT,
        page_ids=page_ids,
        data_root=data_root,
        book_name="Reproducible",
        page_prefixes={"0001": "f001", "0002": "p001"},
        cover_page_ids=frozenset({"0001"}),
        built_at=built_at,
    )


def _set_zip_clock(monkeypatch: pytest.MonkeyPatch, epoch: float) -> None:
    """Make zipfile see a fixed wall clock without touching the global time module."""
    fake_time = SimpleNamespace(time=lambda: epoch, localtime=time.localtime)
    monkeypatch.setattr(zipfile, "time", fake_time)


def _names(blob: bytes) -> list[str]:
    with zipfile.ZipFile(BytesIO(blob)) as zf:
        return zf.namelist()


def test_two_builds_with_the_clock_moved_are_byte_identical(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page_ids = _make_project(tmp_path)

    _set_zip_clock(monkeypatch, 1_700_000_000.0)
    first = _build(tmp_path, page_ids)
    _set_zip_clock(monkeypatch, 1_800_000_000.0)
    second = _build(tmp_path, page_ids)

    assert sorted(_names(first)) == sorted(
        [
            "f001.png",
            "f001.txt",
            "cover.png",
            "images/f001_01.png",
            "p001.png",
            "p001.txt",
            "images/p001_01.png",
            "pgdp.json",
        ]
    )
    assert first == second


def test_every_entry_time_comes_from_built_at(tmp_path: Path) -> None:
    page_ids = _make_project(tmp_path)

    with zipfile.ZipFile(BytesIO(_build(tmp_path, page_ids))) as zf:
        stamps = {info.filename: info.date_time for info in zf.infolist()}

    assert set(stamps.values()) == {(2026, 6, 10, 12, 34, 56)}


def test_built_at_in_another_zone_is_stored_as_utc(tmp_path: Path) -> None:
    page_ids = _make_project(tmp_path)

    with zipfile.ZipFile(BytesIO(_build(tmp_path, page_ids, "2026-06-10T08:34:56-04:00"))) as zf:
        stamps = {info.date_time for info in zf.infolist()}

    assert stamps == {(2026, 6, 10, 12, 34, 56)}


def test_built_at_before_1980_is_clamped(tmp_path: Path) -> None:
    page_ids = _make_project(tmp_path)

    with zipfile.ZipFile(BytesIO(_build(tmp_path, page_ids, "1970-01-01T00:00:00+00:00"))) as zf:
        stamps = {info.date_time for info in zf.infolist()}

    assert stamps == {(1980, 1, 1, 0, 0, 0)}


def test_entries_stay_deflated_with_owner_read_write(tmp_path: Path) -> None:
    page_ids = _make_project(tmp_path)

    with zipfile.ZipFile(BytesIO(_build(tmp_path, page_ids))) as zf:
        infos = zf.infolist()

    assert {info.compress_type for info in infos} == {zipfile.ZIP_DEFLATED}
    assert {info.external_attr for info in infos} == {0o600 << 16}


def test_built_at_with_no_zone_is_read_as_utc(tmp_path: Path) -> None:
    page_ids = _make_project(tmp_path)

    with zipfile.ZipFile(BytesIO(_build(tmp_path, page_ids, "2026-06-10T12:34:56"))) as zf:
        stamps = {info.date_time for info in zf.infolist()}

    assert stamps == {(2026, 6, 10, 12, 34, 56)}
