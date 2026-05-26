"""In-process priority + serialisation queue for GPU-bound work.

See spec 07 §"In-process queue (local/self-hosted GPU backend)".
"""

from .single_executor import Priority, SingleExecutor

__all__ = ["Priority", "SingleExecutor"]
