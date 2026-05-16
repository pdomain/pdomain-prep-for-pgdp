# pd-prep-for-pgdp Design System

## Brand & Purpose

A book-scanning prep tool for Distributed Proofreaders (PGDP). Dark, professional tone.
Users are content providers and project managers handling scanned historical books.
UI should feel like a professional document-processing tool, not a consumer app.

## Color Tokens (CSS Variables → Tailwind utilities)

### Surface layers

| Token | Light | Dark | Usage |
|---|---|---|---|
| `bg-page` | `#f8fafc` | `#020617` | Full-page background |
| `bg-surface` | `#ffffff` | `#0f172a` | Card / panel backgrounds |
| `bg-raised` | `#f1f5f9` | `#1e293b` | Hover / secondary surfaces |
| `bg-sunk` | `#e2e8f0` | `#334155` | Depressed / input backgrounds |

### Borders

| Token | Light | Dark |
|---|---|---|
| `border-1` | `#e2e8f0` | `#334155` |
| `border-2` | `#cbd5e1` | `#475569` |
| `border-3` | `#94a3b8` | `#64748b` |

### Typography (ink)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `ink-1` | `#0f172a` | `#f8fafc` | Primary text |
| `ink-2` | `#334155` | `#e2e8f0` | Secondary text |
| `ink-3` | `#64748b` | `#94a3b8` | Muted / label text |
| `ink-4` | `#94a3b8` | `#64748b` | Very muted / placeholder |

### Action & Brand

| Token | Light | Dark | Usage |
|---|---|---|---|
| `accent` | `#0f172a` | `#f1f5f9` | Primary button background |
| `accent-ink` | `#ffffff` | `#0f172a` | Primary button text |
| `brand` | `#f59e0b` | `#fbbf24` | Amber brand color |
| `brand-ink` | `#0f172a` | — | Brand text |

### Stage Status Colors

| Status | Color | Usage |
|---|---|---|
| `stage-clean` | `#10b981` (emerald) | Stage artifact up-to-date |
| `stage-dirty` | `#f59e0b` (amber) | Stage needs re-run |
| `stage-not-run` | `#cbd5e1` (slate-300) | Never executed |
| `stage-running` | `#3b82f6` (blue) | Currently executing (+ pulse animation) |
| `stage-failed` | `#ef4444` (red) | Last run errored |
| `stage-na` | `#e2e8f0` (slate-200) | Not applicable for this page type |

### Job/Task Status Colors

| Status | Color |
|---|---|
| Done / complete | `#10b981` |
| Running | `#3b82f6` |
| Queued | `#94a3b8` |
| Error | `#ef4444` |
| Awaiting review | `#f59e0b` |

## Typography

- **Sans:** Inter (400, 500, 600, 700) — all body, UI labels, headings
- **Mono:** JetBrains Mono (400, 500) — code, page prefixes (f001, p001), stems, technical IDs
- **Custom sizes:** `text-xxs` = 10px/1.2, `text-xs2` = 11px/1.3

## Component Library (Radix UI / shadcn-style)

### Layout Shell

- `AppShell` — 3-row CSS grid (header / main / footer), 100dvh
- `TopNav` — dark header bar: amber brand word, search pill (Cmd+K), bell icon, user avatar dropdown
- `PageHeader` — title + description + right-side action slot
- `ServerInfoFooter` — server URL display with copy button

### Primitives in use

- `Accordion`, `AlertDialog`, `Dialog`, `DropdownMenu`, `Popover`
- `Select`, `Tabs`, `Tooltip`, `Collapsible`, `ToggleGroup`, `Progress`, `Separator`
- `Button` (variants: primary / outline / ghost / secondary; sizes: sm/md/lg)
- `Badge` (colored dot + label, maps to status colors)
- `Card` (border + subtle shadow)
- `Input`, `Textarea`, `IconButton`, `KeyCap`, `StatTile`
- `StageCell` (stage status chip with color dot + label)
- `StatusPip` (colored dot only)
- Toast via `sonner`

### Icon set

Lucide React. Common icons: AlertTriangle, Bell, GripVertical, ChevronRight,
CheckCircle, HardDrive, Search, X, ArrowRight, Download, Upload.

## Interaction Patterns

- **Drag-to-reorder:** GripVertical handle on page rows
- **Multi-select:** Checkbox per row, Shift+click range, bulk action bar appears
- **Infinite scroll:** 200 items per page, cursor-based pagination
- **SSE live updates:** Stage chips pulse/update without user action
- **Keyboard shortcuts:** Cmd+K (search), ? (hotkey help), Escape (close modals)
- **Optimistic UI:** Page type/alignment changes apply instantly, sync in background
