"""Pipeline orchestration — Steps 4, 4.5, 6, 8, 10 of spec 02.

Each step takes a `ResolvedPageConfig` (spec 01) and operates against the
storage adapter. CPU and GPU backends share this module; the only thing
that changes between them is which `pdomain_book_tools.image_processing.*`
primitives get called (cv2_processing vs cupy_processing).

Both Modal and the CPU backend import from here so the same code drives
every shape.
"""

from .blank_proof import create_blank_proof

__all__ = ["create_blank_proof"]
