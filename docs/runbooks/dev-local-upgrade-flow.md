---
Kind: runbook
Status: active
Owner: CT
Created: 2026-05-19
Last verified: 2026-11-07
---

# Upgrade dependencies while preserving local siblings

## Agent Index

- **Kind:** runbook
- **Status:** active
- **Last verified:** 2026-11-07
- **Read when:** upgrading dependencies in local-dev mode.
- **Search terms:** local-upgrade-deps, local-dev, editable siblings, local marker.

## Trigger

Use this flow after activating local mode with `make local-dev`.
Normal dependencies come from the registry. Local mode overlays editable pdomain-book-tools and pdomain-ops,
plus the linked `@pdomain/pdomain-ui` frontend package.

## Preconditions

Run `make setup` first and ensure the sibling checkouts exist.
`make local-setup` clones missing siblings; it does not activate local mode.
The canonical checkout's active environment must contain `.pdomain-local-mode` for `local-upgrade-deps`.

The generic upgrade guard checks editability before synchronization. It recognizes editable book-tools,
a `.dev-local` or `.pdomain-local-mode` marker, or a true `PDOMAIN_DEV_LOCAL` value.
A false environment value does not override editable or marker detection.
That fallback detection does not replace the canonical marker requirement of the local-upgrade target.

## Steps

1. Run `make local-check` and inspect the current mode and sibling resolution.
2. Run `make local-upgrade-deps`.
3. Run `make local-check` again and confirm both Python siblings and the UI link.
4. Inspect dependency/lockfile changes, then use `make local-run`.

The upgrade target runs `uv lock --upgrade` and `uv sync` at the canonical root, then `local-dev` restores
editable Python siblings and frontend links. Legacy `upgrade-deps-local` and `dev-local` are aliases.

## Verification

Confirm local-check resolves the intended siblings. Run the repository CI gate before committing.
The source behavior is covered by `tests/test_detect_dev_local.py` and the local-mode scripts.
This source audit did not perform an upgrade or change installed dependencies.

## Rollback

Restore only dependency changes introduced by this upgrade, preserving pre-existing user edits.
Re-synchronize and deliberately reapply `make local-dev` when retaining local mode.

`make clean` removes build/cache artifacts; it does not clear local mode.
`make reset` removes the active environment and runs setup. To return to registry mode deliberately, remove
its `.pdomain-local-mode` marker first. `local-uninstall` removes a separately installed uv tool only.

## Evidence

Verified 2026-11-07 against `scripts/detect_dev_local.py`, the `scripts/local-*.sh` scripts,
and Makefile upgrade/reset/clean targets. Environment selection uses `UV_PROJECT_ENVIRONMENT`, default `.venv`.
