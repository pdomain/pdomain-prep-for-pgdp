---
status: backlog
priority: later
repo: pdomain/pdomain-prep-for-pgdp
---

# Compute Settings Panel Backlog

`pdomain-prep-for-pgdp` mounts pdomain-ops suite routes and has GPU backend
plumbing, but the frontend currently uses an app-local Settings page rather than
the shared pdomain ops Compute settings panel. Do not add the startup warmup
alone; add it only with the visible Compute panel.

## Scope When Revived

- Decide whether Compute belongs in the existing app-local Settings page or in a
  shared pdomain-ui settings panel.
- Expose compute-device state through `createApiDeviceConfig()` and
  `useDeviceInfo()`.
- Start a background `GET /api/suite/device` warmup task at SPA startup when the
  Compute panel is exposed.
- Include in-app CUDA setup guidance only if CUDA-backed stage implementations
  become user-selectable.

## Acceptance

- Users can inspect CPU/CUDA/NVIDIA-unusable state from settings before running
  GPU-capable pipeline stages.
- The app does not perform compute warmup unless there is a visible Compute
  settings panel consuming the result.
- Focused frontend tests cover panel registration and startup warmup.


## Goal

Preserve the remaining compute-settings panel work described above as an active backlog.

## Architecture

The work extends the existing React settings surfaces and current backend settings contract; it does not introduce a second configuration path.

## Tech Stack

React 19, TypeScript, TanStack Query, FastAPI, and the generated OpenAPI client remain the implementation stack.

## Global Constraints

Keep settings compatible with the three-tier resolver, generated API types, and existing persistence behavior.
