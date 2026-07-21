---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# Hyphen_join defaults to identity; decisions thin; scan API real but persist/workbench gaps (W1.3)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — joins never change packaged text end-to-end
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21 pipeline review)
- **Read when:** finishing hyphen_join workbench, decision persistence, or text-chain join behaviour.
- **Search terms:** hyphen_join, HyphenJoinDecision, scanHyphenation, persistDecision, KEEP_HYPHEN,
  apply_join_decisions, W1.3
- **Relates to:** [Pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

The hyphen_join **scan** path is real (`frontend/src/services/tools/hyphenJoin.ts`
→ project-stage scan API; pure `detect_candidates` / `apply_join_decisions`).
Default stage execution is identity: without `cfg.hyphen_join_decisions` the
CPU callable returns text unchanged. Frontend machine side-effects
(`persistDecision`, `persistPage`, …) are still no-ops. The API
`POST …/hyphen-join/decisions` annotates candidates in the response but does
not rewrite the stage text artifact or durable event log for re-run. Workbench
pre/post text panels remain “Wired at I1” placeholders.

## Impact

- End-of-line hyphens survive into package `.txt` even after UI “decisions.”
- Decisions do not survive reload; re-scan loses proofer work.
- Misleading UX: scan populates cases, but keep/join does not change disk text.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
backend: core/pipeline/steps/hyphen_join.py
         api/data/pages.py post_hyphen_join_decisions
         api/data/project_stages.py hyphen_join/scan
frontend: services/tools/hyphenJoin.ts
          machines/tools/hyphenJoin.ts
          pages/pipeline/tools/HyphenJoinTool.tsx
parent: docs/plans/2026-07-21-pipeline-completion-review.md §B5 / W1.3
```

## Evidence

### 1. Stage default is identity

```199:227:src/pdomain_prep_for_pgdp/core/pipeline/steps/hyphen_join.py
def hyphen_join_v2_cpu(text_bytes: bytes, cfg: Any = None) -> bytes:
    ...
    # In the default (no decision events) mode, the stage returns the text
    # unchanged — all join decisions are made interactively...
    decisions: list[dict[str, Any]] = []
    if cfg is not None:
        raw_decisions = getattr(cfg, "hyphen_join_decisions", None)
        if raw_decisions:
            decisions = list(raw_decisions)

    result = apply_join_decisions(text, decisions)
    return result.encode("utf-8")
```

### 2. Scan service is real; only scan is wired

```1:43:frontend/src/services/tools/hyphenJoin.ts
 * Backend routes:
 *   POST /api/data/projects/{id}/project-stages/hyphen_join/scan
 *   ...
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/hyphen-join/decisions
...
export function buildRealHyphenJoinServices(): HyphenJoinServices {
  return { scanHyphenation };
}
```

No decision-persist function is exported from the service factory.

### 3. Machine persist slots are no-ops

```513:526:frontend/src/machines/tools/hyphenJoin.ts
    persistDecision: () => {
      // SIDE EFFECT: at I1, POST /api/projects/:id/stages/hyphen_join/decisions
    },
    ...
    persistPage: () => {
      // SIDE EFFECT: at I1, POST .../hyphen_join/pages/:id/commit
    },
```

### 4. Decisions API does not rewrite stage text

`post_hyphen_join_decisions` (`api/data/pages.py` ~2605–2669) re-detects
candidates, maps submitted decisions onto the response payload, and returns
annotated candidates — it does not dual-write a new `hyphen_join` text
artifact or persist `HyphenJoinDecision` events for `cfg.hyphen_join_decisions`
replay.

### 5. Workbench gaps

`HyphenJoinTool.tsx` still labels pre/post page text panels as
“Wired at I1” (placeholders around the review surface).

## Root-cause hypotheses

1. **(Most likely) Half-shipped I1** — scan route landed (R2 drift fix); decision
   write path and machine side-effects never finished.
2. **API vs stage model mismatch** — decisions endpoint is response-only
   annotation, not the event-first re-run contract described in the step module
   docstring (`HyphenJoinDecision` + original text).
3. **Missing cfg injection on re-run** — even if events were stored, the page
   runner may not pass `hyphen_join_decisions` into the CPU callable.

## Defects to fix

1. **Persist decisions end-to-end** (API + dual-write or event log) so they
   survive reload. (Primary)
2. **Apply decisions to stage text output** when joins are accepted
   (re-run or inline rewrite with dual-write).
3. **Wire machine `persistDecision` / `persistPage`** to real services; drop
   thin workbench seed placeholders for pre/post text.
4. **Ensure re-run loads decisions into `cfg.hyphen_join_decisions`.**

## Next steps

1. Failing API/UI test: POST join decision → reload → decision present; stage
   `output.txt` (or equivalent) reflects joined form for accepted candidates.
2. Implement durable decision storage + text rewrite/re-run path.
3. **Done when (falsifiable):** decision survives reload; stage text output
   changes when joins applied; identity still holds when no decisions;
   `make ci AI=1` green. Matches plan W1.3 done-when.

## Resolution

*Open.*
