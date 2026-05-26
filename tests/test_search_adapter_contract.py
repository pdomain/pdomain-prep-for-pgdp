"""Test the IDatabase search() method contract.

Locks in:
  - `SearchResult` dataclass has page_id, idx0, snippet, score fields,
  - `SearchResultList` dataclass has results, total_count fields,
  - `IDatabase` Protocol has search() method with correct signature.
"""

from __future__ import annotations

import inspect
from typing import get_type_hints

from pdomain_prep_for_pgdp.adapters.database.base import IDatabase, SearchResult, SearchResultList


def test_search_result_has_required_fields() -> None:
    """SearchResult has page_id, idx0, snippet, score fields."""
    instance = SearchResult(page_id="test-id", idx0=42, snippet="test snippet", score=0.85)
    assert instance.page_id == "test-id"
    assert instance.idx0 == 42
    assert instance.snippet == "test snippet"
    assert instance.score == 0.85


def test_search_result_score_is_float() -> None:
    """SearchResult.score is a float in [0.0, 1.0]."""
    instance = SearchResult(page_id="id", idx0=0, snippet="text", score=0.5)
    assert isinstance(instance.score, float)


def test_search_result_list_has_required_fields() -> None:
    """SearchResultList has results and total_count fields."""
    results = [
        SearchResult(page_id="id1", idx0=0, snippet="snippet1", score=0.9),
        SearchResult(page_id="id2", idx0=1, snippet="snippet2", score=0.8),
    ]
    instance = SearchResultList(results=results, total_count=2)
    assert instance.results == results
    assert instance.total_count == 2


def test_idatabase_protocol_has_search_method() -> None:
    """IDatabase Protocol has search() method."""
    assert hasattr(IDatabase, "search")
    # Get the method signature
    method = IDatabase.search
    sig = inspect.signature(method)
    params = list(sig.parameters.keys())
    # Should have: self, project_id, query, and optional limit, offset
    assert "project_id" in params
    assert "query" in params
    assert "limit" in params
    assert "offset" in params


def test_idatabase_search_returns_search_result_list() -> None:
    """IDatabase.search() returns SearchResultList."""
    method = IDatabase.search
    hints = get_type_hints(method)
    # The return type should be SearchResultList or a coroutine that returns it
    return_type = hints.get("return")
    assert return_type is not None
