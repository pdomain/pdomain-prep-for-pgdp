"""Tests for the hi-fi Source/Files backend routes.

Covers the four deliverables shipped in feat/hifi-backend-data:

1. GET /api/data/projects/{id}/pages/{idx0}/thumbnail
   — serves the ingest-time JPEG thumbnail from the BlobStore.

2. PATCH /api/data/projects/{id}/pages/{idx0}
   — accepts PageType values + appends PageTypeChanged event;
   — accepts ignore bool + appends PageIgnoreSet event.

3. Ignore / un-ignore via PATCH {idx0} with {"ignore": true/false}
   — persists to event store and round-trips via GET {idx0}.

4. POST /api/data/projects/{id}/pages/insert
   — inserts a blank page, shifts existing pages, appends PageInserted event.

Each route test asserts:
  (a) The state change persists and round-trips via GET.
  (b) Appropriate events are appended to PrepProjectAggregate.

Event assertions use PrepApplication.repository.get() to load the aggregate
and verify the correct event types are present.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )


def _make_project(project_id: str, page_count: int = 2, owner_id: str = "default") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id=owner_id,
        name="Test Book",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.configuring,
        page_count=page_count,
        proof_page_count=page_count,
        config=ProjectConfig(
            book_name="Test Book",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=page_count - 1,
            frontmatter_start_idx0=0,
            frontmatter_end_idx0=-1,
            bodymatter_start_idx0=0,
            bodymatter_end_idx0=page_count - 1,
        ),
        storage_prefix=f"projects/{project_id}/",
    )


def _seed_project(
    settings: Settings, project_id: str, pages: list[PageRecord], owner_id: str = "default"
) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        await db.put_project(_make_project(project_id, page_count=len(pages), owner_id=owner_id))
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(settings, project_id, pages)


def _two_pages(project_id: str) -> list[PageRecord]:
    return [
        PageRecord(
            project_id=project_id, idx0=0, prefix="p001", source_stem="img0001", page_type=PageType.normal
        ),
        PageRecord(
            project_id=project_id, idx0=1, prefix="p002", source_stem="img0002", page_type=PageType.normal
        ),
    ]


def _load_prep_agg_events(settings: Settings, project_id: str) -> list[str]:
    """Return the list of event class names recorded in the PrepProjectAggregate."""
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepApplication, PrepProjectAggregate

    events_db = settings.data_root / "projects" / project_id / "events.db"
    if not events_db.exists():
        return []
    app = PrepApplication(
        env={
            "PERSISTENCE_MODULE": "eventsourcing.sqlite",
            "SQLITE_DBNAME": str(events_db),
        }
    )
    try:
        proj_uuid_str = project_id
        try:
            proj_uuid = uuid.UUID(proj_uuid_str)
        except ValueError:
            proj_uuid = uuid.uuid5(uuid.NAMESPACE_OID, proj_uuid_str)
        agg_id = PrepProjectAggregate.create_id(proj_uuid)
        agg = app.repository.get(agg_id)
        # Extract event type names from the aggregate's history
        event_names: list[str] = []
        for stored_event in agg._events:  # type: ignore[attr-defined]
            event_names.append(type(stored_event).__name__)
        return event_names
    except Exception:
        return []


def _get_prep_agg_events_from_db(settings: Settings, project_id: str) -> list[dict]:
    """Return raw event records from the PrepProjectAggregate's SQLite DB."""
    import contextlib
    import json
    import sqlite3

    events_db = settings.data_root / "projects" / project_id / "events.db"
    if not events_db.exists():
        return []
    try:
        conn = sqlite3.connect(str(events_db))
        cur = conn.execute("SELECT * FROM stored_events ORDER BY originator_version")
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        conn.close()
        result = []
        for row in rows:
            row_dict = dict(zip(cols, row, strict=True))
            if "state" in row_dict and isinstance(row_dict["state"], (str, bytes)):
                with contextlib.suppress(Exception):
                    row_dict["state"] = json.loads(row_dict["state"])
            result.append(row_dict)
        return result
    except Exception:
        return []


# ─── 1. Ingest thumbnail route ─────────────────────────────────────────────────


def test_thumbnail_serves_blob(tmp_path: Path) -> None:
    """GET /thumbnail returns 200 + JPEG bytes when thumbnail_blob_hash is set."""
    from pdomain_ops.pages import get_extension as _ops_get_ext

    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

    settings = _settings(tmp_path)
    project_id = "thumb1"
    _seed_project(settings, project_id, _two_pages(project_id))

    # Inject a fake JPEG thumbnail into the BlobStore for page 0.
    fake_jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 100  # minimal JPEG-like header
    svc = build_page_service(settings.data_root, project_id)
    thumb_hash = svc.blobs.write(fake_jpeg)

    # Update page 0's PrepPageExtension with the thumbnail_blob_hash.
    from pdomain_prep_for_pgdp.core.page_service_helpers import _to_uuid as _pid_to_uuid

    proj_uuid = _pid_to_uuid(project_id)
    proj_agg = svc.store.get_project(proj_uuid)
    for pid in proj_agg.record.page_ids:
        page_agg = svc.store.get_page(pid)
        ext = _ops_get_ext(page_agg.record, "prep", PrepPageExtension)
        if ext is not None and ext.idx0 == 0:
            updated_ext = ext.model_copy(update={"thumbnail_blob_hash": thumb_hash})
            page_agg.set_extension("prep", updated_ext)
            svc.store.save_page(page_agg)
            break

    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/{project_id}/pages/0/thumbnail")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/jpeg"
    assert r.content == fake_jpeg


def test_thumbnail_404_when_no_hash(tmp_path: Path) -> None:
    """GET /thumbnail returns 404 when thumbnail_blob_hash is not yet set."""
    settings = _settings(tmp_path)
    project_id = "thumb2"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/{project_id}/pages/0/thumbnail")
    assert r.status_code == 404, r.text


def test_thumbnail_404_unknown_project(tmp_path: Path) -> None:
    """GET /thumbnail returns 404 for unknown project."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/no-such/pages/0/thumbnail")
    assert r.status_code == 404


def test_thumbnail_404_unknown_page(tmp_path: Path) -> None:
    """GET /thumbnail returns 404 for unknown idx0."""
    settings = _settings(tmp_path)
    project_id = "thumb3"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/{project_id}/pages/99/thumbnail")
    assert r.status_code == 404


def test_thumbnail_404_cross_user(tmp_path: Path) -> None:
    """GET /thumbnail returns 404 when project belongs to another user."""
    settings = _settings(tmp_path)
    project_id = "thumb4"
    _seed_project(settings, project_id, _two_pages(project_id), owner_id="other-user")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/{project_id}/pages/0/thumbnail")
    assert r.status_code == 404


# ─── 2. Mark-as-page (set page_type) — PATCH ──────────────────────────────────


def test_patch_page_type_persists(tmp_path: Path) -> None:
    """PATCH page_type=blank persists and round-trips via GET."""
    settings = _settings(tmp_path)
    project_id = "pt1"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"page_type": "blank"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["page_type"] == "blank"

        # Round-trip: GET must reflect the new page_type.
        r2 = client.get(f"/api/data/projects/{project_id}/pages/0")
        assert r2.status_code == 200
        assert r2.json()["page_type"] == "blank"


def test_patch_page_type_appends_event(tmp_path: Path) -> None:
    """PATCH page_type appends a PageTypeChanged event to PrepProjectAggregate."""
    settings = _settings(tmp_path)
    project_id = "pt2"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"page_type": "skip"},
        )
        assert r.status_code == 200, r.text

    events = _get_prep_agg_events_from_db(settings, project_id)
    topic_values = [e.get("topic", "") for e in events]
    assert any("PageTypeChanged" in t for t in topic_values), (
        f"Expected PageTypeChanged event; got topics: {topic_values}"
    )


def test_patch_page_type_all_valid_values(tmp_path: Path) -> None:
    """PATCH accepts all valid PageType enum values without 422."""
    settings = _settings(tmp_path)
    project_id = "pt3"
    pages = [PageRecord(project_id=project_id, idx0=i, prefix="", source_stem=f"img{i}") for i in range(7)]
    asyncio.run(_async_seed_project(settings, project_id, pages))
    seed_pages_in_store(settings, project_id, pages)
    app = build_app(settings)
    valid_types = ["normal", "blank", "plate_b", "plate_p", "plate_r", "skip", "cover"]
    with TestClient(app) as client:
        for i, pt in enumerate(valid_types):
            r = client.patch(f"/api/data/projects/{project_id}/pages/{i}", json={"page_type": pt})
            assert r.status_code == 200, f"Failed for page_type={pt!r}: {r.text}"
            assert r.json()["page_type"] == pt


async def _async_seed_project(settings: Settings, project_id: str, pages: list[PageRecord]) -> None:
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    await db.put_project(_make_project(project_id, page_count=len(pages)))
    await db.close()


def test_patch_page_type_invalid_value_error(tmp_path: Path) -> None:
    """PATCH with invalid page_type string returns a 4xx validation error."""
    settings = _settings(tmp_path)
    project_id = "pt4"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"page_type": "not_a_valid_type"},
        )
    assert r.status_code in (400, 422), r.text


# ─── 3. Ignore / un-ignore (soft, tracked in history) ─────────────────────────


def test_patch_ignore_sets_flag(tmp_path: Path) -> None:
    """PATCH ignore=true persists ignore=True and round-trips via GET."""
    settings = _settings(tmp_path)
    project_id = "ig1"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"ignore": True},
        )
        assert r.status_code == 200, r.text
        assert r.json()["ignore"] is True

        # Round-trip: GET must reflect ignore=True.
        r2 = client.get(f"/api/data/projects/{project_id}/pages/0")
        assert r2.status_code == 200
        assert r2.json()["ignore"] is True


def test_patch_ignore_clears_flag(tmp_path: Path) -> None:
    """PATCH ignore=false can clear a previously-set ignore flag."""
    settings = _settings(tmp_path)
    project_id = "ig2"
    # Start with ignore=True.
    pages = [
        PageRecord(project_id=project_id, idx0=0, prefix="", source_stem="img0", ignore=True),
        PageRecord(project_id=project_id, idx0=1, prefix="", source_stem="img1"),
    ]
    _seed_project(settings, project_id, pages)
    app = build_app(settings)
    with TestClient(app) as client:
        # Verify it's ignored first.
        r0 = client.get(f"/api/data/projects/{project_id}/pages/0")
        assert r0.json()["ignore"] is True

        # Clear the flag.
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"ignore": False},
        )
        assert r.status_code == 200, r.text
        assert r.json()["ignore"] is False

        # Round-trip.
        r2 = client.get(f"/api/data/projects/{project_id}/pages/0")
        assert r2.json()["ignore"] is False


def test_patch_ignore_appends_event(tmp_path: Path) -> None:
    """PATCH ignore=true appends a PageIgnoreSet event to PrepProjectAggregate."""
    settings = _settings(tmp_path)
    project_id = "ig3"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"ignore": True},
        )
        assert r.status_code == 200, r.text

    events = _get_prep_agg_events_from_db(settings, project_id)
    topic_values = [e.get("topic", "") for e in events]
    assert any("PageIgnoreSet" in t for t in topic_values), (
        f"Expected PageIgnoreSet event; got topics: {topic_values}"
    )


def test_patch_ignore_independent_of_page_type(tmp_path: Path) -> None:
    """Patching ignore does not change page_type, and vice versa."""
    settings = _settings(tmp_path)
    project_id = "ig4"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        # Set page_type=blank.
        r = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"page_type": "blank"},
        )
        assert r.status_code == 200

        # Set ignore=True independently.
        r2 = client.patch(
            f"/api/data/projects/{project_id}/pages/0",
            json={"ignore": True},
        )
        assert r2.status_code == 200

        # Both fields must be preserved.
        r3 = client.get(f"/api/data/projects/{project_id}/pages/0")
        body = r3.json()
        assert body["page_type"] == "blank"
        assert body["ignore"] is True


# ─── 4. Insert page ───────────────────────────────────────────────────────────


def test_insert_page_after_idx0(tmp_path: Path) -> None:
    """POST insert with after_idx0=0 creates a page at idx0=1, shifting page 1 → 2."""
    settings = _settings(tmp_path)
    project_id = "ins1"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"after_idx0": 0},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        inserted = body["inserted_page"]
        assert inserted["idx0"] == 1
        assert inserted["page_type"] == "normal"
        assert inserted["ignore"] is False

        # All pages must have contiguous idx0 values [0, 1, 2].
        all_pages = sorted(body["pages"], key=lambda p: p["idx0"])
        assert [p["idx0"] for p in all_pages] == [0, 1, 2]

        # Existing page (was idx0=1, source_stem="img0002") must now be at idx0=2.
        assert all_pages[2]["source_stem"] == "img0002"


def test_insert_page_at_idx0_zero(tmp_path: Path) -> None:
    """POST insert with at_idx0=0 prepends a page, shifting all existing pages."""
    settings = _settings(tmp_path)
    project_id = "ins2"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 0},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        inserted = body["inserted_page"]
        assert inserted["idx0"] == 0

        all_pages = sorted(body["pages"], key=lambda p: p["idx0"])
        assert [p["idx0"] for p in all_pages] == [0, 1, 2]

        # Original page 0 ("img0001") must now be at idx0=1.
        assert all_pages[1]["source_stem"] == "img0001"


def test_insert_page_at_end(tmp_path: Path) -> None:
    """POST insert with after_idx0=last-page appends a page at the end."""
    settings = _settings(tmp_path)
    project_id = "ins3"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"after_idx0": 1},  # after last page (idx0=1)
        )
        assert r.status_code == 200, r.text
        body = r.json()
        inserted = body["inserted_page"]
        assert inserted["idx0"] == 2

        all_pages = sorted(body["pages"], key=lambda p: p["idx0"])
        assert [p["idx0"] for p in all_pages] == [0, 1, 2]


def test_insert_page_round_trips_via_get(tmp_path: Path) -> None:
    """Inserted page is retrievable via GET /pages/{idx0} after insert."""
    settings = _settings(tmp_path)
    project_id = "ins4"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 1},
        )
        assert r.status_code == 200, r.text

        # Retrieve the newly inserted page via GET.
        r2 = client.get(f"/api/data/projects/{project_id}/pages/1")
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["idx0"] == 1
        assert body["page_type"] == "normal"
        assert body["source_stem"] == "inserted"

        # The shifted page (was idx0=1, now idx0=2) is also retrievable.
        r3 = client.get(f"/api/data/projects/{project_id}/pages/2")
        assert r3.status_code == 200
        assert r3.json()["source_stem"] == "img0002"


def test_insert_page_appends_event(tmp_path: Path) -> None:
    """POST insert appends a PageInserted event to PrepProjectAggregate."""
    settings = _settings(tmp_path)
    project_id = "ins5"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 0},
        )
        assert r.status_code == 200, r.text

    events = _get_prep_agg_events_from_db(settings, project_id)
    topic_values = [e.get("topic", "") for e in events]
    assert any("PageInserted" in t for t in topic_values), (
        f"Expected PageInserted event; got topics: {topic_values}"
    )


def test_insert_page_updates_project_page_count(tmp_path: Path) -> None:
    """After insert, GET /projects/{id} reflects the incremented page_count."""
    settings = _settings(tmp_path)
    project_id = "ins6"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        # Confirm initial page count.
        r0 = client.get(f"/api/data/projects/{project_id}")
        assert r0.json()["page_count"] == 2

        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 1},
        )
        assert r.status_code == 200, r.text

        # Project page_count must be 3.
        r2 = client.get(f"/api/data/projects/{project_id}")
        assert r2.json()["page_count"] == 3


def test_insert_page_neither_param_422(tmp_path: Path) -> None:
    """POST insert with neither after_idx0 nor at_idx0 returns 422."""
    settings = _settings(tmp_path)
    project_id = "ins7"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={},
        )
    assert r.status_code == 422, r.text


def test_insert_page_both_params_422(tmp_path: Path) -> None:
    """POST insert with both after_idx0 and at_idx0 returns 422."""
    settings = _settings(tmp_path)
    project_id = "ins8"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"after_idx0": 0, "at_idx0": 1},
        )
    assert r.status_code == 422, r.text


def test_insert_page_out_of_range_422(tmp_path: Path) -> None:
    """POST insert with at_idx0 > page_count returns 422."""
    settings = _settings(tmp_path)
    project_id = "ins9"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 99},
        )
    assert r.status_code == 422, r.text


def test_insert_page_404_unknown_project(tmp_path: Path) -> None:
    """POST insert for unknown project returns 404."""
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/no-such/pages/insert",
            json={"at_idx0": 0},
        )
    assert r.status_code == 404


def test_insert_page_404_cross_user(tmp_path: Path) -> None:
    """POST insert for another user's project returns 404."""
    settings = _settings(tmp_path)
    project_id = "ins10"
    _seed_project(settings, project_id, _two_pages(project_id), owner_id="other-user")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 0},
        )
    assert r.status_code == 404


def test_insert_page_list_shows_all(tmp_path: Path) -> None:
    """After insert, GET /pages returns all pages including the new blank one."""
    settings = _settings(tmp_path)
    project_id = "ins11"
    _seed_project(settings, project_id, _two_pages(project_id))
    app = build_app(settings)
    with TestClient(app) as client:
        client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 1},
        )
        r = client.get(f"/api/data/projects/{project_id}/pages?limit=100")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 3
        idxs = sorted(p["idx0"] for p in body["pages"])
        assert idxs == [0, 1, 2]


def test_insert_page_prefixes_consistent_after_insert(tmp_path: Path) -> None:
    """After insert, GET /pages shows non-empty prefixes on all in-range pages.

    Regression test for: insert_page previously left the new page with prefix=""
    and didn't recompute the shifted tail pages, so they could show stale prefixes.
    """
    settings = _settings(tmp_path)
    project_id = "ins12"

    # Seed two pages with pre-assigned prefixes so assign_prefixes can verify
    # the shifted tail page is still in-range and gets a fresh prefix.
    pages = [
        PageRecord(project_id=project_id, idx0=0, prefix="000f001", source_stem="img0001"),
        PageRecord(project_id=project_id, idx0=1, prefix="001p001", source_stem="img0002"),
    ]
    _seed_project(settings, project_id, pages)
    app = build_app(settings)

    with TestClient(app) as client:
        # Insert at position 1 (shifts existing page 1 → idx0=2).
        r = client.post(
            f"/api/data/projects/{project_id}/pages/insert",
            json={"at_idx0": 1},
        )
        assert r.status_code == 200, r.text

        # Fetch all pages and verify prefix consistency.
        r2 = client.get(f"/api/data/projects/{project_id}/pages?limit=100")
        assert r2.status_code == 200
        body = r2.json()
        assert body["total"] == 3

        by_idx = {p["idx0"]: p for p in body["pages"]}

        # The newly inserted page at idx0=1 should have a non-empty prefix
        # (assign_prefixes recomputes it from the updated config ranges).
        assert by_idx[1]["prefix"] != "", (
            "inserted page prefix must be recomputed after insert, not left empty"
        )

        # The shifted page (was idx0=1, now idx0=2) must also have a valid prefix.
        assert by_idx[2]["prefix"] != "", "shifted tail page prefix must be recomputed after insert"

        # No page should be ignore=True — all three are in-range normal pages.
        for page in body["pages"]:
            assert page["ignore"] is False, f"page idx0={page['idx0']} should not be ignored after insert"
