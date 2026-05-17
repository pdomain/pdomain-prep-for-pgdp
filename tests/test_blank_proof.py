"""Step 4b — blank-proof generation."""

from __future__ import annotations

import numpy as np
import pytest

from pd_prep_for_pgdp.core.pipeline.blank_proof import create_blank_proof


def test_blank_proof_decodes_to_canonical_aspect() -> None:
    cv2 = pytest.importorskip("cv2")
    png = create_blank_proof(h_w_ratio=1.65, short_side=600)
    decoded = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    h, w = decoded.shape
    # short side is the width when h_w_ratio >= 1
    assert w == 600
    assert h == int(600 * 1.65)
    # all-white
    assert int(decoded.min()) == 255
    assert int(decoded.max()) == 255


def test_blank_proof_landscape() -> None:
    cv2 = pytest.importorskip("cv2")
    png = create_blank_proof(h_w_ratio=0.5, short_side=400)
    decoded = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
    h, w = decoded.shape
    # h_w_ratio < 1 -> width is the longer side
    assert h == 400
    assert w == int(400 / 0.5)
