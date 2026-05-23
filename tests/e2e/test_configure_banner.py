"""E2E: ProjectConfigurePage shows a 'creating thumbnails' banner during ingest.

Strategy: insert a project + a queued (never-running) thumbnails job
directly into the running server's SQLite. Hitting `/projects/<id>` should
hide the page grid and show the banner with a link to the JobsPage.

We don't run the job — the banner is driven by the project's recent-jobs
query observing live status `queued`, so the queued row is enough to assert
the UI behaviour.
"""

from __future__ import annotations

import asyncio
import threading
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, cast

import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.core.models import (
    Job,
    JobProgress,
    JobStatus,
    JobType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)

if TYPE_CHECKING:
    from .conftest import LiveServer


class _Locator(Protocol):
    def to_be_visible(self, timeout: int | None = None) -> None: ...


class _LocatorLike(Protocol):
    @property
    def first(self) -> _Locator: ...

    def to_be_visible(self, timeout: int | None = None) -> None: ...


class _Page(Protocol):
    def goto(self, url: str) -> None: ...

    def get_by_text(self, text: str, /, exact: bool = False) -> _LocatorLike: ...

    def get_by_role(self, role: str, /, name: str | None = None) -> _LocatorLike: ...


class _ExpectResult(Protocol):
    def to_be_visible(self, timeout: int | None = None) -> None: ...


class _Expect(Protocol):
    def __call__(self, locator: _Locator | _LocatorLike) -> _ExpectResult: ...


class _PlaywrightSyncModule(Protocol):
    expect: _Expect


try:
    raw_playwright = cast("object", pytest.importorskip("playwright.sync_api"))
except ModuleNotFoundError as exc:
    raise RuntimeError("playwright is required for e2e tests") from exc

playwright_module = cast("_PlaywrightSyncModule", raw_playwright)
expect = playwright_module.expect


def _seed(db_url: str, project_id: str, job_type: JobType) -> None:
    """Seed via a fresh thread.

    Playwright's sync API leaves an asyncio loop attached to the test
    thread, so `asyncio.run` from the test body raises. Running the
    coroutine in a clean thread sidesteps that.
    """

    async def go() -> None:
        db = SqliteDatabase(db_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id="default",
                name="Banner E2E",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.ingesting,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name=project_id, source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{project_id}/",
            )
        )
        await db.put_job(
            Job(
                id=f"{project_id}-job",
                project_id=project_id,
                owner_id="default",
                type=job_type,
                # `scheduled` so the in-process job runner doesn't pick it up
                # mid-test and flip it to running/complete before the page
                # has a chance to observe it.
                status=JobStatus.scheduled,
                progress=JobProgress(message=""),
            )
        )
        await db.close()

    error: list[BaseException] = []

    def runner() -> None:
        try:
            asyncio.run(go())
        except BaseException as e:
            error.append(e)

    t = threading.Thread(target=runner)
    t.start()
    t.join(timeout=10)
    if error:
        raise error[0]


def test_configure_page_shows_thumbnails_banner_during_ingest(live_server: LiveServer, page: _Page) -> None:
    project_id = "banner-thumbs"
    _seed(live_server.settings.derived_database_url, project_id, JobType.thumbnails)

    page.goto(f"{live_server.base_url}/projects/{project_id}")

    expect(page.get_by_text("Creating thumbnails…")).to_be_visible(timeout=10_000)
    expect(page.get_by_role("link", name="Open jobs page →")).to_be_visible()


def test_configure_page_shows_unzip_banner_during_ingest(live_server: LiveServer, page: _Page) -> None:
    project_id = "banner-unzip"
    _seed(live_server.settings.derived_database_url, project_id, JobType.unzip)

    page.goto(f"{live_server.base_url}/projects/{project_id}")

    expect(page.get_by_text("Unzipping source archive…")).to_be_visible(timeout=10_000)
    expect(page.get_by_role("link", name="Open jobs page →")).to_be_visible()
