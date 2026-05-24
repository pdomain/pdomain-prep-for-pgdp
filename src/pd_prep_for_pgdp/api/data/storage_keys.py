"""Shared storage-key validation helpers.

Used by multiple API routes to assert that a storage key stays scoped to a
specific project prefix. Introduced in #128; shared with #127.
"""

from __future__ import annotations


def assert_project_scoped_key(project_id: str, key: str) -> None:
    """Raise ValueError if *key* does not fall under ``projects/{project_id}/``.

    Strips a leading slash before checking so both CDN-relative and bare
    storage keys are handled consistently.
    """
    clean = key.lstrip("/")
    expected_prefix = f"projects/{project_id}/"
    if not clean.startswith(expected_prefix):
        raise ValueError(f"key must be under projects/{project_id}/; got: {key!r}")
