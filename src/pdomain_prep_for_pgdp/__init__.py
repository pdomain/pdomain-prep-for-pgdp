"""pdomain-prep-for-pgdp — convert scanned book images into a PGDP submission package."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("pdomain-prep-for-pgdp")
except PackageNotFoundError:
    __version__ = "0.0.0+unknown"

__all__ = ["__version__"]
