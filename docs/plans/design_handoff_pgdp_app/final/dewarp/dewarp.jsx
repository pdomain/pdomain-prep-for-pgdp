// dewarp.jsx — Dewarp-stage (stage 4) content components.
// DewarpPages (Pages tab — grid + flag review + inline before/after editor),
// DewarpOverview, DewarpStepSettings, plus DewarpThumb (a page with a curved
// "before" ghost over the flat dewarped output) and DwFlagChip primitives.
//
// Lifted from crop.jsx (CropCard / CropBanner / CropToolbar / CropBulkBar /
// preset-aware step settings) and renamed; the inline review swaps Crop's
// bbox editor for a before/after wipe comparison.

const { useState: useSD, useMemo: useMD } = React;

/* ---------------------- Curved baseline ghost ----------------------
   An SVG of N horizontal "text baselines" bowed by `amp` (px of sag at the
   gutter edge). Used both as the faint before-ghost on a thumb and as the
   real curved page in the review editor. amp scales with curveDeg.
*/
const CurvedLines = ({ w, h, amp, count = 9, color, opacity = 1, strokeW = 1.2, gutter = 'left' }) => {
  const padX = w * 0.16, padY = h * 0.13;
  const innerW = w - padX * 2, innerH = h - padY * 2;
  const lines = [];
  for (let i = 0; i < count; i++) {
    const y = padY + (innerH * (i + 0.5)) / count;
    // Sag is strongest near the gutter edge, easing to flat at the outer edge.
    const x0 = padX, x1 = w - padX;
    const cx = gutter === 'left' ? padX + innerW * 0.30 : padX + innerW * 0.70;
    const cy = y + amp; // control point pulled down → bow
    lines.push(`M ${x0} ${y} Q ${cx} ${cy} ${x1} ${y}`);
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {lines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round"
          opacity={opacity * (i === 0 || i === count - 1 ? 0.7 : 1)} />
      ))}
    </svg>
  );
};

/* ---------------------- WarpMesh overlay ----------------------
   The optional debug grid shown in the review editor: vertical lines stay
   straight, horizontals bow toward the gutter. Reveals what the worker fit.
*/
const WarpMesh = ({ w, h, amp, cols = 6, rows = 8, color = 'var(--accent)' }) => {
  const padX = w * 0.10, padY = h * 0.08;
  const iw = w - padX * 2, ih = h - padY * 2;
  const paths = [];
  for (let r = 0; r <= rows; r++) {
    const y = padY + (ih * r) / rows;
    const cx = padX + iw * 0.32, cy = y + amp;
    paths.push(`M ${padX} ${y} Q ${cx} ${cy} ${w - padX} ${y}`);
  }
  for (let c = 0; c <= cols; c++) {
    const x = padX + (iw * c) / cols;
    // verticals lean slightly to follow the bow at the gutter
    const lean = (1 - c / cols) * amp * 0.5;
    paths.push(`M ${x} ${padY} Q ${x + lean} ${padY + ih / 2} ${x} ${h - padY}`);
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={0.8} opacity={0.5} />
      ))}
    </svg>
  );
};

/* ---------------------- DewarpThumb ----------------------
   Shows the FLAT dewarped output (straight ink lines) with a faint curved
   "before" ghost layered on top, plus a gutter-shadow gradient. Flagged
   pages tint the ghost by the dominant flag tone so the grid reads at a
   glance. Skipped/illustration pages render an illustration block instead.
*/
const DewarpThumb = ({ row, w, h }) => {
  const dom = row.flags ? row.flags[0] : null;
  const ghostColor = dom && DEWARP_FLAGS[dom] ? DEWARP_FLAGS[dom].tone : 'var(--ocr)';
  const amp = Math.min(h * 0.10, (row.curveDeg || 6) * (h / 220)); // sag in px
  const paper = 'oklch(0.94 0.012 85)';
  const ink = 'oklch(0.34 0.02 60)';

  return (
    <div style={{
      width: w, height: h, position: 'relative',
      background: 'oklch(0.18 0.012 60)',
      border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden',
    }}>
      {/* Scan backdrop */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, oklch(0.30 0.015 60) 35%, oklch(0.14 0.012 60) 100%)',
      }} />
      {/* The dewarped (flat) page */}
      <div style={{
        position: 'absolute', inset: '6% 8%',
        background: paper, borderRadius: 1, overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(40,30,20,0.15), 0 1px 4px rgba(0,0,0,0.45)',
      }}>
        {row.illust ? (
          // Illustration plate — no text lines (skipped)
          <div style={{ position: 'absolute', inset: '14%', display: 'flex', flexDirection: 'column', gap: '8%' }}>
            <div style={{ flex: 1, background: 'oklch(0.62 0.04 60)', opacity: 0.35, borderRadius: 2, position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 6, border: `1px dashed ${ink}`, opacity: 0.4 }} />
            </div>
            <div style={{ height: 3, width: '50%', background: ink, opacity: 0.4, alignSelf: 'center' }} />
          </div>
        ) : (
          <>
            {/* Flat (dewarped) ink lines */}
            <div style={{
              position: 'absolute', inset: '13% 16%',
              backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.2px, transparent 1.2px 6px)`,
              opacity: 0.62,
            }} />
            {/* Faint curved "before" ghost */}
            <CurvedLines w={w * 0.84} h={h * 0.88} amp={amp} count={9}
              color={ghostColor} opacity={row.state === 'clean' ? 0.18 : 0.42} strokeW={1} />
            {/* Page-number stripe */}
            <div style={{ position: 'absolute', left: '42%', right: '42%', bottom: '7%', height: 2, background: ink, opacity: 0.5 }} />
          </>
        )}
        {/* Gutter shadow on the left edge (the binding) */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '16%',
          background: 'linear-gradient(90deg, oklch(0.55 0.02 60 / 0.40) 0%, transparent 100%)',
        }} />
      </div>
    </div>
  );
};

/* ---------------------- Flag chip / status dot ---------------------- */
const DwFlagChip = ({ kind, size = 'sm' }) => {
  const f = DEWARP_FLAGS[kind]; if (!f) return null;
  const dims = size === 'lg' ? { h: 22, px: 8, fs: 11, dot: 6 }
    : size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 }
    : { h: 16, px: 6, fs: 9.5, dot: 4.5 };
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: dims.h, padding: `0 ${dims.px}px`, borderRadius: 99,
      fontSize: dims.fs, fontWeight: 600,
      background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`,
      color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)`,
    }}>
      <span style={{ width: dims.dot, height: dims.dot, borderRadius: 99, background: f.tone }} />
      {f.label}
    </span>
  );
};

const DwStatusDot = ({ state, size = 8 }) => {
  const tone =
    state === 'clean'    ? 'var(--exact)' :
    state === 'flagged'  ? 'var(--fuzzy)' :
    state === 'reviewed' ? 'var(--ocr)'   :
    state === 'skipped'  ? 'var(--ink-4)' :
    state === 'running'  ? 'var(--ocr)'   :
    state === 'failed'   ? 'var(--mismatch)' : 'var(--ink-4)';
  return (
    <span style={{
      width: size, height: size, borderRadius: 99, background: tone,
      boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none',
      animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none',
      display: 'inline-block', flex: '0 0 auto',
    }} />
  );
};

/* ---------------------- DewarpCard (grid cell) ---------------------- */
const DEWARP_DENSITY = {
  S: { col: 9, w: 96,  h: 122, fs: 10,   flagMax: 1, flagSize: 'sm' },
  M: { col: 6, w: 140, h: 178, fs: 11,   flagMax: 2, flagSize: 'sm' },
  L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' },
};

const DewarpCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = DEWARP_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).slice(0, cfg.flagMax);
  const extra = (row.flags || []).length - flags.length;
  return (
    <div style={{
      position: 'relative', padding: 4, borderRadius: 6,
      background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' :
                  expanded  ? 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' : 'transparent',
      border: '1.5px solid ' + (selected ? 'var(--accent)' : expanded ? 'var(--ocr)' : hovered ? 'var(--border-3)' : 'transparent'),
      cursor: 'pointer', transition: 'border-color .12s, background .12s',
    }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? (
          <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} />
        ) : (
          <DewarpThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />
        )}

        {!isRunning ? (
          <div style={{
            position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 4,
            background: selected ? 'var(--accent)' : 'rgba(12,12,16,0.78)',
            border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(240,240,242,0.40)'),
            display: 'grid', placeItems: 'center', color: selected ? 'var(--accent-ink)' : 'transparent',
          }}>
            <Icon name="check" size={11} stroke={3} />
          </div>
        ) : null}

        {row.pageNumber != null ? (
          <div style={{
            position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4,
            background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10,
            fontFamily: 'var(--mono-font)', fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <DwStatusDot state={row.state} size={6} />
            {row.pageNumber}
          </div>
        ) : null}

        {/* curvature badge bottom-right */}
        {!isRunning && row.curveDeg != null && density !== 'S' ? (
          <div className="mono" style={{
            position: 'absolute', bottom: 6, right: 6, height: 16, padding: '0 5px', borderRadius: 3,
            background: 'rgba(12,12,16,0.72)', color: 'rgba(240,240,242,0.85)',
            fontSize: 9.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            <Icon name="arrowUpDown" size={8} style={{ transform: 'rotate(90deg)', opacity: 0.7 }} />
            {row.curveDeg}°
          </div>
        ) : null}

        {row.state === 'skipped' ? (
          <div style={{
            position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 16, padding: '0 6px', borderRadius: 99,
            background: 'color-mix(in oklab, var(--ink-4) 22%, rgba(12,12,16,0.78))',
            color: 'var(--ink-3)', border: '1px solid color-mix(in oklab, var(--ink-4) 45%, transparent)',
            fontSize: 9.5, fontWeight: 600,
          }}>skip</div>
        ) : flags.length > 0 ? (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {flags.map(k => <DwFlagChip key={k} kind={k} size={cfg.flagSize} />)}
            {extra > 0 ? (
              <span className="mono" style={{
                fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(12,12,16,0.85)', color: '#f0f0f2',
              }}>+{extra}</span>
            ) : null}
          </div>
        ) : null}

        {row.state === 'reviewed' ? (
          <div style={{
            position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 16, padding: '0 6px', borderRadius: 99,
            background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))',
            color: 'var(--ocr)', border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)',
            fontSize: 9.5, fontWeight: 600,
          }}>
            <Icon name="check" size={9} stroke={3} />reviewed
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? (
          <span className="mono" style={{ fontSize: cfg.fs - 1, color: 'var(--ink-4)' }}>
            {row.state === 'clean' ? 'flat' :
             row.state === 'flagged' ? `${row.flags.length} flag${row.flags.length>1?'s':''}` :
             row.state === 'reviewed' ? 'ok·rv' :
             row.state === 'skipped' ? 'skipped' : row.state}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- DewarpBanner (3-state) ---------------------- */
const DewarpBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{
        borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))',
        background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))',
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flex: '0 0 auto',
          background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)',
          display: 'grid', placeItems: 'center',
        }}>
          <span style={{
            width: 14, height: 14, borderRadius: 99,
            border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)',
            animation: 'pgd-spin 1.1s linear infinite',
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
            Fitting warp meshes…
            <span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>
              {totals.done} / {totals.total} · {totals.rateHz}/s · {totals.flagged} flagged so far
            </span>
          </div>
          <div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} />
          </div>
        </div>
        <Button variant="default" size="sm" icon="pause">Pause</Button>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ocr)', flex: '0 0 auto' }}>{pct}%</span>
      </div>
    );
  }

  const flagged = totals.flagged;
  const tone = flagged > 0 ? 'var(--fuzzy)' : 'var(--exact)';
  return (
    <div style={{
      borderRadius: 10, border: '1px solid color-mix(in oklab, ' + tone + ' 40%, var(--border-1))',
      background: 'color-mix(in oklab, ' + tone + ' 7%, var(--bg-surface))',
      display: 'flex', alignItems: 'stretch', overflow: 'hidden',
    }}>
      <div style={{ width: 4, background: tone }} />
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7, flex: '0 0 auto',
            background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))', color: tone,
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name={flagged > 0 ? 'alert' : 'checkCircle'} size={15} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
              {totals.done} pages dewarped
              {flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed · {totals.skipped} skipped</>
                          : <> · all flat</>}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
              {flagged > 0
                ? 'Click any flagged page to compare before / after; bulk-select to re-dewarp at a different strength or skip.'
                : 'Every page resampled to a flat rectangle. Confirm to advance.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['flat',     totals.clean,    'var(--exact)'],
                ['flagged',  totals.flagged,  'var(--fuzzy)'],
                ['reviewed', totals.reviewed, 'var(--ocr)'],
                ['skipped',  totals.skipped,  'var(--ink-4)'],
              ].filter(([_, n]) => n > 0).map(([k, n, color]) => (
                <span key={k} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99,
                  fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />
                  {k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        {stale ? (
          <div style={{
            padding: '6px 10px', borderRadius: 6,
            background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)',
            border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)',
            color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="alert" size={12} />Settings changed — 20 downstream stages now stale
          </div>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Toolbar (filter + density) ---------------------- */
const DewarpToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [
    { id: 'all',      name: 'All',      count: totals.total },
    { id: 'flagged',  name: 'Flagged',  count: totals.flagged, dot: 'var(--fuzzy)' },
    { id: 'clean',    name: 'Flat',     count: totals.clean,   dot: 'var(--exact)' },
    { id: 'skipped',  name: 'Skipped',  count: totals.skipped, dot: 'var(--ink-4)' },
    { id: 'reviewed', name: 'Reviewed', count: totals.reviewed, dot: 'var(--ocr)' },
    ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : []),
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>
        {chips.map(f => {
          const active = filter === f.id;
          return (
            <div key={f.id} style={{
              padding: '5px 10px', borderRadius: 6,
              background: active ? 'var(--bg-surface)' : 'transparent',
              boxShadow: active ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 7,
              color: active ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: 'pointer',
            }}>
              {f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}
              {f.name}
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span>
            </div>
          );
        })}
      </div>

      <Divider vertical style={{ height: 22 }} />

      {filter === 'flagged' ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(DEWARP_FLAG_COUNTS).slice(0, 4).map(([k, n]) => {
            const f = DEWARP_FLAGS[k];
            return (
              <span key={k} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 99,
                background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)', fontSize: 11, cursor: 'pointer',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: f.tone }} />
                {f.label}<span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <Icon name="search" size={13} /><span>Search pages…</span><KeyCap>/</KeyCap>
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="default" size="sm" icon="refresh">Re-dewarp with new strength</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
          Density
          <div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
            {['S', 'M', 'L'].map(d => {
              const a = density === d;
              return (
                <div key={d} style={{
                  padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                  background: a ? 'var(--bg-surface)' : 'transparent',
                  boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
                  color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)',
                }}>{d}</div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Bulk bar ---------------------- */
const DewarpBulkBar = ({ count, flagSummary }) => (
  <div style={{
    position: 'sticky', bottom: 12, marginTop: 12, zIndex: 5, padding: '10px 14px', borderRadius: 10,
    background: 'var(--ink-1)', color: 'var(--bg-page)',
    boxShadow: '0 12px 28px rgba(15,23,42,.22), 0 2px 6px rgba(15,23,42,.10)',
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  }}>
    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{count} selected</span>
    {flagSummary ? (
      <>
        <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
        <span style={{ fontSize: 11.5, color: 'color-mix(in oklab, var(--bg-page) 70%, transparent)' }}>{flagSummary}</span>
      </>
    ) : null}
    <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    {[
      { id: 'mild',   name: 'Re-dewarp · mild',   icon: 'refresh' },
      { id: 'strong', name: 'Re-dewarp · strong', icon: 'refresh' },
      { id: 'skip',   name: 'Skip dewarp',        icon: 'x' },
      { id: 'accept', name: 'Accept as-is',       icon: 'check' },
    ].map(b => (
      <button key={b.id} style={{
        height: 26, padding: '0 10px', borderRadius: 6,
        background: 'color-mix(in oklab, var(--bg-page) 12%, transparent)',
        border: '1px solid color-mix(in oklab, var(--bg-page) 22%, transparent)',
        color: 'var(--bg-page)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
      }}>
        <Icon name={b.icon} size={11} />{b.name}
      </button>
    ))}
    <span style={{ flex: 1 }} />
    <span className="mono" style={{ fontSize: 10.5, color: 'color-mix(in oklab, var(--bg-page) 55%, transparent)' }}>
      <KeyCap>esc</KeyCap> clear · <KeyCap>⇧</KeyCap>+click range
    </span>
  </div>
);

/* ---------------------- DewarpReviewEditor ----------------------
   Inline before/after wipe comparison that opens when clicking a flagged
   thumb. Left = curved source (before), right region revealed = flat output
   (after); a draggable wipe line sits at ~55%. An optional warp-mesh overlay
   reveals the fitted grid. Controls below: warp strength + anchor mode +
   apply-to scope + actions.
*/
const SegRow = ({ label, options, activeIdx }) => (
  <div>
    <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 7 }}>{label}</div>
    <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
      {options.map((o, i) => {
        const a = i === activeIdx;
        return (
          <div key={o} style={{
            padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
            background: a ? 'var(--bg-surface)' : 'transparent',
            boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none',
            color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500,
          }}>{o}</div>
        );
      })}
    </div>
  </div>
);

const DewarpReviewEditor = ({ row, showMesh = false, wipe = 0.55 }) => {
  const pw = 300, ph = 424;
  const amp = Math.min(ph * 0.12, (row.curveDeg || 10) * (ph / 220));
  const paper = 'oklch(0.94 0.012 85)';
  const ink = 'oklch(0.34 0.02 60)';
  return (
    <div style={{
      marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)',
      background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden',
      animation: 'pgd-slide-up .18s ease-out',
    }}>
      {/* header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))',
        display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))',
      }}>
        <Icon name="arrowUpDown" size={14} style={{ color: 'var(--ocr)', transform: 'rotate(90deg)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Compare · {row.prefix}.jp2</span>
        {(row.flags || []).map(k => <DwFlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          curvature {row.curveDeg}° · mesh score {Math.round((row.conf || 0) * 100)}%
        </span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Icon name="x" size={13} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* wipe comparison */}
        <div style={{
          padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)',
          position: 'relative', minHeight: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{ position: 'relative', width: pw, height: ph, borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.35)' }}>
            {/* AFTER (flat) — full panel underneath */}
            <div style={{ position: 'absolute', inset: 0, background: paper }}>
              <div style={{ position: 'absolute', inset: '11% 14%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.6px, transparent 1.6px 8px)`, opacity: 0.6 }} />
              <div style={{ position: 'absolute', left: '42%', right: '42%', bottom: '6%', height: 2, background: ink, opacity: 0.5 }} />
            </div>
            {/* BEFORE (curved) — clipped to the wipe portion */}
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`, background: paper }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, oklch(0.55 0.02 60 / 0.35) 0%, transparent 22%)' }} />
              <CurvedLines w={pw} h={ph} amp={amp} count={13} color={ink} opacity={0.62} strokeW={1.6} />
              {showMesh ? <WarpMesh w={pw} h={ph} amp={amp} /> : null}
            </div>
            {/* labels */}
            <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>BEFORE · {row.curveDeg}°</span>
            <span style={{ position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 4, background: 'color-mix(in oklab, var(--ocr) 90%, black)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>AFTER · flat</span>
            {/* wipe handle */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe * 100}%`, width: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }}>
              <span style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 26, height: 26, borderRadius: 99,
                background: '#fff', border: '1px solid var(--border-2)', display: 'grid', placeItems: 'center', cursor: 'col-resize', color: 'var(--ink-3)',
              }}>
                <Icon name="swap" size={12} />
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-3)', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 0, borderTop: `1.6px solid ${ink}` }} />curved input
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} />warp mesh
            </span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: showMesh ? 'var(--accent)' : 'var(--ink-3)' }}>
              <span style={{
                width: 26, height: 15, borderRadius: 99, background: showMesh ? 'var(--accent)' : 'var(--border-2)', position: 'relative', transition: 'background .12s',
              }}>
                <span style={{ position: 'absolute', top: 2, left: showMesh ? 13 : 2, width: 11, height: 11, borderRadius: 99, background: '#fff' }} />
              </span>
              Show mesh
            </label>
          </div>
        </div>

        {/* controls */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SegRow label="Warp strength" options={['Off', 'Mild', 'Standard', 'Strong']} activeIdx={2} />
          <SegRow label="Anchor mode" options={['Auto', 'Manual anchors']} activeIdx={0} />

          <div style={{
            padding: '10px 12px', borderRadius: 7, background: 'var(--bg-sunk)', border: '1px solid var(--border-2)',
            fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5,
          }}>
            <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>Manual anchors</span> let you drag points along the gutter line to pin the warp where the auto-fit was unsure.
          </div>

          <Divider />

          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Apply to</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'this', name: 'This page only', count: 1, active: true },
                { id: 'selected', name: 'Selected pages', count: 3 },
                { id: 'same', name: 'All flagged with same issue', count: (row.flags && DEWARP_FLAG_COUNTS[row.flags[0]]) || 5 },
              ].map(opt => (
                <label key={opt.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  background: opt.active ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)',
                  border: '1px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-1)'),
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 99, flex: '0 0 auto',
                    background: opt.active ? 'var(--accent)' : 'transparent',
                    border: '1.5px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-2)'),
                    display: 'grid', placeItems: 'center',
                  }}>
                    {opt.active ? <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--accent-ink)' }} /> : null}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-1)' }}>{opt.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{opt.count}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm">Cancel</Button>
            <Button variant="default" size="sm" icon="x">Skip dewarp</Button>
            <Button variant="default" size="sm" icon="check">Accept as-is</Button>
            <Button variant="primary" size="sm" icon="refresh">Re-dewarp</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- DewarpPages (Pages tab body) ---------------------- */
const DewarpPages = ({ state = 'review', density = 'M', filter = 'all', selected = [], editing = null, showMesh = false, stale = false }) => {
  const totals = state === 'running' ? DEWARP_TOTALS_RUNNING : state === 'done' ? DEWARP_TOTALS_DONE : DEWARP_TOTALS_REVIEW;
  const rows = state === 'running'
    ? DEWARP_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined, curveDeg: undefined })
    : DEWARP_ROWS;

  const filtered =
    filter === 'flagged'  ? rows.filter(r => r.state === 'flagged') :
    filter === 'clean'    ? rows.filter(r => r.state === 'clean') :
    filter === 'skipped'  ? rows.filter(r => r.state === 'skipped') :
    filter === 'reviewed' ? rows.filter(r => r.state === 'reviewed') :
    filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) : rows;

  const editingRow = editing != null ? DEWARP_ROWS.find(r => r.idx === editing) : null;
  const hasSelection = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <DewarpBanner state={state} totals={totals} stale={stale} />
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running' || !canAdvance}>
            Confirm and advance · {totals.total} pages
          </Button>
          {state !== 'running' && !canAdvance ? (
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
              {totals.flagged - totals.reviewed} flagged pages still need review
            </span>
          ) : null}
        </div>
      </div>

      <DewarpToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />

      <div style={{
        marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${DEWARP_DENSITY[density].col}, 1fr)`, gap: 6,
        padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
      }}>
        {filtered.map((r, i) => (
          <DewarpCard key={r.idx} row={r} density={density}
            selected={selected.includes(r.idx)}
            hovered={i === 2 && state !== 'running' && !hasSelection && editing == null}
            expanded={editing === r.idx} />
        ))}
      </div>

      {editingRow ? <DewarpReviewEditor row={editingRow} showMesh={showMesh} /> : null}

      {hasSelection ? <DewarpBulkBar count={selected.length} flagSummary="2 extreme-curve · 1 low-score" /> : null}
    </div>
  );
};

/* ---------------------- DewarpOverview ---------------------- */
const DewarpOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? DEWARP_TOTALS_RUNNING : state === 'done' ? DEWARP_TOTALS_DONE : DEWARP_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DewarpBanner state={state} totals={totals} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { label: 'pages',     value: totals.total, tone: 'ink-1' },
          { label: 'dewarped',  value: `${totals.done}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' },
          { label: 'flat',      value: totals.clean, tone: 'exact' },
          { label: 'flagged',   value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' },
          { label: 'skipped',   value: totals.skipped, tone: 'ink-2', sub: 'no text / illust' },
          { label: 'avg curve', value: totals.avgCurve, tone: 'ink-1', sub: 'at the gutter' },
        ].map((stat, i) => (
          <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}>
            <div className="label" style={{ color: 'var(--ink-3)' }}>{stat.label}</div>
            <div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${stat.tone})`, letterSpacing: '-0.01em' }}>{stat.value}</div>
            {stat.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{stat.sub}</div> : null}
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Flag distribution</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Issues found across {totals.done} dewarped pages</div>
          </div>
          <Button variant="ghost" size="sm" icon="eye">Open Pages</Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(DEWARP_FLAG_COUNTS).map(([k, n]) => {
            const f = DEWARP_FLAGS[k];
            const max = Math.max(...Object.values(DEWARP_FLAG_COUNTS));
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 40px', gap: 12, alignItems: 'center' }}>
                <DwFlagChip kind={k} size="md" />
                <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} />
                </div>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div>
        </div>
        {[
          ['6 min ago',  'Auto-dewarp run completed',   '387 pages · 22 flagged · 14 skipped'],
          ['6 min ago',  'Stage started',               'mesh source: both · strength standard'],
          ['9 min ago',  'Settings changed',            'max curvature: 15° → 18°'],
          ['14 min ago', 'Threshold stage confirmed',   '387 pages forwarded'],
        ].map((r, i) => (
          <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r[0]}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{r[1]}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r[2]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---------------------- Settings primitives ---------------------- */
const SettingSlider = ({ value, min, max, unit = '', pct }) => {
  const p = pct != null ? pct : (value - min) / (max - min);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 360 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{min}{unit}</span>
      <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}>
        <div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 99, background: 'var(--accent)' }} />
        <div style={{ position: 'absolute', left: `calc(${p * 100}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: 99, background: 'var(--bg-surface)', border: '2px solid var(--accent)' }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{max}{unit}</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 40, textAlign: 'right' }}>{value}{unit}</span>
    </div>
  );
};

const SettingRow = ({ title, sub, children, control }) => (
  <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: control === 'segmented' ? 'flex-start' : 'center', borderTop: '1px solid var(--border-1)' }}>
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div>
      <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div>
    </div>
    {children}
  </div>
);

const Segmented = ({ options, activeIdx }) => (
  <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
    {options.map((o, i) => {
      const a = i === activeIdx;
      return (
        <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>
      );
    })}
  </div>
);

/* ---------------------- DewarpStepSettings (preset-aware) ---------------------- */
const DewarpStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 2 changes vs project default', sub: 'Save these as the project default, or revert to inherit.',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Tight binding (hardcover)', sub: 'Loaded from a saved preset; not the project default.',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · Standard mesh dewarp', sub: 'Changes here can be saved back as the project default for Dewarp.',
  };
  const strengthIdx = state === 'preset' ? 3 : state === 'modified' ? 1 : 2;
  const meshIdx = state === 'modified' ? 0 : 2;
  const minConf = state === 'modified' ? 55 : 65;
  const maxCurve = state === 'preset' ? 24 : state === 'modified' ? 22 : 18;

  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Dewarp</h2>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>How the worker fits the warp mesh, how hard it flattens, and what it flags for review.</div>
      </div>

      <div style={{
        borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))',
        background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}>
          <Icon name={banner.icon} size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {state === 'modified' ? (
            <>
              <Button variant="ghost" size="sm" icon="refresh">Revert</Button>
              <Button variant="primary" size="sm" icon="check">Save as project default</Button>
            </>
          ) : state === 'preset' ? (
            <Button variant="default" size="sm" icon="refresh">Reset to project default</Button>
          ) : null}
        </div>
      </div>

      {state === 'modified' ? (
        <div style={{
          borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)',
          background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Dewarp and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>20 downstream stages</span> as stale.</span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button>
        </div>
      ) : null}

      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="sparkles" size={14} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Preset</span>
        <div style={{ flex: 1, maxWidth: 320, height: 28, padding: '0 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>
            {state === 'preset' ? 'Tight binding (hardcover)' : state === 'modified' ? 'Standard mesh (modified)' : 'Standard mesh dewarp (built-in)'}
          </span>
          <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
        </div>
        <Button variant="default" size="sm" icon="plus">Save as preset…</Button>
        <span style={{ flex: 1 }} />
        <a style={{ fontSize: 11.5, color: 'var(--ink-3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Manage presets <Icon name="arrowR" size={11} /></a>
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Warp strength</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How hard the resampler flattens the fitted mesh</div>
          </div>
          <Segmented options={['Off', 'Mild', 'Standard', 'Strong']} activeIdx={strengthIdx} />
        </div>

        <SettingRow title="Mesh source" sub="What the worker fits the warp from" control="segmented">
          <Segmented options={['Text-lines', 'Page-edge', 'Both']} activeIdx={meshIdx} />
        </SettingRow>

        <SettingRow title="Min text-line score" sub="Below this the mesh fit flags as low-score">
          <SettingSlider value={minConf} min={0} max={100} unit="%" />
        </SettingRow>

        <SettingRow title="Max curvature" sub="Pages above this flag as extreme-curve">
          <SettingSlider value={maxCurve} min={0} max={30} unit="°" />
        </SettingRow>

        <SettingRow title="Skip illustration pages" sub="No-text pages auto-skip rather than flag" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Plates with no text lines pass through untouched.</div>
          <Toggle on={state !== 'modified'} />
        </SettingRow>

        <SettingRow title="Regression guard" sub="Compare input vs output flatness; flag if worse" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Catches over-warp where the fit made the page worse.</div>
          <Toggle on={true} />
        </SettingRow>

        <SettingRow title="Re-run dewarp" sub="Clears current meshes and re-runs with the settings above">
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="default" size="sm" icon="refresh">Re-dewarp all 387</Button>
            <Button variant="ghost" size="sm" icon="refresh">Re-dewarp flagged only · 22</Button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
};

Object.assign(window, {
  DewarpThumb, DwFlagChip, DwStatusDot, DewarpCard,
  DewarpBanner, DewarpToolbar, DewarpBulkBar, DewarpReviewEditor,
  DewarpPages, DewarpOverview, DewarpStepSettings,
  CurvedLines, WarpMesh, SettingSlider, SettingRow, Segmented, SegRow,
});
