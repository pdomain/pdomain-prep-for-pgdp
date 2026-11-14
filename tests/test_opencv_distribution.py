"""The environment must hold exactly one OpenCV distribution.

Two OpenCV packages both write `cv2/`, so installing or removing one corrupts
the other and randomly breaks `import cv2`.
"""

from __future__ import annotations

from importlib.metadata import distributions

OPENCV_DISTRIBUTIONS = frozenset(
    {
        "opencv-python",
        "opencv-contrib-python",
        "opencv-python-headless",
        "opencv-contrib-python-headless",
    }
)


def test_environment_holds_only_opencv_python() -> None:
    installed = {
        name.lower().replace("_", "-")
        for dist in distributions()
        if (name := dist.metadata["Name"]) is not None
    }
    assert installed & OPENCV_DISTRIBUTIONS == {"opencv-python"}
