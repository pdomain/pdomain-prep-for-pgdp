# Issue #130 — Unsaved text-review edits can be silently overwritten

> **Status**: Draft
> **Last updated**: 2026-05-24
> **Spec-Issue**: pdomain/pdomain-prep-for-pgdp#130

## TL;DR

`TextReviewPage.tsx` copies fetched OCR text directly into the editable draft state whenever the
TanStack Query result changes, and navigation links (Prev/Next) are plain `<Link>` elements with
no dirty-state guard. A background refetch, split-selector change, or Prev/Next click can silently
discard unsaved edits without confirmation. The fix is to separate server state from local draft
state, apply server updates only when the draft is clean, and block navigation (route change +
`beforeunload`) when the draft is dirty.

## Context

**Vulnerable pattern — unconditional overwrite on refetch:**
`frontend/src/pages/TextReviewPage.tsx:113-128`

```typescript
useEffect(() => {
  if (text$.data) {
    setText(text$.data.text);   // overwrites draft unconditionally
    setWords(text$.data.words ?? []);
    setDirty(false);
    ...
  }
}, [text$.data, text$.error]);
```

Every time `text$.data` changes identity (TanStack Query refetch, cache invalidation, or window
refocus) this effect runs and overwrites `text` (the editable textarea value) regardless of
whether `dirty === true`. The user's unsaved edits disappear silently.

**Vulnerable pattern — Prev/Next navigation without guard:**
`frontend/src/pages/TextReviewPage.tsx:496-507`

```tsx
<Link to={`/projects/${projectId}/pages/${Math.max(0, idx0 - 1)}/review`}>← Prev</Link>
<Link to={`/projects/${projectId}/pages/${idx0 + 1}/review`}>Next →</Link>
```

Plain React Router `<Link>` elements trigger navigation immediately. When `dirty === true`,
navigating away discards the edit without a "You have unsaved changes" confirmation.

**Vulnerable pattern — no `beforeunload` blocker:**
No `beforeunload` event listener. If the user closes the tab or refreshes while `dirty === true`,
the browser does not warn them.

**Severity:** categorized "code-quality / data-loss" rather than a security vulnerability. The
`area:tests` label reflects that the fix should include tests for refetch overwrite and navigation
guard behavior.

**Adapters affected:** frontend only. No backend changes needed.

## Goals / Non-Goals

**Goals:**

- Keep server state (`serverText`) and local draft (`draftText`) as separate state variables.
- Apply server state to draft only when `dirty === false` (no unsaved edits) or when the user
  explicitly confirms discarding their edits.
- Block Prev/Next navigation when `dirty === true` with a browser-native confirmation dialog
  (or an in-app modal).
- Block browser `beforeunload` when `dirty === true`.
- Reset `dirty` correctly: only on successful save or on explicit discard.
- Add unit/integration tests for the refetch overwrite case and the navigation guard.

**Non-Goals:**

- Auto-save / optimistic locking (deferred; see Open Questions).
- Conflict detection when two users edit the same page simultaneously (multi-user concern).
- Changing the backend text API.

## Constraints

- TanStack Query's `staleTime` controls background refetch frequency; this spec does not require
  changing `staleTime`, but the fix must handle refetches regardless of frequency.
- React Router v6 `useBlocker` hook is available; it provides a callback-based blocker for
  in-app navigation. Use it for Prev/Next guards.
- `beforeunload` must be registered as a native DOM event listener (not a React Router mechanism).
- The `dirty` flag is already part of local state (`useState`); no new state shape is needed
  beyond tracking `serverText` separately.
- Confirmation UX: a native `window.confirm("You have unsaved changes. Discard?")` is acceptable
  for V1. A custom modal (Radix `AlertDialog`) is preferred long-term but is out of scope here.

## Options Considered

**Option A — Guard the effect: only apply server text when `dirty === false`:**
Change the `useEffect` to check `dirty` before overwriting:

```typescript
useEffect(() => {
  if (text$.data && !dirty) {
    setText(text$.data.text);
    setWords(text$.data.words ?? []);
    setDirty(false);
    ...
  }
}, [text$.data, text$.error]);
```

Simplest change. Weakness: on page mount `dirty === false` and `text$.data` is `undefined`;
when data first arrives `dirty` is still false so the initial load works. But if the page is
mounted with an already-dirty state (shouldn't happen but worth guarding), this could miss an
initial load. Also does not address Prev/Next navigation.

**Option B — Separate `serverText` state; apply only on clean draft; block navigation (chosen):**
Introduce `serverText: string | null` alongside `draftText: string`. The effect always updates
`serverText` but only copies to `draftText` when `dirty === false`. Navigation is blocked via
`useBlocker` + `beforeunload`. This fully decouples server state from local draft and makes the
data flow explicit.

**Option C — Optimistic locking token:**
Backend returns a `text_version` (e.g. `last_modified_at` RFC 3339 timestamp) with the text.
Save request includes the token; backend rejects saves if the token is stale (someone else
edited). This prevents lost-update conflicts in multi-user scenarios. Weakness: significantly
more complex; requires backend changes. Out of scope for the local-first V1 priority. Defer as
a follow-on Open Question.

## Decision

**Option B.**

**State model after the fix:**

```typescript
const [serverText, setServerText] = useState<string | null>(null);
const [draftText, setDraftText] = useState<string>("");
const [dirty, setDirty] = useState(false);
```

**Effect — update server state, apply to draft only when clean:**

```typescript
useEffect(() => {
  if (text$.data) {
    setServerText(text$.data.text);
    setWords(text$.data.words ?? []);
    if (!dirty) {
      setDraftText(text$.data.text);
      setDirty(false);
      setActiveWordIndex(null);
      setSelectedWordIds(new Set());
    }
  } else if (text$.error) {
    setServerText("");
    if (!dirty) {
      setDraftText("");
      setDirty(false);
      ...
    }
  }
}, [text$.data, text$.error]);  // dirty intentionally NOT in deps — see note below
```

Note: `dirty` is excluded from deps to avoid the effect re-running on every keystroke. The
snapshot of `dirty` at the time the effect runs is the correct guard; a stale `dirty=true`
correctly prevents overwriting mid-edit.

**Textarea handler** — unchanged: `setDraftText(e.target.value); setDirty(true)`.

**Discard helper** — used by confirm dialog:

```typescript
const discardEdits = useCallback(() => {
  if (serverText !== null) {
    setDraftText(serverText);
  }
  setDirty(false);
}, [serverText]);
```

**Navigation blocker (`useBlocker`):**

```typescript
const blocker = useBlocker(dirty);
useEffect(() => {
  if (blocker.state === "blocked") {
    if (window.confirm("You have unsaved changes. Discard and navigate?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }
}, [blocker]);
```

**`beforeunload` listener:**

```typescript
useEffect(() => {
  if (!dirty) return;
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, [dirty]);
```

**Rename in component:** replace `text` / `setText` with `draftText` / `setDraftText` throughout.
The textarea `value={text}` becomes `value={draftText}`.

## Implementation Plan

**Slice 1 — Separate `serverText`/`draftText` + refetch-safe effect (TDD):**

- `tests/TextReviewPage.test.tsx` (new vitest test): render the page component with a mocked
  query; simulate a refetch while `dirty === true`; assert `draftText` is NOT overwritten by the
  new server value.
- `tests/TextReviewPage.test.tsx`: simulate initial load (dirty=false); assert `draftText` equals
  server text.
- Implement the state split and updated `useEffect`.

**Slice 2 — Navigation blocker + `beforeunload`:**

- `tests/TextReviewPage.test.tsx`: render the page with `dirty === true`; simulate a Prev/Next
  click; assert `useBlocker` was activated (mock the blocker and assert it was called with `true`).
- `tests/TextReviewPage.test.tsx`: with `dirty === false`; simulate navigation; assert blocker
  not activated.
- Implement `useBlocker` and `beforeunload` listener.

## Test Plan

**Failing test (proves the refetch overwrite bug before fix):**

```typescript
// tests/TextReviewPage.test.tsx
it("does not overwrite dirty draft on refetch", async () => {
  const { queryClient, rerender } = renderTextReviewPage({
    initialText: "original server text",
  });
  // User types something
  const textarea = screen.getByRole("textbox");
  await userEvent.type(textarea, " edited");
  expect(textarea).toHaveValue("original server text edited");

  // Server returns new text (simulates refetch)
  queryClient.setQueryData(textQueryKey, { text: "refetched server text", words: [] });
  await waitFor(() => {});  // flush effects

  // Before fix: textarea would show "refetched server text" — edit lost
  // After fix: textarea still shows "original server text edited"
  expect(textarea).toHaveValue("original server text edited");
});
```

**Regression:**

- Initial page load populates the textarea with server text.
- After a successful save, a subsequent refetch IS applied to the draft (because `dirty` resets
  to false on save).
- Split selector change (different suffix) loads new text for the clean draft.
- Prev/Next navigation with `dirty === false` proceeds without a confirmation prompt.

## Open Questions

1. **Optimistic locking / `text_version` token:** the backend text endpoint returns `text_key`
   alongside the text. Should `text_key` serve as an optimistic-lock token? If the save endpoint
   accepted `text_key` and rejected saves where `text_key` no longer matches, lost-update
   conflicts in multi-user scenarios would be caught. Low priority for local-first but worth
   noting here for the future.

2. **Custom Radix `AlertDialog` vs `window.confirm`:** native `window.confirm` blocks the JS
   thread and cannot be styled. A Radix `AlertDialog` is non-blocking and matches the app's
   design language. This spec scopes V1 to `window.confirm`; a follow-on can swap in the dialog.

3. **Split selector change while dirty:** when the user switches `splitSuffix` (which changes
   the query key and triggers a new fetch), should this also be treated as navigation requiring
   confirmation? The current spec does not guard split-selector changes; add if user feedback
   requests it.
