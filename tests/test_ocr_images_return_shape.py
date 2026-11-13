"""Document.from_images_ocr_via_doctr return shapes.

Published pdomain-book-tools returns a Document. Local book-tools master
returns ``(Document, degrees)`` with one clockwise degree per page. The
ndarray OCR path must read the Document from either shape and ignore the
degrees.
"""

from __future__ import annotations

from typing import Any

import pytest

from pdomain_prep_for_pgdp.core.models import SystemDefaults
from pdomain_prep_for_pgdp.core.ocr import ocr_page_from_image
from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

_METHOD = "pdomain_book_tools.ocr.document.Document.from_images_ocr_via_doctr"


class _Page:
    def __init__(self, text: str) -> None:
        self.text = text
        self.words: list[object] = []


class _Doc:
    def __init__(self, page: _Page) -> None:
        self.pages = [page]


class _Layout:
    def detect(self, image: object) -> Any:
        return type("Layout", (), {"regions": []})()


@pytest.mark.parametrize("shape", ["document", "tuple"])
def test_ocr_page_from_image_reads_document_from_either_doctr_shape(
    monkeypatch: pytest.MonkeyPatch,
    shape: str,
) -> None:
    page = _Page("kept sentence")
    doc = _Doc(page)
    image = object()
    predictor = object()
    seen: dict[str, object] = {}

    def _fake(**kwargs: object) -> object:
        seen.update(kwargs)
        if shape == "tuple":
            return (doc, [90])
        return doc

    monkeypatch.setattr(_METHOD, _fake)

    result = ocr_page_from_image(
        image,
        cfg=default_resolved_page_config(),
        system=SystemDefaults(),
        predictor=predictor,
        layout_detector=_Layout(),
        do_reorg=False,
        validate_reorg=False,
        source_identifier="page-scan",
    )

    assert result.text == "kept sentence"
    assert result.page is page
    assert result.words == []
    assert seen["images"] == [image]
    assert seen["source_identifiers"] == ["page-scan"]
    assert seen["predictor"] is predictor


def test_ocr_page_from_image_rejects_an_empty_doctr_tuple(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake(**_kwargs: object) -> object:
        return ()

    monkeypatch.setattr(_METHOD, _fake)

    with pytest.raises(RuntimeError, match="empty tuple"):
        ocr_page_from_image(
            object(),
            cfg=default_resolved_page_config(),
            system=SystemDefaults(),
            predictor=object(),
            layout_detector=_Layout(),
            do_reorg=False,
            validate_reorg=False,
        )
