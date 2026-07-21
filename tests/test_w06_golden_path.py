"""W0.6 — golden-path book regression in default CI.

Issue: docs/issues/2026-07-21-w06-golden-path-ci.md

Hermetic 3-page path (no DocTR / GPU):
  seed OCR compound + image stages → text chain → attest → page_order
  → pack via project-stage kwargs adapter → zip with matched png/txt.

Asserts:
  1. text_review output.txt is UTF-8 prose, not wordcheck flags JSON
  2. attestation.status == clean per page
  3. dual-write page_stages clean for text_review
  4. build_package zip contains matched {prefix}.png + {prefix}.txt
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import PageStageStatus
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    commit_stage_artifacts_multi,
)
from pdomain_prep_for_pgdp.core.pipeline.project_stage_kwargs import (
    build_project_stage_call_kwargs,
    project_stage_artifact_path,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pdomain_prep_for_pgdp.core.pipeline.steps.build_package import build_package_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.steps.validation import validation_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.steps.zip_stage import zip_v2_cpu
from pdomain_prep_for_pgdp.core.pipeline.text_review_attestation import attest_text_review_page


def _png_bytes(h: int = 40, w: int = 30) -> bytes:
    import cv2

    img = np.full((h, w, 3), 180, dtype=np.uint8)
    img[5:35, 5:25] = 20
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _ocr_words(page_text: str) -> list[dict[str, object]]:
    words: list[dict[str, object]] = []
    for i, token in enumerate(page_text.replace("\n", " ").split()):
        words.append(
            {
                "id": f"w{i}",
                "text": token,
                "confidence": 0.99,
                "bounding_box": {"x": i * 12, "y": 0, "w": 10, "h": 12},
                "deleted": False,
            }
        )
    return words


@pytest.mark.asyncio
async def test_golden_path_three_page_book_prose_attest_and_zip(tmp_path: Path) -> None:
    project_id = "gold1"
    data_root = tmp_path
    page_ids = ["0000", "0001", "0002"]
    page_texts = [
        "The quick brown fox.\n",
        "Jumps over the lazy dog.\n",
        "Third page of the book.\n",
    ]
    prefixes = ["p001", "p002", "p003"]

    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()

    png = _png_bytes()
    for page_id, text, _prefix in zip(page_ids, page_texts, prefixes, strict=True):
        await db.init_page_stages_for_page(project_id, page_id)

        # Proofing image for package
        await commit_stage_artifact(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="canvas_map",
            artifact_bytes=png,
        )

        # Hermetic OCR compound (no DocTR)
        await commit_stage_artifacts_multi(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="ocr",
            files={
                "words.json": json.dumps(_ocr_words(text)).encode("utf-8"),
                "raw.txt": text.encode("utf-8"),
            },
            primary_filename="words.json",
        )

        # Text chain through dual-write runner
        for stage_id in ("wordcheck", "hyphen_join", "regex", "text_review"):
            state = await run_stage(
                data_root=data_root,
                database=db,
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
            )
            assert state.status == PageStageStatus.clean, f"{page_id}/{stage_id}: {state.error_message!r}"

        # W0.3 attest
        att = await attest_text_review_page(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            actor_id="ci",
        )
        assert att["status"] == "clean"

        # Content assertions: prose not flags
        tr_dir = data_root / "projects" / project_id / "pages" / page_id / "stages" / "text_review"
        final = (tr_dir / "output.txt").read_text(encoding="utf-8")
        assert final.strip()
        assert "flags" not in final
        if final.strip().startswith("{"):
            parsed = json.loads(final)
            assert "flags" not in parsed
        # page prose retained (hyphen/regex identity on clean text)
        assert any(tok in final for tok in text.split() if len(tok) > 3)

        att_disk = json.loads((tr_dir / "attestation.json").read_text(encoding="utf-8"))
        assert att_disk["status"] == "clean"

        row = await db.get_page_stage(project_id, page_id, "text_review")
        assert row is not None and row.status == PageStageStatus.clean

        # wordcheck flags side product still present
        flags_path = (
            data_root / "projects" / project_id / "pages" / page_id / "stages" / "wordcheck" / "flags.json"
        )
        assert flags_path.is_file()
        flags = json.loads(flags_path.read_text(encoding="utf-8"))
        assert "flags" in flags

    # Naming manifest for build_package
    po_dir = data_root / "projects" / project_id / "stages" / "page_order"
    po_dir.mkdir(parents=True)
    (po_dir / "output.json").write_text(
        json.dumps(
            {
                "version": 2,
                "pages": [
                    {
                        "page_id": pid,
                        "idx0": int(pid),
                        "role": "normal",
                        "prefix": pref,
                    }
                    for pid, pref in zip(page_ids, prefixes, strict=True)
                ],
                "skip_ids": [],
            }
        ),
        encoding="utf-8",
    )

    # Validation must not report unattested_text_review
    report = json.loads(
        validation_v2_cpu(project_id=project_id, page_ids=page_ids, data_root=data_root).decode()
    )
    unattested = [b for b in report.get("blockers", []) if b.get("code") == "unattested_text_review"]
    assert unattested == [], unattested

    common = {
        "project_id": project_id,
        "page_ids": page_ids,
        "data_root": data_root,
        "book_name": "Golden Book",
        "started_at_iso": "2026-07-21T12:00:00+00:00",
        "cfg": None,
    }
    b_kw = build_project_stage_call_kwargs(
        stage_id="build_package",
        impl_callable=build_package_v2_cpu,
        **common,  # type: ignore[arg-type]
    )
    zip_bytes = build_package_v2_cpu(**b_kw)  # type: ignore[arg-type]
    assert isinstance(zip_bytes, bytes) and len(zip_bytes) > 0

    bp_path = project_stage_artifact_path(data_root, project_id, "build_package")
    bp_path.parent.mkdir(parents=True, exist_ok=True)
    bp_path.write_bytes(zip_bytes)

    z_kw = build_project_stage_call_kwargs(
        stage_id="zip",
        impl_callable=zip_v2_cpu,
        **common,  # type: ignore[arg-type]
    )
    z_out = zip_v2_cpu(**z_kw)  # type: ignore[arg-type]
    manifest = json.loads(z_out.decode("utf-8"))
    assert manifest["sha256"] == hashlib.sha256(zip_bytes).hexdigest()
    assert len(manifest["sha256"]) == 64

    # Matched png/txt pairs for each prefix
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        for pref, expected_text in zip(prefixes, page_texts, strict=True):
            png_name = f"{pref}.png"
            txt_name = f"{pref}.txt"
            assert png_name in names, f"missing {png_name} in {sorted(names)}"
            assert txt_name in names, f"missing {txt_name} in {sorted(names)}"
            body = zf.read(txt_name).decode("utf-8")
            assert "flags" not in body
            assert any(tok in body for tok in expected_text.split() if len(tok) > 3)
