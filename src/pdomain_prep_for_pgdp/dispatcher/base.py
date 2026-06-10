"""IDispatcher Protocol — owns batch scheduling.

Interactive requests bypass the dispatcher and call the GPU backend directly;
the dispatcher exists so batched managed-mode work can amortise Modal cold
starts across many pages.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pdomain_ops.gpu import BatchJobItem, BatchJobResult


class IDispatcher(Protocol):
    async def submit(self, item: BatchJobItem, *, job_id: str = "") -> None: ...

    async def flush(self) -> list[BatchJobResult]: ...

    async def run_forever(self) -> None: ...
