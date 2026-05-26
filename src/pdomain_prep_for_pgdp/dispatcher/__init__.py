"""Dispatcher: immediate (local/self-hosted) or batched (managed-mode 5-min flush)."""

from .base import IDispatcher
from .batched import BatchDispatcher
from .immediate import ImmediateDispatcher

__all__ = ["BatchDispatcher", "IDispatcher", "ImmediateDispatcher"]
