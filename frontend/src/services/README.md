# services/ — Real API service implementations

This directory contains the real service layer that replaces the mock server at
I1 integration. Every machine's `*Services` interface has a matching
implementation here, backed by the OpenAPI client (`api/client.ts`).

## Structure

- `pipeline.ts` — `PipelineShellServices`, `StageRunnerServices`, `RunAllStaleServices`
- `projects.ts` — `ProjectDetailServices`, `RailListServices`, attribute/activity adapters
- `settings.ts` — `ProjectSettingsServices`, `StageSettingsServices`
- `sse.ts` — Real `EventSource` adapter satisfying `sseActor`'s subscription signature
- `tools/` — Per-tool service implementations for F5 tools

## Injection pattern

Every surface component (PipelinePage, ProjectsPage) accepts an optional
`services` prop for test injection. When not injected, the component builds
real services using the API client and QueryClient. Tests inject mock services.

The mock server (mocks/server.ts) remains untouched — tests continue to use it.
