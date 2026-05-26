"""Tests for the pdomain_book_tools.Word -> OcrWord adapter."""

import pytest


def _make_pd_word(text="hello", left=10, top=20, right=110, bottom=70, confidence=0.95):
    from pdomain_book_tools.geometry.bounding_box import BoundingBox
    from pdomain_book_tools.geometry.point import Point
    from pdomain_book_tools.ocr.word import Word

    bb = BoundingBox(top_left=Point(left, top), bottom_right=Point(right, bottom))
    return Word(text=text, bounding_box=bb, ocr_confidence=confidence)


def test_adapter_extracts_correct_bbox():
    from pdomain_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word(left=10, top=20, right=110, bottom=70)
    result = _to_ocr_word(w)
    assert result.bounding_box.left == 10
    assert result.bounding_box.top == 20
    assert result.bounding_box.width == 100  # 110 - 10
    assert result.bounding_box.height == 50  # 70 - 20


def test_adapter_extracts_text_and_confidence():
    from pdomain_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word(text="World", confidence=0.87)
    result = _to_ocr_word(w)
    assert result.text == "World"
    assert abs(result.confidence - 0.87) < 1e-6


def test_adapter_none_confidence_becomes_zero():
    from pdomain_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word(confidence=None)
    result = _to_ocr_word(w)
    assert result.confidence == 0.0


def test_adapter_raises_on_wrong_type():
    from pdomain_prep_for_pgdp.core.ocr import _to_ocr_word

    with pytest.raises(TypeError, match=r"expected pdomain_book_tools\.ocr\.word\.Word"):
        _to_ocr_word({"text": "bad"})


def test_adapter_split_suffix_propagated():
    from pdomain_prep_for_pgdp.core.ocr import _to_ocr_word

    w = _make_pd_word()
    result = _to_ocr_word(w, split_suffix="a")
    assert result.split_suffix == "a"
