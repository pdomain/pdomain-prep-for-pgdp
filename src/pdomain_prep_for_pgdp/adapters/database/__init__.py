"""Database adapter: SQLite or Postgres."""

from .base import IDatabase, SearchResult, SearchResultList

__all__ = ["IDatabase", "SearchResult", "SearchResultList"]
