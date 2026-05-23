# Word-delete editor: undo strategy

> **Status**: Shipped — but as **Option A**, not the Option B drafted below.
> **Last updated**: 2026-05-22
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#12

## TL;DR

> **Superseded by the as-shipped decision (2026-05-22).** This draft picked
> Option B (a client-side 5-second debounced commit window). It was written
> before the server-side `OcrWord.deleted` soft-delete flag + restore
> endpoint shipped under §9a. With that backend already in place, CT chose
> **Option A** instead: a persistent **"Restore last delete"** banner wired
> to the soft-delete flag, with **no countdown and no expiry timer**. The
> banner stays open until the proofer restores, dismisses, or supersedes it.
> See `docs/archive/plans/roadmap-shipped.md` §9a-followup for the
> as-shipped behaviour. The Option B design below is retained as historical
> context only.

Original draft TL;DR: use a **client-side 5-second debounced commit window**
(Option B). An "Undo" banner appears after each delete; if dismissed or after
5 s the DELETE fires. No server schema change; `remaining_words` wire contract
is already agnostic.

## Context

The v1 word-delete endpoint (`DELETE .../words`) hard-rewrites
`<root>.words.json` and `<root>.txt`. Honest single-level undo requires either
server-side state (soft-delete flag + restore endpoint) or a client-side hold
that delays the actual write.

Option A (server-side `OcrWord.deleted: bool`) is more durable — survives page
reload — but requires a schema migration, a new restore endpoint, and changes
to every `remaining_words` query to filter deleted rows.

Option B (client-side debounced window) requires no server changes and is
sufficient for a solo proofer workflow where deletes are deliberate and the
user is sitting at the keyboard.

## Constraints

- No breaking change to the existing DELETE wire contract.
- Undo must not survive page navigation — too complex to reconcile with
  concurrent state changes (re-OCR, stage reruns).
- The "Undo" affordance must be accessible (keyboard + button).
- Bulk-delete (marquee select → Delete key) must also be undoable in a single
  action, not word-by-word.

## Decision

### Debounce window

After the user triggers a delete (Delete/Backspace key or "Delete N words"
button), `TextReviewPage` enters an **undo window** state:

- The deleted words are removed from the `WordBboxOverlay` immediately
  (optimistic UI — the canvas looks right away).
- An "Undo" banner mounts at the top of the page:
  `"Deleted N word(s). Undo"` with a countdown or progress bar showing the
  remaining window. Duration: **5 seconds**.
- A `useHotkeys("mod+z")` hook fires the undo action while the banner is
  visible. Scope: not enabled inside textareas/inputs (same rules as Delete).
- The banner has an explicit "Undo" button for pointer users.

### Undo action

Clicking "Undo" or pressing Ctrl+Z during the window:

1. Cancels the pending DELETE call (the `AbortController` for the mutation).
2. Restores the deleted words to the canvas (re-inserts into the local words
   state).
3. Dismisses the banner.

No server round-trip — the server was never written to.

### Commit on expiry or dismissal

When the 5-second window expires without undo, the DELETE fires normally. The
banner also has a "Confirm" / dismiss-X button for users who want to commit
immediately without waiting.

### Navigate-away behaviour

On route change while the undo window is open, fire the DELETE immediately
(via the `useEffect` cleanup or a `beforeunload`-equivalent React Router
`useBlocker` hook). Do not silently drop the deletion — the user explicitly
deleted those words.

### No cross-delete stacking

Only one undo window is active at a time. A second delete while the window is
open commits the first (fires DELETE immediately) and opens a new window for
the second batch. This keeps the state model simple.

## Contract / Acceptance

- [ ] After Delete/Backspace or toolbar button: words disappear from canvas
  immediately; "Undo" banner appears with a 5-second countdown.
- [ ] Ctrl+Z (or Cmd+Z on Mac) during the window restores the words to the
  canvas; banner dismisses; no DELETE fires.
- [ ] "Undo" button in the banner has same effect as Ctrl+Z.
- [ ] After 5 seconds without undo: DELETE fires; banner auto-dismisses.
- [ ] "Confirm" / ✕ button on banner fires DELETE immediately.
- [ ] Navigating away while window is open fires DELETE before unmount.
- [ ] Bulk-delete (N words from marquee) is a single undo action — all N
  words restore together.
- [ ] A second delete while the window is open commits the first batch, then
  opens a new window for the new batch.
- [ ] Vitest: undo-window state transitions (open → undo, open → expire,
  open → navigate); abort signal is cancelled on undo.
- [ ] `useHotkeys` scope: Ctrl+Z fires in the page body but not inside a
  focused `<textarea>` or `<input>`.

## Trade-offs considered

**Server-side soft-delete (Option A).** More durable; undo survives reload.
But requires a `deleted: bool` column on `OcrWord`, a migration, a restore
endpoint, and changes to every query that reads words. Adds permanent schema
complexity for a UX feature that is rare in practice.

**Ctrl+Z without a timer.** Pure instant-undo (no delay, no banner). Clean UX
but forces the user to undo before any other action. Too easy to lose deletions
accidentally. The 5-second window is more forgiving without adding server
complexity.

**Stacking multiple undo levels.** Too complex for the benefit; the word-delete
workflow is deliberate (marquee-select then Delete), not rapid-fire.

## Consequences

- No server schema change. Existing DELETE endpoint and `remaining_words`
  contract are unchanged.
- The `AbortController` pattern is new to the mutation hooks; future mutations
  that need similar debounce can reuse it.
- Undo does not survive page reload. This is acceptable for a review tool — the
  user is expected to be deliberate about deletes.

## Open questions

None.

## References

- `docs/plans/roadmap.md` §P1 "9a-followup" — undo/soft-delete context
- `docs/archive/plans/roadmap-shipped.md` §9a — v1 DELETE endpoint and marquee-select
  implementation
- `frontend/src/pages/TextReviewPage.tsx` — current delete mutation call site
- `frontend/src/components/WordBboxOverlay.tsx` — word selection state
