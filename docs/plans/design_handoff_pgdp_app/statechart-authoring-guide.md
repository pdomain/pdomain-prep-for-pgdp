# Authoring guide: component statecharts as YAML

Supply this document to Claude (design) in any project to produce a set of
**framework-neutral statechart specs** for a UI, in the same shape and quality
as a reference set. It captures the workflow, the YAML dialect, the file
layout, and the conventions so the output is consistent across projects.

> **One-line brief you can paste:** "Create YAML statecharts for the components
> in `<path/to/component file>`, following `statechart-authoring-guide.md`. One
> file per machine in a `statecharts/` folder, plus a README index."

---

## 1. What you're producing

- **A `statecharts/` folder**: one `<machine>.yaml` per component, plus a
  `README.md` index.
- **Framework-neutral**: a readable spec, not tied to a library — but it must
  map mechanically onto XState v5 (include a short porting note in the README).
- **Grounded in real code**: every state, event, guard, and context field must
  trace back to something in the actual component (a `useState`, a handler, a
  prop, a fetch, a status enum). Do **not** invent UI the component doesn't have.

The audience is a **frontend engineer** who will implement the machine. Favor
clarity and completeness over cleverness.

---

## 2. Workflow (do this in order)

1. **Read the components first.** Open the source file(s) named by the user and
   any shared data/enum modules they reference (status maps, stage definitions,
   sample data). Identify, per component:
   - local UI state (`useState`, toggles, selected ids, active tab),
   - async work (fetches, mutations, polling),
   - events (every `onClick`/`onChange`/handler),
   - domain enums (status taxonomies, lifecycle stages),
   - parent/child relationships (which component owns selection, which is keyed
     to a selected entity).
2. **Decide the machine set.** One machine per meaningful component or concern.
   Split a machine out when it has its own async lifecycle (e.g. a feed that
   loads/polls) or its own exclusive sub-flow (e.g. a confirm→execute action).
   Add a **top-level orchestration machine** if components coordinate (selection
   driving detail panes, tabs spawning children).
3. **Confirm conventions with the user if ambiguous** — dialect (neutral vs
   XState v4/v5 vs SCXML), annotation depth (rich/medium/lean), and delivery
   (one file per machine vs combined vs an HTML viewer). Default to:
   *neutral / rich / one-file-per-machine + README*.
4. **Write each machine** following the dialect in §3 and the file template in §4.
5. **Write the README index** (§6) last, once the machine set is final.
6. These are text artifacts, not HTML — `show_to_user` the README; no
   `done`/verifier pass is needed.

Keep a todo list with one item per file.

---

## 3. The YAML dialect

Use a small, consistent vocabulary. **Define it once** in the README under a
`_CONVENTIONS` heading (copy the table from §6).

| Key | Meaning |
|-----|---------|
| `machine` / `description` | machine id + prose summary |
| `context` | extended state (data the machine carries); inline comments give the TS-ish shape |
| `initial` | initial child state of a compound node |
| `states` | child states |
| `type: parallel` | child regions all active at once |
| `type: final` | terminal state |
| `on` | event → transition map. A **list** of transitions = guarded alternatives, evaluated top→bottom (first matching `guard` wins) |
| `target` | destination. `.child` = relative; `#machine.path` = absolute by id |
| `guard` | named boolean predicate; defined under `guards:` |
| `actions` | named effects on a transition; defined under `actions:` |
| `entry` / `exit` | actions on entering / leaving a state |
| `invoke` | async actor/service for a state, with `src` + `onDone` + `onError` |
| `after` | delayed transition (`200ms`, `10s`) — timers |
| `always` | eventless ("transient") transition taken immediately when guards pass |

**Rules:**

- **Events are SCREAMING_SNAKE_CASE** (`SET_TAB`, `STATUS_PUSH`), states are
  lowerCamel or short nouns (`loading`, `confirmingDanger`).
- **Context shape as comments.** After the `context:` block, annotate each field
  with its type and origin (`# 'active' | 'archived'`), and give any payload
  object a one-line shape comment.
- **Implementation dictionaries at the bottom** of every file: `guards:`,
  `actions:`, `services:`. Each entry is the name used above mapped to a terse
  body.
  - In `guards:` write the predicate as a JS-ish expression over `ctx`/`event`.
  - In `actions:` write pure context assignments as expressions; prefix
    **side effects** (network, navigation, spawn, timers) with `//` so they're
    visibly not pure state writes.
  - In `services:` annotate each `invoke.src` with its backing endpoint and
    return shape.
- **Reference data as `ctx.<field>` and `event.<field>`** consistently.
- **Comment the domain, not the syntax.** Use `>` block comments at the top of
  each file to explain what the component is and any non-obvious rule; use
  inline comments to explain *why* an edge exists, not what the YAML keyword does.

---

## 4. Per-file template

```yaml
# =============================================================================
# Machine: <machineName>
# Surface: <where it lives in the UI> (<source file path>)
# =============================================================================
# <2–5 lines: what this component does, the lifecycle/rules it encodes,
#  and how it relates to its parent/children.>
# =============================================================================

machine: <machineName>
description: >
  <prose summary>

context:
  field: default      # <type> — <origin / meaning>
  # PayloadShape: { ... }   ← note any event/record shape here

initial: <state>

states:
  <state>:
    description: <what's true while here>
    entry: [<action>]
    invoke:
      src: <service>
      onDone:
        - target: <state>
          guard: <guard>
          actions: [<action>]
        - target: <state>
      onError:
        target: <state>
        actions: [assignError]
    on:
      <EVENT>:
        target: <state>
        guard: <guard>
        actions: [<action>]

# --- Implementation reference ------------------------------------------------
guards:
  <guard>: <predicate over ctx/event>

actions:
  <action>: ctx.x = event.y          # pure write
  <sideEffect>: //  SIDE EFFECT: <what it does>

services:
  <service>: '<METHOD /endpoint -> ReturnShape>'

# --- Notes (optional) --------------------------------------------------------
# • <highlight tricky edges, fan-in states, exclusivity rules>
```

---

## 5. Modeling patterns (reach for these)

- **Async surface** → `idle → loading → (loaded | error)`. If it refreshes
  without blanking, add a nested `refreshing` state under `loaded` that keeps
  stale data on error.
- **Polling** → a **parallel region** alongside the data region with
  `active`/`paused` states and an `after: { 10s: … }` tick; gate on an `isLive`
  guard.
- **Tabs / segmented controls** → a region whose states are the tabs; `SET_TAB`
  with a guarded transition list, one alternative per tab.
- **Selection driving detail** → a top-level orchestrator with a `selection`
  region; on `SELECT`, **re-key (respawn) project-scoped children** so they
  reset and reload. Note this explicitly.
- **Confirm → execute → result** → `list → confirming → executing →
  (done | failed)`; add a separate `confirmingDanger` gate (with an
  `ACKNOWLEDGE` step + guard) for irreversible actions.
- **Independent toggles** (e.g. collapsible sections) → a **parallel bag** of
  tiny binary regions, one per toggle, so any combination is representable.
- **Exclusive editing** → a single `editingSection`/`draft` in context with a
  `dirty` guard and a `confirmDiscard` state — even if collapse is parallel,
  editing stays exclusive.
- **Server-authoritative lifecycle** → model optimistic `request*` intents that
  fire the network, plus a `STATUS_PUSH`/`reconcile` edge available from every
  state that syncs to the backend's truth. Say "X is reachable from every
  non-terminal state" in the notes rather than drawing every edge.

---

## 6. The README index

The `README.md` must contain, in this order:

1. **Title + one-paragraph intro** — what these specs are, that they're neutral
   but map to XState.
2. **Machines table** — `File | Machine | Owns | Spawned by`.
3. **How they compose** — a small ASCII diagram of the spawn/event flow, then
   bullets explaining the hinges (what drives selection, what re-keys, what
   bubbles up).
4. **Domain rules worth highlighting** — call out the 2–4 non-obvious rules
   (two-step delete, reversible-archive, exclusivity) with file references.
5. **Any enum→UI mapping** — e.g. a status→badge-tone table, pulled from the code.
6. **`_CONVENTIONS`** — the dialect table from §3, plus notes on the
   `guards:`/`actions:`/`services:` dictionaries and the `//` side-effect marker.
7. **Porting to XState v5** — the mechanical key mapping (`after: {200ms}` →
   `{200}`, the bottom dictionaries become `setup({ guards, actions, actors })`,
   `spawn(...)` notes → `spawnChild`/`invoke`).

---

## 7. Quality checklist

Before delivering, verify:

- [ ] Every state, event, and context field traces to real component code.
- [ ] No invented UI or speculative features.
- [ ] Events SCREAMING_SNAKE_CASE; guarded transition lists ordered correctly.
- [ ] Every `invoke.src`, `guard`, and `action` named in the states appears in
      the bottom dictionaries — and vice versa (no orphans).
- [ ] Side effects are marked with `//`; pure writes are expressions.
- [ ] Async surfaces have an error state with a `RETRY`/recovery edge.
- [ ] Parallel regions are genuinely independent; exclusive flows use a single
      context field, not parallel states.
- [ ] Terminal states are `type: final`; reversible "ends" are not.
- [ ] README composition diagram matches the actual spawn/event wiring.
- [ ] Domain rules and enum mappings are pulled from the source, not assumed.
- [ ] Filenames are kebab-case (`recent-activity.yaml`); machine ids are
      lowerCamel (`recentActivity`).

---

## 8. Worked micro-example

A minimal async panel, to show the shape end-to-end:

```yaml
machine: notificationsPanel
description: >
  Loads the user's notifications and supports mark-all-read.

context:
  items: []        # Array<Notif>
  error: null      # Error | null

initial: loading

states:
  loading:
    invoke:
      src: fetchNotifications
      onDone:
        - target: empty
          guard: isEmpty
          actions: [assignItems]
        - target: list
          actions: [assignItems]
      onError: { target: error, actions: [assignError] }
  empty: {}
  list:
    on:
      MARK_ALL_READ: { actions: [markAllRead, persistRead] }
  error:
    on:
      RETRY: { target: loading, actions: [clearError] }

guards:
  isEmpty: event.data.length === 0

actions:
  assignItems: ctx.items = event.data
  assignError: ctx.error = event.error
  clearError:  ctx.error = null
  markAllRead: ctx.items = ctx.items.map(n => ({ ...n, read: true }))
  persistRead: //  SIDE EFFECT: POST /api/notifications/read-all

services:
  fetchNotifications: 'GET /api/notifications -> Notif[]'
```
