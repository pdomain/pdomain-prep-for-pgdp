"""Guard: every FastAPI route must declare an explicit ``operation_id``.

Why: ``openapi-typescript`` (and similar codegen) names generated TS
functions/types after each operation's ``operationId``. When FastAPI
auto-derives the id, it appends the HTTP method and uses the route
function's Python name verbatim, producing ugly TS identifiers like
``list_projects_get`` and request-body schemas named after the function.
Forcing an explicit, kebab/snake-case ``operation_id`` keeps the
generated client stable across renames of the underlying handler and
keeps codegen output readable.

Drift fix-it: add ``operation_id="..."`` to the offending route
decorator (snake_case slug, unique across the whole app), then re-run
``make openapi-export``.
"""

from __future__ import annotations

from collections import Counter

from fastapi.routing import APIRoute

from pd_prep_for_pgdp.bootstrap import build_app

# FastAPI's auto-derived operation_id pattern is "<func_name>_<path>_<method>",
# but the simplest reliable signal is the trailing "_<lowercase-method>".
_AUTO_SUFFIXES = ("_get", "_post", "_put", "_delete", "_patch", "_head", "_options")


def _api_routes() -> list[APIRoute]:
    # Routes with include_in_schema=False (healthz, env.js, SPA fallback) are
    # invisible to openapi-typescript codegen, so an explicit operation_id
    # would be unused noise. Audit only the schema-visible surface.
    return [r for r in build_app().routes if isinstance(r, APIRoute) and r.include_in_schema]


def test_every_route_has_explicit_operation_id() -> None:
    offenders: list[str] = []
    for route in _api_routes():
        op_id = route.operation_id
        if op_id is None:
            offenders.append(f"{sorted(route.methods)} {route.path} -> operation_id=None")
            continue
        if op_id.endswith(_AUTO_SUFFIXES):
            # Heuristic: an explicit id may legitimately end in _get etc., but
            # in this codebase that overlap means it was almost certainly auto.
            # If a future route legitimately needs that suffix, allow-list here.
            offenders.append(
                f"{sorted(route.methods)} {route.path} -> operation_id={op_id!r} "
                f"looks auto-generated (ends in {_AUTO_SUFFIXES})"
            )
    assert not offenders, "Routes missing explicit operation_id:\n  " + "\n  ".join(offenders)


def test_operation_ids_are_unique() -> None:
    ids = [r.operation_id for r in _api_routes() if r.operation_id is not None]
    duplicates = [op for op, count in Counter(ids).items() if count > 1]
    assert not duplicates, f"Duplicate operation_ids: {duplicates}"
