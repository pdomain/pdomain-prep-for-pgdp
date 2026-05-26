"""Tests for GET /api/data/projects/{project_id}/search.

Acceptance (from issue #75):
- Returns matches with snippet + page_id + idx0 + score.
- Pagination: limit + offset work; total_count is accurate.
- Empty q returns 400.
- Cross-user isolation: another user's request gets 404.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase


def _create_project(client: TestClient) -> str:
    resp = client.post(
        "/api/data/projects",
        json={"name": "test book", "source_type": "local_folder"},
    )
    assert resp.status_code == 200
    return resp.json()["project"]["id"]


def test_search_empty_query_returns_400(client: TestClient) -> None:
    project_id = _create_project(client)
    resp = client.get(f"/api/data/projects/{project_id}/search?q=")
    assert resp.status_code == 400


def test_search_missing_q_returns_400(client: TestClient) -> None:
    project_id = _create_project(client)
    resp = client.get(f"/api/data/projects/{project_id}/search")
    assert resp.status_code == 400


def test_search_unknown_project_returns_404(client: TestClient) -> None:
    resp = client.get("/api/data/projects/nonexistent/search?q=foo")
    assert resp.status_code == 404


def test_search_returns_result_shape(client: TestClient, tmp_path) -> None:
    """Index a page via search_index_page, then search for it."""
    import asyncio

    from pdomain_prep_for_pgdp.bootstrap import build_app
    from pdomain_prep_for_pgdp.settings import Settings

    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )
    app = build_app(settings)

    with TestClient(app) as c:
        project_id = _create_project(c)

        # Seed FTS index directly via db adapter
        db = SqliteDatabase(settings.database_url)

        async def seed() -> None:
            await db.initialize()
            await db.search_index_page(
                project_id=project_id,
                page_id="page-abc",
                idx0=0,
                ocr_text="the quick brown fox jumps",
            )
            await db.close()

        asyncio.run(seed())

        resp = c.get(f"/api/data/projects/{project_id}/search?q=quick")
        assert resp.status_code == 200
        body = resp.json()
        assert "results" in body
        assert "total_count" in body
        assert body["total_count"] >= 1
        hit = body["results"][0]
        assert hit["page_id"] == "page-abc"
        assert hit["idx0"] == 0
        assert "snippet" in hit
        assert "score" in hit


def test_search_pagination(client: TestClient, tmp_path) -> None:
    import asyncio

    from pdomain_prep_for_pgdp.bootstrap import build_app
    from pdomain_prep_for_pgdp.settings import Settings

    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )
    app = build_app(settings)

    with TestClient(app) as c:
        project_id = _create_project(c)

        db = SqliteDatabase(settings.database_url)

        async def seed() -> None:
            await db.initialize()
            for i in range(5):
                await db.search_index_page(
                    project_id=project_id,
                    page_id=f"page-{i}",
                    idx0=i,
                    ocr_text=f"chapter heading number {i} continues here",
                )
            await db.close()

        asyncio.run(seed())

        resp_all = c.get(f"/api/data/projects/{project_id}/search?q=chapter")
        assert resp_all.status_code == 200
        total = resp_all.json()["total_count"]
        assert total == 5

        resp_p1 = c.get(f"/api/data/projects/{project_id}/search?q=chapter&limit=2&offset=0")
        assert len(resp_p1.json()["results"]) == 2
        assert resp_p1.json()["total_count"] == 5

        resp_p2 = c.get(f"/api/data/projects/{project_id}/search?q=chapter&limit=2&offset=2")
        assert len(resp_p2.json()["results"]) == 2

        resp_last = c.get(f"/api/data/projects/{project_id}/search?q=chapter&limit=2&offset=4")
        assert len(resp_last.json()["results"]) == 1


def test_search_cross_user_isolation(tmp_path) -> None:
    """Requesting user cannot search another owner's project — returns 404."""
    import asyncio
    from datetime import UTC, datetime

    from pdomain_prep_for_pgdp.bootstrap import build_app
    from pdomain_prep_for_pgdp.core.models import PipelineState, Project, ProjectConfig, ProjectStatus
    from pdomain_prep_for_pgdp.settings import Settings

    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )

    # Seed a project owned by "someone-else" directly into the DB
    db = SqliteDatabase(settings.database_url)

    async def seed() -> None:
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="proj-other",
                owner_id="someone-else",
                name="other book",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="other book", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/proj-other/",
            )
        )
        await db.search_index_page(
            project_id="proj-other",
            page_id="page-x",
            idx0=0,
            ocr_text="secret text",
        )
        await db.close()

    asyncio.run(seed())

    app = build_app(settings)
    with TestClient(app) as c:
        # auth_mode=none → user_id="default", not "someone-else"
        resp = c.get("/api/data/projects/proj-other/search?q=secret")
        assert resp.status_code == 404
