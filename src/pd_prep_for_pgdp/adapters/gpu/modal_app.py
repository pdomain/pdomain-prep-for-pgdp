"""Modal app for pgdp-prep GPU work.

Deployed via `modal deploy src/pd_prep_for_pgdp/adapters/gpu/modal_app.py`.
Defines the three functions ModalBackend looks up: `process_page`, `run_ocr`,
and `run_batch`.

The Modal container runs the same `core.pipeline` and `core.ocr` modules as
the local install — Modal mounts the package source at build time. This is
the spec-09 invariant: "the same pipeline code runs in every shape."
"""

from __future__ import annotations

# Modal isn't a runtime requirement of the wheel — it's only loaded when this
# app is deployed. Wrap everything in a try/except so importing this file in
# a non-Modal environment (e.g. for type-checking) doesn't fail.

try:
    import modal  # type: ignore[import-not-found]

    _MODAL_AVAILABLE = True
except ImportError:
    modal = None  # type: ignore[assignment]
    _MODAL_AVAILABLE = False


if _MODAL_AVAILABLE:
    image = (
        modal.Image.debian_slim(python_version="3.13")
        .apt_install("libgl1", "libglib2.0-0")
        .pip_install(
            "fastapi>=0.115",
            "pydantic>=2.9",
            "huggingface_hub>=0.23",
            "transformers>=4.45",
            "torch",
            "opencv-python-headless",
            "numpy",
            "Pillow",
        )
        .pip_install_from_pyproject("pyproject.toml")
        # Local package mounted into the container so process_page imports work.
        .add_local_python_source("pd_prep_for_pgdp")
    )

    app = modal.App("pgdp-prep", image=image)

    GPU_PROFILE = "T4"  # spec 09 default; flip to "A10G" for speed
    DEFAULT_TIMEOUT_S = 60 * 10  # 10 min per call; batch can go higher

    @app.function(gpu=GPU_PROFILE, timeout=DEFAULT_TIMEOUT_S)
    def process_page(payload: dict) -> dict:
        """Run Step 4 for one page on a Modal GPU container."""
        # Real impl: validate `payload` as ProcessPageRequest, fetch source
        # bytes from S3, run the pipeline, write the proofing image back to
        # S3, return the URL. The scaffold doesn't yet wire the storage
        # adapter inside Modal.
        del payload
        raise NotImplementedError(
            "Modal process_page needs S3 storage wired — scaffold only"
        )

    @app.function(gpu=GPU_PROFILE, timeout=DEFAULT_TIMEOUT_S)
    def run_ocr(payload: dict) -> dict:
        """OCR one page or split on a Modal GPU container."""
        del payload
        raise NotImplementedError(
            "Modal run_ocr needs S3 storage wired — scaffold only"
        )

    @app.function(gpu=GPU_PROFILE, timeout=DEFAULT_TIMEOUT_S * 6)
    def run_batch(payloads: list[dict]) -> list[dict]:
        """Run a batch of items on one warm Modal GPU container.

        Receiving the whole batch in one invocation amortises the ~10s cold
        start across every page (spec 09).
        """
        from pd_prep_for_pgdp.adapters.gpu.base import BatchJobItem, BatchJobResult

        results: list[dict] = []
        for p in payloads:
            item = BatchJobItem.model_validate(p)
            # Per-item dispatch matching CpuBackend.run_batch's shape.
            results.append(
                BatchJobResult(
                    job_type=item.job_type,
                    project_id=item.project_id,
                    idx0=item.idx0,
                    ok=False,
                    error="modal run_batch scaffold — handler not implemented",
                ).model_dump()
            )
        return results
