# Future: Managed Adapter Path for PGDP

**Status:** Design note, not a current milestone. Captured 2026-05-06 to
keep the eventual managed deployment shape coherent with decisions being
made today (storage layout, GPU dispatcher, adapter boundaries). Nothing
in the current roadmap (`docs/plans/roadmap.md`) depends on this; do not
treat it as a spec.

This document is intentionally narrow: it describes how the **managed**
adapter shape (`specs/09-deployment.md`) should be sized and wired
*specifically* for the Project Gutenberg Distributed Proofreaders (PGDP)
audience — the realistic eventual deployment of pgdp-prep. Earlier
internal sketches assumed paid-SaaS economics; that framing is wrong for
this user base and would lead to over-engineering.

---

## 1. Audience and constraints

- **Users:** ~50 volunteer Project Managers (PMs) at PGDP, each prepping
  2–3 books/day.
- **Workload:** ~100–150 batches/day across the cohort. Batches average
  ~200 pages.
- **Budget:** free, volunteer-run project. Realistic monthly ceiling
  **$0–5/mo plus a domain**. Anything that would push past that has to
  justify itself or be cut.
- **Goal of the managed adapter for this audience:** coordination,
  shared storage, and shared GPU access — *not* hosting compute that PMs
  are already capable of running locally on their own laptops.

The local-first FastAPI path therefore stays primary. Each PM continues
to run pgdp-prep on their own machine for the bulk of the work. The
managed adapter is an opt-in coordination + GPU-offload layer, not a
SaaS replacement.

---

## 2. Division of labor (load-bearing)

What runs **where** is the most important decision in this design,
because it determines whether the free-tier budget holds.

**Stays on the PM laptop (CPU):**

- PNG optimization (handled by the sibling `pd-png-optimizer` Rust core
  via its Python facade — fast, parallelizable across 50 laptops for
  free, no reason to centralize).
- Final PGDP package assembly / zip.
- Classical Hough deskew fallback. The marginal quality win from
  GPU-accelerating this is not worth the credit.
- Ingest, rename/prefix, illustration cropping, OCR text post-process,
  manifest generation — everything in `core/pipeline/` that already runs
  comfortably on a laptop.

**Goes to the managed GPU (only if learned models help):**

- Learned dewarp.
- Learned denoise.
- Super-resolution for low-DPI scans.
- Perspective unwarp for camera-captured pages.

GPU work is *only* the work that is genuinely painful on CPU. Anything
else stays on the laptop where it's already free.

---

## 3. Components

### 3.1 PM laptop

Runs pgdp-prep locally exactly as today. Adds two new outbound
relationships when in managed mode:

1. Coordinator API (state, ETA, auth).
2. Cloudflare R2 (bytes in, bytes out).

The local FastAPI process is unchanged; the managed-mode wiring lives
behind the existing adapter Protocols (`IStorage`, `IDatabase`, `IAuth`,
`GPUBackend`).

### 3.2 Coordinator

Thin FastAPI service. Responsibilities:

- Track batch state: `queued` / `processing` / `done` / `failed`.
- Show PMs an ETA / position-in-line.
- Expose a small API the local pgdp-prep talks to.

**Hosting:** Cloud Run free tier or Fly.io free `shared-cpu-1x` —
either fits comfortably. SQLite or R2-backed metadata is enough at this
scale; no managed Postgres needed.

**Auth:** GitHub OAuth, or piggyback on PGDP's existing accounts if
that's available — PMs already have PGDP credentials.

### 3.3 Shared storage — Cloudflare R2

R2 (not S3) is decisive for this workload:

- Free tier: 10 GB stored + 1M class-A ops/mo.
- **No egress fees.** This is the line that makes the design viable —
  an image-heavy workload reading and writing batches all day would
  blow out S3's egress quickly.
- Modal pulls from R2 with no egress charge, completing the pairing.

If a future contributor proposes "just use S3 instead," egress would
become the largest line item on the bill. R2 is a deliberate choice;
preserve it.

**Layout:**

```
inbox/{batch-id}/    # uploaded by PM laptop, awaiting GPU
outbox/{batch-id}/   # written by GPU pipeline, downloaded by PM laptop
```

### 3.4 GPU pipeline — Modal scheduled function

Funded by Modal's $30/mo free credit. At T4 prices (~$0.59/hr), the
credit covers ~50 GPU-hours/month. Estimated need at full PGDP volume
(100 batches/day × ~200 pages × ~200 ms/page) is ~33 hr/mo —
comfortably under budget with ~50% headroom.

Shape:

```python
@app.function(
    schedule=modal.Cron("0 */6 * * *"),
    gpu="T4",
    timeout=1500,
)
def drain_queue():
    ...
```

One function, fired every 6 hours. The cron interval can move; what's
load-bearing is the *single-session drain pattern* described next.

---

## 4. The single-session drain pattern

This pattern is the design's most important detail. Each rule earns its
place; do not cargo-cult drop one without thinking about what fails.

1. **One Modal invocation per cron tick.** One warm container drains
   the entire queue sequentially.
2. **Model weights load once per tick, not per batch.** This is the
   primary throughput win versus "function per batch" — model load
   dominates per-batch cost on a cold start.
3. **Tensor-batch pages inside the loop.** 8–16 pages at a time through
   the dewarp model, where the model supports it. Often gets 2–4×
   throughput vs page-at-a-time. Free win.
4. **Cap by elapsed wall time, not by queue depth.** Loop checks
   `time.monotonic()` before each batch. Leftovers stay in `inbox/`
   and drain on the next tick. This makes spend predictable and
   prevents a single huge backlog from running an orphaned container
   for hours.
5. **Stream results out as you go.** Write each finished batch's
   `outbox/` keys and coordinator status update *inside* the loop, not
   after. If the run dies at minute 23 of a 25-minute window, the
   first N batches are already delivered; only the in-flight one is
   lost.
6. **Order oldest-first by submission time.** PMs who waited hours
   shouldn't get leapfrogged by a batch that landed 30 seconds before
   the cron fired. Fairness matters when the audience is volunteers.
7. **Graceful free-credit exhaustion.** At the start of each run,
   check Modal usage; if the monthly credit is gone, no-op cleanly.
   The coordinator surfaces "GPU paused until next month"; pgdp-prep
   on the PM laptop falls back to the local CPU dewarp path. Worse
   quality, but never blocked.
8. **Determinism.** Pin the model version and the Modal image digest
   in the output manifest. PGDP reviewers will eventually ask "what
   produced this output," and we want to be able to answer.

---

## 5. Why R2 + Modal specifically

Worth stating because the alternatives look superficially similar and
quietly cost more:

- **R2 over S3:** R2 has free egress; S3 doesn't. For an image-heavy
  workload, egress is the dominant cost. R2 also pairs with Modal's
  outbound network without adding charge.
- **Modal over a self-managed GPU box:** the $30/mo credit covers our
  entire estimated GPU need. No fixed-cost VM running idle between
  cron ticks. The scheduled-drain pattern fits Modal's billing model
  (per-second-while-running) almost exactly.
- **Cloud Run / Fly.io free tier over a paid coordinator:** the
  coordinator does basically nothing — small REST surface, low QPS.
  A free-tier instance is more than enough.

---

## 6. Realistic monthly bill

- Modal: $0 (covered by $30/mo credit).
- R2: $0 (under 10 GB free tier).
- Cloud Run / Fly.io: $0 (under free tier).
- Domain: ~$10–15/yr, so call it ~$1/mo.

Total: **$0–5/mo plus a domain.**

This is the number that justifies the architecture. If a proposed
change pushes past it without strong reason, the change is wrong for
this audience.

---

## 7. Cross-references

- **`pd-png-optimizer`** — the CPU-side optimizer that stays on PM
  laptops. Don't centralize PNG optimization on the GPU side; the
  laptops are free compute and the Rust core is fast.
- **`pdomain-ocr-labeler-spa`** — recording a parallel future-possibility
  note for an OCR-batch-prior-to-labeling pattern that uses the same
  Modal scheduled-drain shape. Worth keeping the two designs aligned
  if both eventually get built.
- **`pd-ocr-trainer`** — *unlikely* to share this path. Training runs
  for hours and shouldn't share a 6-hour cron'd function. If trainer
  eventually needs Modal, it should use its own Modal app with
  different scheduling and credit accounting.

---

## 8. What this note is not

- Not a spec. The current spec set (`specs/00`–`specs/09`) is the
  source of truth for design decisions on current milestones.
- Not a near-term work item. Nothing in `docs/plans/roadmap.md` depends
  on this.
- Not a commitment to Modal, R2, Cloud Run, or any specific vendor —
  but the *shape* (free-tier coordinator + free-egress object store
  - cron-drained scheduled GPU + laptop-resident CPU work) is the
  load-bearing part. Vendor swaps are fine as long as the shape and
  the budget hold.
