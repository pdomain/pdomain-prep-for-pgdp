"""W1.7 — v2 submission zip aliases cover.png and can run oxipng."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    ProjectConfig,
)
from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import (
    build_package_v2_cpu,
    build_submission_zip,
)
from tests.fixtures.seed_pages import seed_pages_in_store
from tests.test_png_optimize import _make_png

_PNG_SIG = b"\x89PNG\r\n\x1a\n"


def _write_page(data_root: Path, project_id: str, page_id: str, png: bytes, text: str) -> None:
    base = data_root / "projects" / project_id / "pages" / page_id / "stages"
    (base / "canvas_map").mkdir(parents=True, exist_ok=True)
    (base / "text_review").mkdir(parents=True, exist_ok=True)
    (base / "canvas_map" / "output.png").write_bytes(png)
    (base / "text_review" / "output.txt").write_text(text, encoding="utf-8")


def _names_and_manifest(blob: bytes) -> tuple[set[str], dict[str, object]]:
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = set(zf.namelist())
        manifest = json.loads(zf.read("pgdp.json"))
    return names, manifest


def test_cover_page_is_aliased_to_cover_png(tmp_path: Path) -> None:
    """The first cover page's proofing PNG is also stored as cover.png."""
    project_id = "cover-book"
    cover_png = b"cover-bytes"
    other_png = b"other-bytes"
    _write_page(tmp_path, project_id, "0001", other_png, "body")
    _write_page(tmp_path, project_id, "0000", cover_png, "cover")

    blob = build_submission_zip(
        project_id=project_id,
        page_ids=["0000", "0001"],
        data_root=tmp_path,
        book_name="Cover Book",
        page_prefixes={"0001": "p001", "0000": "000e"},
        cover_page_ids=frozenset({"0000", "0002"}),
        optimize_png=False,
        built_at="2026-11-06T00:00:00+00:00",
    )

    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        assert zf.read("cover.png") == cover_png
        assert zf.read("000e.png") == cover_png
        assert zf.read("p001.png") == other_png
        manifest = json.loads(zf.read("pgdp.json"))
    assert manifest["cover_prefix"] == "000e"
    assert "oxipng_skipped_pages" not in manifest


def test_no_cover_alias_without_a_cover_page(tmp_path: Path) -> None:
    project_id = "plain-book"
    _write_page(tmp_path, project_id, "0000", b"png", "text")
    blob = build_submission_zip(
        project_id=project_id,
        page_ids=["0000"],
        data_root=tmp_path,
        page_prefixes={"0000": "p001"},
        optimize_png=False,
        built_at="2026-11-06T00:00:00+00:00",
    )
    names, manifest = _names_and_manifest(blob)
    assert "cover.png" not in names
    assert "cover_prefix" not in manifest


def test_optimize_png_shrinks_or_keeps_a_real_png(tmp_path: Path) -> None:
    project_id = "opt-book"
    raw = _make_png(32, 32)
    _write_page(tmp_path, project_id, "0000", raw, "text")
    blob = build_submission_zip(
        project_id=project_id,
        page_ids=["0000"],
        data_root=tmp_path,
        page_prefixes={"0000": "000e"},
        cover_page_ids=frozenset({"0000"}),
        optimize_png=True,
        built_at="2026-11-06T00:00:00+00:00",
    )
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        packed = zf.read("000e.png")
        cover = zf.read("cover.png")
        manifest = json.loads(zf.read("pgdp.json"))
    assert packed[:8] == _PNG_SIG
    assert len(packed) <= len(raw)
    assert cover == packed
    assert manifest["oxipng_skipped_pages"] == 0


def test_optimize_png_false_leaves_bytes_untouched(tmp_path: Path) -> None:
    project_id = "raw-book"
    raw = _make_png(16, 16)
    _write_page(tmp_path, project_id, "0000", raw, "text")
    blob = build_submission_zip(
        project_id=project_id,
        page_ids=["0000"],
        data_root=tmp_path,
        page_prefixes={"0000": "p001"},
        optimize_png=False,
        built_at="2026-11-06T00:00:00+00:00",
    )
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        assert zf.read("p001.png") == raw


def test_bad_png_falls_back_and_counts_a_skip(tmp_path: Path) -> None:
    project_id = "bad-book"
    raw = b"this is not a png"
    _write_page(tmp_path, project_id, "0000", raw, "text")
    blob = build_submission_zip(
        project_id=project_id,
        page_ids=["0000"],
        data_root=tmp_path,
        page_prefixes={"0000": "p001"},
        optimize_png=True,
        built_at="2026-11-06T00:00:00+00:00",
    )
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        assert zf.read("p001.png") == raw
        manifest = json.loads(zf.read("pgdp.json"))
    assert manifest["oxipng_skipped_pages"] == 1


def test_v2_callable_loads_cover_ids_from_the_page_store(tmp_path: Path) -> None:
    project_id = "stored-cover"
    cover_png = b"stored-cover"
    body_png = b"stored-body"
    seed_pages_in_store(
        tmp_path,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="000e",
                source_stem="cover",
                page_type=PageType.cover,
            ),
            PageRecord(
                project_id=project_id,
                idx0=1,
                prefix="p001",
                source_stem="body",
                page_type=PageType.normal,
            ),
        ],
    )
    _write_page(tmp_path, project_id, "0000", cover_png, "cover")
    _write_page(tmp_path, project_id, "0001", body_png, "body")
    manifest_path = tmp_path / "projects" / project_id / "stages" / "page_order" / "output.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            {
                "version": 2,
                "pages": [
                    {"page_id": "0000", "idx0": 0, "role": "cover", "prefix": "000e"},
                    {"page_id": "0001", "idx0": 1, "role": "normal", "prefix": "p001"},
                ],
                "skip_ids": [],
            }
        ),
        encoding="utf-8",
    )

    blob = build_package_v2_cpu(
        project_id=project_id,
        page_ids=["0000", "0001"],
        data_root=tmp_path,
        book_name="Stored",
        built_at="2026-11-06T00:00:00+00:00",
        cfg=ProjectConfig(book_name="Stored", source_uri="", optimize_png=False),
    )
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        assert zf.read("cover.png") == cover_png
        assert zf.read("p001.png") == body_png
        manifest = json.loads(zf.read("pgdp.json"))
    assert manifest["cover_prefix"] == "000e"


def test_v2_callable_does_not_create_a_page_store(tmp_path: Path) -> None:
    project_id = "no-store"
    data_root = tmp_path / "data"
    _write_page(data_root, project_id, "0001", b"FAKE_PNG", "text")
    blob = build_package_v2_cpu(
        project_id=project_id,
        page_ids=["0001"],
        data_root=data_root,
        page_prefixes={"0001": "p001"},
        skip_ids=frozenset(),
        built_at="2026-11-06T00:00:00+00:00",
        cfg=ProjectConfig(book_name="No Store", source_uri="", optimize_png=False),
    )
    assert not (data_root / "projects" / project_id / ".pd-pages").exists()
    names, _manifest = _names_and_manifest(blob)
    assert "cover.png" not in names
    assert "p001.png" in names
