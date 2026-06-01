from pathlib import Path
from unittest.mock import MagicMock

from pdomain_prep_for_pgdp.core.page_store_factory import PageService


def test_page_service_dep_resolves(tmp_path: Path) -> None:
    """get_page_service_for_project must return a PageService without error."""
    from pdomain_prep_for_pgdp.api.dependencies import get_page_service_for_project

    request = MagicMock()
    request.app.state.settings.data_root = tmp_path
    service = get_page_service_for_project(project_id="test-proj-dep", request=request)
    assert isinstance(service, PageService)
    assert service.store is not None
    assert service.blobs is not None
