---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# OCR / wordcheck / text_review tools lack live queue SSE (W1.4 / B5)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** High — interactive text tools stuck or show mock data
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21 pipeline review)
- **Read when:** wiring tool SSE bridges, unblocking text-chain UI, or comparing hi-fi grayscale PAGE_PUSH to thin text
  tools.
- **Search terms:** PAGE_PUSH, SCAN_DONE, QUEUE_READY, MOCK_ITEMS, OcrTool, WordcheckTool, TextReviewTool, B5, W1.4, SSE
- **Relates to:** [Pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

Three text-group React tools never leave their waiting/mock states on a real
run: **OcrTool** starts in `recognising` without a production `PAGE_PUSH`
bridge; **WordcheckTool** waits for `SCAN_DONE` but only injects it via a
test-only `_testScanDone` prop (production SSE missing after mock removal);
**TextReviewTool** still mounts with `setTimeout` + `MOCK_ITEMS`. Grayscale
already demonstrates the correct pattern (`subscribePageChannelForTool` →
`PAGE_PUSH`). Until live SSE or hydrate-from-aggregate lands, proofers cannot
operate these stages honestly.

## Impact

- OcrTool progress/stats stay zero; wordcheck stays on scanning forever in
  production; text_review shows fake queue items.
- Silent product failure: UI looks “alive” (text_review) or hung (wordcheck)
  without reflecting dual-written stage state.
- Blocks Wave 1 expert book walk for scanno review and attestation queue.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
frontend tools:
  frontend/src/pages/pipeline/tools/OcrTool.tsx
  frontend/src/pages/pipeline/tools/WordcheckTool.tsx
  frontend/src/pages/pipeline/tools/TextReviewTool.tsx
reference hi-fi bridge:
  frontend/src/pages/pipeline/tools/GrayscaleTool.tsx
parent: docs/plans/2026-07-21-pipeline-completion-review.md §B5 / W1.4
```

## Evidence

### 1. OcrTool — no PAGE_PUSH bridge

File header still documents mock/F5 wiring; production path has no
`subscribePageChannelForTool` (contrast GrayscaleTool):

```1:15:frontend/src/pages/pipeline/tools/OcrTool.tsx
 * At F5: mock-only wiring (PAGE_PUSH events from a simulated run).
 * At I1: real SSE actor feeds PAGE_PUSH events; confirmStage hits the backend;
 ...
```

No `PAGE_PUSH` send appears in the component body (grep: only settings /
confirm / recognition actions). Machine starts in `recognising`; tests note
stat cells stay zero until SSE arrives.

### 2. WordcheckTool — SCAN_DONE missing in production

Mock setTimeout was removed (W5.4); only test injection remains:

```524:532:frontend/src/pages/pipeline/tools/WordcheckTool.tsx
  // W5.4: removed 200ms setTimeout + MOCK_SUSPECTS (was leaking mock data into
  // production flow). In production, SCAN_DONE arrives via SSE at I1.
  // `_testScanDone` fires immediately on mount for artboard tests only.
  useEffect(() => {
    if (!`_testScanDone`) return;
    send({ type: "SCAN_DONE", ...`_testScanDone` });
```

Without `_testScanDone`, machine remains in `scanning` (header: “Machine waits
in `scanning` until the first SCAN_DONE arrives”).

### 3. TextReviewTool — MOCK_ITEMS + setTimeout

```43:56:frontend/src/pages/pipeline/tools/TextReviewTool.tsx
const MOCK_ITEMS: QueueItem[] = [
  {
    id: "qi1",
    word: "tbe",
    ...
```

```539:557:frontend/src/pages/pipeline/tools/TextReviewTool.tsx
  // Simulate mock QUEUE_READY on mount
  useEffect(() => {
    const timeout = setTimeout(() => {
      send({
        type: "QUEUE_READY",
        queue: MOCK_ITEMS,
        threads: MOCK_THREADS,
        ...
      });
    }, 150);
```

### 4. Working reference: GrayscaleTool PAGE_PUSH

```308:325:frontend/src/pages/pipeline/tools/GrayscaleTool.tsx
  // SSE bridge: subscribe to project-wide page-stage channel for PAGE_PUSH events.
  ...
          type: "PAGE_PUSH",
```

## Root-cause hypotheses

1. **(Most likely) F5 mock shell never upgraded** — machines and design
   handoff assume SSE actors; only grayscale (and partial others) got
   `pageToolSseBridge`.
2. **Wordcheck mock removal without replacement** — W5.4 correctly stopped
   leaking fake suspects but left production without SCAN_DONE source.
3. **Aggregate hydrate alternative** — tools could load completed stage
   artifacts on mount instead of pure SSE; neither path is implemented for
   these three.

## Defects to fix

1. **OcrTool:** production PAGE_PUSH (or hydrate-from-aggregate) so pages leave
   recognising with real conf/stats. (Primary for OCR)
2. **WordcheckTool:** production SCAN_DONE / SCAN_PROGRESS from real flags
   artifacts or SSE (not only `_testScanDone`).
3. **TextReviewTool:** remove `MOCK_ITEMS` mount path; QUEUE_READY from real
   queue / stage state.
4. Prefer shared bridge pattern from GrayscaleTool where page-stage SSE applies.

## Next steps

1. Map each machine’s required events to existing SSE channels or REST hydrate
   endpoints (smallest path per tool).
2. Implement bridges; delete mock setTimeout / MOCK_ITEMS from production mounts.
3. **Done when (falsifiable):** without test-only props, each tool leaves
   scanning/recognising/assembling and shows real project data (or empty
   legitimate zero-state) after a completed stage run; unit/component tests
   cover hydrate/SSE without relying solely on mocks; `make ci AI=1` green.
   Matches plan W1.4 done-when.

## Resolution

*Open.*
