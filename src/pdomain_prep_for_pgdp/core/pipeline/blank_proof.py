"""Step 4b — produce a blank proofing image for blank/plate-b/plate-r pages.

A blank PNG sized to the canonical page aspect ratio. Used as the proofing
image so PGDP page numbering stays contiguous even when the actual scan has
no content.
"""

from __future__ import annotations


def create_blank_proof(
    *,
    h_w_ratio: float,
    short_side: int = 1000,
) -> bytes:
    """Return PNG-encoded bytes of a blank canonical-aspect page.

    `h_w_ratio` is height/width, matching `cfg.page_h_w_ratio`. The shorter
    edge is `short_side` pixels.
    """
    import numpy as np  # pyright: ignore[reportMissingImports]

    try:
        import cv2  # pyright: ignore[reportMissingImports]
    except ImportError as e:
        raise RuntimeError("cv2 required for blank-proof generation") from e

    if h_w_ratio >= 1.0:
        height = max(short_side, int(short_side * h_w_ratio))
        width = short_side
    else:
        width = max(short_side, int(short_side / h_w_ratio))
        height = short_side

    img = np.full((height, width), 255, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("cv2.imencode failed for blank proof")
    return bytes(buf.tobytes())
