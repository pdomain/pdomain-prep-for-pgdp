"""Resolve the effective compute device for job payloads."""

from __future__ import annotations

_APP_ID = "pdomain-prep-for-pgdp"


def resolve_job_device() -> str:
    """Return the effective compute device for this app instance.

    Wraps ``resolve_effective_device(LocalFilePrefs(), _APP_ID)`` — per-app
    override -> suite default -> ``pick_device()`` auto-detection (already
    handled inside ``resolve_effective_device``; no extra fallback needed
    here). Called once per job enqueue (not cached) so a compute-device
    preference change takes effect on the next run without restarting
    the process.
    """
    from pdomain_ops.suite.device_prefs import resolve_effective_device
    from pdomain_ops.suite.prefs import LocalFilePrefs

    return resolve_effective_device(LocalFilePrefs(), _APP_ID)
