"""M2 §E — Split-child columns on `PageRecord`.

Spec: `docs/specs/pipeline-task-model.md` §"Splits as sibling pages (Q6 lock)"
→ `Data model on Page` table (locked 2026-05-07).

A split turns one parent page into N **sibling child pages** that each run
the full per-page DAG independently. Each row carries:

| Column | Meaning |
|---|---|
- `parent_page_id` — FK to parent page id; NULL for root pages.
- `source_crop_bbox` — `(x, y, w, h)` on the parent's source image, in
  original-source coords. Required when `parent_page_id IS NOT NULL`.
- `split_index` — 1-based index among siblings (1, 2, 3, ...).
  NULL for root pages.
- `split_at_stage` — Stage on the parent at which the split was created
  (a stage_id string).
- `split_suffix` — User-chosen suffix appended in the page prefix
  (`a`, `b`, `cl`, ...).
- `reading_order` — Output sort order across siblings. Defaults to `0`
  for root pages.

Backward-compat: every existing row gets NULL split fields and
`reading_order = 0`.

Validator: if `parent_page_id` is set, the four other split fields
(`source_crop_bbox`, `split_index`, `split_at_stage`, `split_suffix`) must
also be set. Raise `ValidationError` on partial split rows.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.core.models import PageRecord

# ─── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _root_page(**overrides) -> PageRecord:
    """Build a minimal root (non-split) PageRecord."""
    base = {
        "project_id": "p1",
        "idx0": 0,
        "prefix": "f001",
        "source_stem": "img_0001",
    }
    base.update(overrides)
    return PageRecord(**base)


def _split_child_kwargs() -> dict:
    """Full-valid split-child PageRecord kwargs (every split field set)."""
    return {
        "project_id": "p1",
        "idx0": 1,
        "prefix": "f001a",
        "source_stem": "img_0001",
        "parent_page_id": "0000",
        "source_crop_bbox": (10, 20, 300, 400),
        "split_index": 1,
        "split_at_stage": "auto_detect_attrs",
        "split_suffix": "a",
        "reading_order": 1,
    }


# ─── Defaults / backward compat ──────────────────────────────────────────────


def test_root_page_defaults_split_fields_to_none() -> None:
    """A page with no parent has all split fields NULL/None."""
    page = _root_page()
    assert page.parent_page_id is None
    assert page.source_crop_bbox is None
    assert page.split_index is None
    assert page.split_at_stage is None
    assert page.split_suffix is None


def test_root_page_reading_order_defaults_to_zero() -> None:
    """`reading_order` is the only non-nullable split-related field."""
    page = _root_page()
    assert page.reading_order == 0


@pytest.mark.asyncio
async def test_legacy_page_record_round_trips_through_db(db: SqliteDatabase) -> None:
    """An existing-shape row (no split fields in JSON) round-trips cleanly.

    Legacy rows in production today will not have any of the new split keys
    in their JSON `body`. The Pydantic validator must accept the absence
    and fill in defaults.
    """
    page = _root_page()
    await db.put_page(page)
    fetched = await db.get_page("p1", 0)
    assert fetched is not None
    assert fetched.parent_page_id is None
    assert fetched.reading_order == 0


# ─── Split-child happy path ──────────────────────────────────────────────────


def test_split_child_with_all_fields_validates() -> None:
    """A page with `parent_page_id` plus the four other split fields validates."""
    page = PageRecord(**_split_child_kwargs())
    assert page.parent_page_id == "0000"
    assert page.source_crop_bbox == (10, 20, 300, 400)
    assert page.split_index == 1
    assert page.split_at_stage == "auto_detect_attrs"
    assert page.split_suffix == "a"
    assert page.reading_order == 1


@pytest.mark.asyncio
async def test_split_child_round_trips_through_db(db: SqliteDatabase) -> None:
    """A split-child PageRecord persists and rehydrates with split fields intact."""
    page = PageRecord(**_split_child_kwargs())
    await db.put_page(page)
    fetched = await db.get_page("p1", 1)
    assert fetched is not None
    assert fetched.parent_page_id == "0000"
    assert fetched.source_crop_bbox == (10, 20, 300, 400)
    assert fetched.split_index == 1
    assert fetched.split_at_stage == "auto_detect_attrs"
    assert fetched.split_suffix == "a"
    assert fetched.reading_order == 1


# ─── Validator: partial split fields rejected ────────────────────────────────


@pytest.mark.parametrize(
    "missing_field",
    ["source_crop_bbox", "split_index", "split_at_stage", "split_suffix"],
)
def test_split_child_missing_required_field_raises(missing_field: str) -> None:
    """If `parent_page_id` is set but any of the four required peers is None,
    validation fails."""
    kwargs = _split_child_kwargs()
    kwargs[missing_field] = None
    with pytest.raises(ValidationError) as exc_info:
        PageRecord(**kwargs)
    assert missing_field in str(exc_info.value)


def test_root_page_with_partial_split_fields_raises() -> None:
    """Setting any split field on a root (parent_page_id=None) page is also an error.

    The semantic is: split fields are ALL-or-NONE keyed off `parent_page_id`.
    A root page must keep `parent_page_id`, `source_crop_bbox`, `split_index`,
    `split_at_stage`, `split_suffix` all None.
    """
    with pytest.raises(ValidationError):
        PageRecord(
            project_id="p1",
            idx0=0,
            prefix="f001",
            source_stem="img_0001",
            split_index=1,  # partial — no parent_page_id
        )


# ─── Recursive splits: child of a child ─────────────────────────────────────


def test_grandchild_split_validates() -> None:
    """A page can be a split-child of another split-child (recursive splits).

    Spec §"Splits as sibling pages": "Splits are recursive: a child page may
    itself be split, producing grandchildren."
    """
    grandchild = PageRecord(
        project_id="p1",
        idx0=2,
        prefix="f001ab",
        source_stem="img_0001",
        parent_page_id="0001",  # itself a split-child
        source_crop_bbox=(0, 0, 150, 200),
        split_index=2,
        split_at_stage="auto_deskew",
        split_suffix="b",
        reading_order=2,
    )
    assert grandchild.parent_page_id == "0001"
    assert grandchild.split_suffix == "b"
