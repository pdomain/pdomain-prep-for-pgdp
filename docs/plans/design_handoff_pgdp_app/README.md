# Handoff: pd-prep-for-pgdp

Design + behavior package for implementing the **pd-prep-for-pgdp** app — a Distributed Proofreaders prep pipeline that takes a scanned book from raw page images through image prep, OCR, text cleanup, and packaging for PGDP submission.

**Start here → [`PROMPT.md`](./PROMPT.md)** — paste it into Claude Code at the root of the target repo.

## About the design files

Everything under `final/` and `design-system/` is a **design reference created in HTML** — JSX prototypes showing intended look and behavior, not production code. The task is to *recreate* these designs in the target codebase's environment (React + TS + XState assumed if the repo is empty), using its established patterns. **Fidelity is high**: the canvases show final colors, typography, spacing, and states; recreate them pixel-faithfully via the tokens.

## Contents

| Path | What it is | Authoritative for |
|---|---|---|
| `PROMPT.md` | The handoff prompt for Claude Code | — |
| `final/` | 24 wired pipeline stages + Projects landing + Pipeline shell + App-shell template. Each `final/<stage>/index.html` opens a canvas of artboards covering every state; `final/<stage>/<stage>.jsx` holds the components, `*-data.js` the sample data. `final/index.html` is the launcher/map. | **Look & layout** |
| `statecharts/` | 28 framework-neutral statechart YAMLs + `README.md` (the architecture doc — read first) + `pipeline-plan.md` (rationale) | **Behavior** |
| `statechart-authoring-guide.md` | Vocabulary/conventions used by the YAMLs | — |
| `design-system/` | `tokens.css` (full token set), `ui-base.jsx` (atom kit), `template.jsx` (app-shell chrome) | **Visual language** |
| `COMPONENT_INDEX.md` | Auto-extracted component inventory per file + cross-file frequency table | Triage |

## Viewing the designs

Serve this folder with any static server (`python3 -m http.server`) and open `final/index.html`. Each card opens a stage canvas. Internet access is needed once for React/Babel CDN scripts and Google Fonts (Inter, JetBrains Mono).

Notes:
- The launcher's "Wireframe explorations" section links to draft `wf*/` folders **not included** in this bundle (superseded explorations; every stage now has a wired `final/` version). Those links will 404 — expected.
- `design-canvas.jsx`, `app.jsx`, and `canvas-nav.jsx` files are prototype scaffolding for the artboard grid — reference only, do not port.

## How the layers fit

```
design-system/tokens.css ──► every color/space/type value
design-system/ui-base.jsx ─► atoms used by every final/ component
final/<stage>/*.jsx ───────► what each screen/state looks like
statecharts/tool-*.yaml ───► how each screen behaves (events, guards, effects)
statecharts/pipeline-shell ► how stages compose, staleness fan-out, run-all
statecharts/project-* ─────► Projects landing, lifecycle, post-import
```

The Stage → machine lookup table lives in `statecharts/README.md`.

## Assets

No bitmap assets are required: all page "scans" in the prototypes are placeholder components (`FakeThumb` etc.) to be replaced by real page-image rendering. Fonts are Google Fonts (Inter, JetBrains Mono).
