---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# build_package PREFLIGHT not fan-in from validation UI (W1.6)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — Build stays disabled or disconnected from validation
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21 pipeline review)
- **Read when:** wiring pack-chain shell fan-in, validation → build_package gate, or PREFLIGHT_PUSH.
- **Search terms:** PREFLIGHT_PUSH, preflightPassed, BuildPackageTool, validationTool, build gate, W1.6
- **Relates to:** [Pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

`buildPackageToolMachine` requires `PREFLIGHT_PUSH` with `status: "passed"`
before `BUILD` is accepted (`preflightPassed` guard; default `preflight` is
`"unknown"`). `BuildPackageTool` documents that pipelineShell should fan
preflight status but only comments “here we simulate it” — no production
subscription or validation→build event bridge exists. ValidationTool runs its
own machine without sending `PREFLIGHT_PUSH` to the build tool. The pack gate
therefore never reflects a real validation report in the live shell.

## Impact

- Build button remains disabled for real users (`preflight !== "passed"`).
- Or tests/manual sends fake PREFLIGHT_PUSH, decoupling UI from actual
  validation blockers (unattested text_review, etc.).
- Pack chain UX cannot complete honestly after validation.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
frontend:
  pages/pipeline/tools/BuildPackageTool.tsx
  pages/pipeline/tools/ValidationTool.tsx
  machines/tools/buildPackageTool.ts
  machines/tools/packTools.test.ts (PREFLIGHT_PUSH unit behaviour)
parent: docs/plans/2026-07-21-pipeline-completion-review.md §W1.6
```

## Evidence

### 1. Machine expects PREFLIGHT_PUSH; BUILD gated

```84:124:frontend/src/machines/tools/buildPackageTool.ts
  preflight: PreflightStatus;
...
  | { type: "PREFLIGHT_PUSH"; status: PreflightStatus };
...
    preflightPassed: ({ context }: { context: BuildPackageToolContext }) =>
      context.preflight === "passed",
```

Initial context sets `preflight: "unknown"`. BUILD transition uses
`guard: "preflightPassed"`.

### 2. BuildPackageTool does not fan-in production preflight

```113:114:frontend/src/pages/pipeline/tools/BuildPackageTool.tsx
  // In a real app, pipelineShell fans PREFLIGHT_PUSH; here we simulate it.
  // The Build button will be disabled when preflight is not 'passed'.
```

No `useEffect` / SSE / shell actor subscription follows that comment.
UI disables build when `ctx.preflight !== "passed"` (button disabled binding).

### 3. Tests document the gate

`BuildPackageTool.test.tsx`: “build-btn remains disabled without
PREFLIGHT_PUSH”. `packTools.test.ts`: BUILD ignored when unknown/blocked;
proceeds only after `PREFLIGHT_PUSH` status `"passed"`.

### 4. ValidationTool has no PREFLIGHT emit

`ValidationTool.tsx` drives `validationToolMachine` (RERUN_CHECKS, WAIVE,
CONFIRM_WAIVE, etc.) with no send of `PREFLIGHT_PUSH` to a sibling build
machine or shell bus.

## Root-cause hypotheses

1. **(Most likely) Shell fan-in never implemented** — design (DIVERGENCES /
   F5.6-9) specified external PREFLIGHT_PUSH; only unit tests inject the event.
2. **Tool isolation** — each tool mounts its own actor; no project-level
   preflight store shared between validation and build_package.
3. **Depends on W0.3 attestation** — even after fan-in, validation may always
   block until per-page clean attestation exists; fan-in still required for
   honest “blocked” vs “passed” display.

## Defects to fix

1. **Wire PREFLIGHT fan-in** from validation report (or project validation
   stage status) into `buildPackageTool` via shell/shared service.
   (Primary)
2. **Map validation blockers → preflight status** (`passed` / `blocked` /
   `unknown`) consistently with backend validation report.
3. **Keep BUILD guard** — do not bypass `preflightPassed` with a hardcoded
   passed seed in production.

## Next steps

1. Define single source of preflight truth (validation stage artifact /
   aggregate / GET validation report).
2. On validation settle or shell focus of build_package, send
   `PREFLIGHT_PUSH` with mapped status.
3. **Done when (falsifiable):** with validation report clean, Build enables
   without manual PREFLIGHT_PUSH in tests that use the real fan-in path; with
   known blocker, preflight is `blocked` and Build stays disabled; component
   or integration test covers both; `make ci AI=1` green.
   Matches plan W1.6 done-when (“Build gate reflects real validation report”).

## Resolution

*Open.*
