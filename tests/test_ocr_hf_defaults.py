"""OCR Hugging Face default pins."""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.ocr import get_predictor


def test_get_predictor_defaults_use_canonical_pdomain_model_repo() -> None:
    assert get_predictor.__kwdefaults__["repo"] == "pdomain/pdomain-ocr-models"
    assert (
        get_predictor.__kwdefaults__["det_filename"] == "detection/pdomain-all-detection-model-finetuned.pt"
    )
    assert (
        get_predictor.__kwdefaults__["reco_filename"]
        == "recognition/pdomain-all-recognition-model-finetuned.pt"
    )
