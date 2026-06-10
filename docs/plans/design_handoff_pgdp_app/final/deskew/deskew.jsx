// deskew.jsx — Deskew-stage (stage 5) content components.
// DeskewPages (Pages tab — grid + flag review + inline before/after editor),
// DeskewOverview, DeskewStepSettings, plus DeskewThumb (corrected page with a
// faint rotated "before" ghost) and DkFlagChip primitives.
//
// Same scaffold as dewarp.jsx; the inline review swaps the wipe-curvature
// comparison for a rotation comparison against horizontal baseline guides
// plus an angle fine-tune dial.

const { useState: useSK, useMemo: useMK } = React;

/* ---------------------- DeskewThumb ----------------------
   Shows the corrected (square) page with straight ink lines, plus a faint
   dashed rectangle rotated by the detected skew angle — the "before" ghost.
   Flagged pages tint the ghost by the dominant flag. Illustration pages
   (skipped) render a plate block instead.
*/
const DeskewThumb = ({ row, w, h }) => {
  const dom = row.flags ? row.flags[0] : null;
  const ghostColor = dom && DESKEW_FLAGS[dom] ? DESKEW_FLAGS[dom].tone : 'var(--ocr)';
  const skew = row.skewDeg || 0;
  const paper = 'oklch(0.94 0.012 85)';
  const ink = 'oklch(0.34 0.02 60)';

  return (
    <div style={{
      width: w, height: h, position: 'relative',
      background: 'oklch(0.18 0.012 60)',
      border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, oklch(0.30 0.015 60) 35%, oklch(0.14 0.012 60) 100%)',
      }} />

      {/* faint rotated "before" ghost outline */}
      {!row.illust && Math.abs(skew) > 0.3 ? (
        <div style={{
          position: 'absolute', inset: '8% 10%',
          border: `1.5px dashed ${ghostColor}`, borderRadius: 1,
          opacity: row.state === 'clean' ? 0.22 : 0.5,
          transform: `rotate(${skew}deg)`, transformOrigin: 'center',
        }} />
      ) : null}

      {/* corrected (square) page */}
      <div style={{
        position: 'absolute', inset: '8% 10%',
        background: paper, borderRadius: 1, overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(40,30,20,0.15), 0 1px 4px rgba(0,0,0,0.45)',
      }}>
        {row.illust ? (
          <div style={{ position: 'absolute', inset: '14%', display: 'flex', flexDirection: 'column', gap: '8%' }}>
            <div style={{ flex: 1, background: 'oklch(0.62 0.04 60)', opacity: 0.35, borderRadius: 2, position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 6, border: `1px dashed ${ink}`, opacity: 0.4 }} />
            </div>
            <div style={{ height: 3, width: '50%', background: ink, opacity: 0.4, alignSelf: 'center' }} />
          </div>
        ) : (
          <>
            <div style={{
              position: 'absolute', inset: '13% 16%',
              backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.2px, transparent 1.2px 6px)`,
              opacity: 0.62,
            }} />
            <div style={{ position: 'absolute', left: '42%', right: '42%', bottom: '7%', height: 2, background: ink, opacity: 0.5 }} />
          </>
        )}
      </div>

      {/* corner crop-mark to signal a true rectangle */}
      {!row.illust ? (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {[[0.10, 0.08], [0.90, 0.08], [0.10, 0.92], [0.90, 0.92]].map(([cx, cy], i) => {
            const x = cx * w, y = cy * h, s = Math.min(w, h) * 0.06;
            const hx = cx < 0.5 ? s : -s, vy = cy < 0.5 ? s : -s;
            return (
              <path key={i} d={`M ${x + hx} ${y} L ${x} ${y} L ${x} ${y + vy}`} fill="none"
                stroke="var(--exact)" strokeWidth={1} opacity={row.state === 'clean' ? 0.55 : 0.3} />
            );
          })}
        </svg>
      ) : null}
    </div>
  );
};

/* ---------------------- Flag chip / status dot ---------------------- */
const DkFlagChip = ({ kind, size = 'sm' }) => {
  const f = DESKEW_FLAGS[kind]; if (!f) return null;
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

const DkStatusDot = ({ state, size = 8 }) => {
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

/* ---------------------- DeskewCard (grid cell) ---------------------- */
const DESKEW_DENSITY = {
  S: { col: 9, w: 96,  h: 122, fs: 10,   flagMax: 1, flagSize: 'sm' },
  M: { col: 6, w: 140, h: 178, fs: 11,   flagMax: 2, flagSize: 'sm' },
  L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' },
};

const DeskewCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = DESKEW_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).slice(0, cfg.flagMax);
  const extra = (row.flags || []).length - flags.length;
  const fmtAngle = (d) => `${d > 0 ? '+' : ''}${d.toFixed(1)}°`;
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
          <DeskewThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />
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
            <DkStatusDot state={row.state} size={6} />
            {row.pageNumber}
          </div>
        ) : null}

        {!isRunning && row.skewDeg != null && !row.illust && density !== 'S' ? (
          <div className="mono" style={{
            position: 'absolute', bottom: 6, right: 6, height: 16, padding: '0 5px', borderRadius: 3,
            background: 'rgba(12,12,16,0.72)', color: 'rgba(240,240,242,0.85)',
            fontSize: 9.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>{fmtAngle(row.skewDeg)}</div>
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
            {flags.map(k => <DkFlagChip key={k} kind={k} size={cfg.flagSize} />)}
            {extra > 0 ? (
              <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(12,12,16,0.85)', color: '#f0f0f2' }}>+{extra}</span>
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
            {row.state === 'clean' ? 'square' :
             row.state === 'flagged' ? `${row.flags.length} flag${row.flags.length>1?'s':''}` :
             row.state === 'reviewed' ? 'ok·rv' :
             row.state === 'skipped' ? 'skipped' : row.state}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- DeskewBanner (3-state) ---------------------- */
const DeskewBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{
        borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))',
        background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))',
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
            Measuring skew angles…
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
      background: 'color-mix(in oklab, ' + tone + ' 7%, var(--bg-surface))', display: 'flex', alignItems: 'stretch', overflow: 'hidden',
    }}>
      <div style={{ width: 4, background: tone }} />
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))', color: tone, display: 'grid', placeItems: 'center' }}>
            <Icon name={flagged > 0 ? 'alert' : 'checkCircle'} size={15} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
              {totals.done} pages deskewed
              {flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed · {totals.skipped} skipped</>
                          : <> · all square</>}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
              {flagged > 0
                ? 'Click any flagged page to compare against the baseline guides; fine-tune the angle or bulk re-deskew.'
                : 'Every page rotated to a true rectangle. Confirm to advance.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['square',   totals.clean,    'var(--exact)'],
                ['flagged',  totals.flagged,  'var(--fuzzy)'],
                ['reviewed', totals.reviewed, 'var(--ocr)'],
                ['skipped',  totals.skipped,  'var(--ink-4)'],
              ].filter(([_, n]) => n > 0).map(([k, n, color]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />
                  {k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        {stale ? (
          <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={12} />Settings changed — 19 downstream stages now stale
          </div>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Toolbar ---------------------- */
const DeskewToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [
    { id: 'all',      name: 'All',      count: totals.total },
    { id: 'flagged',  name: 'Flagged',  count: totals.flagged, dot: 'var(--fuzzy)' },
    { id: 'clean',    name: 'Square',   count: totals.clean,   dot: 'var(--exact)' },
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
              {f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span>
            </div>
          );
        })}
      </div>

      <Divider vertical style={{ height: 22 }} />

      {filter === 'flagged' ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(DESKEW_FLAG_COUNTS).slice(0, 4).map(([k, n]) => {
            const f = DESKEW_FLAGS[k];
            return (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 99, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)', fontSize: 11, cursor: 'pointer' }}>
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
        <Button variant="default" size="sm" icon="refresh">Re-deskew with new method</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
          Density
          <div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
            {['S', 'M', 'L'].map(d => {
              const a = density === d;
              return (
                <div key={d} style={{ padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)' }}>{d}</div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Bulk bar ---------------------- */
const DeskewBulkBar = ({ count, flagSummary }) => (
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
      { id: 'auto',   name: 'Re-deskew · auto',     icon: 'refresh' },
      { id: 'hough',  name: 'Re-deskew · Hough',    icon: 'refresh' },
      { id: 'skip',   name: 'Leave as-is',          icon: 'x' },
      { id: 'accept', name: 'Accept as-is',         icon: 'check' },
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

/* ---------------------- Settings primitives (local) ---------------------- */
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

const SettingRow = ({ title, sub, children, control }) => (
  <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'center', borderTop: '1px solid var(--border-1)' }}>
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div>
      <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div>
    </div>
    {children}
  </div>
);

/* ---------------------- DeskewReviewEditor ----------------------
   Before/after rotation comparison against horizontal baseline guides, with
   an angle fine-tune dial below. BEFORE = page rotated by the detected skew
   over the guides (obviously off); AFTER = page squared to the guides.
*/
const DeskewPage = ({ pw, ph, rotate = 0, ink = 'oklch(0.34 0.02 60)' }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
    <div style={{
      width: pw * 0.82, height: ph * 0.86, background: 'oklch(0.94 0.012 85)', borderRadius: 2,
      boxShadow: '0 0 0 1px rgba(40,30,20,0.15), 0 4px 14px rgba(0,0,0,0.30)',
      transform: `rotate(${rotate}deg)`, transformOrigin: 'center', position: 'relative',
    }}>
      <div style={{ position: 'absolute', inset: '12% 14%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.6px, transparent 1.6px 8px)`, opacity: 0.6 }} />
      <div style={{ position: 'absolute', left: '42%', right: '42%', bottom: '6%', height: 2, background: ink, opacity: 0.5 }} />
    </div>
  </div>
);

const GuideLines = ({ pw, ph }) => (
  <svg width={pw} height={ph} viewBox={`0 0 ${pw} ${ph}`} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {[0.25, 0.5, 0.75].map((f, i) => (
      <line key={i} x1={0} y1={ph * f} x2={pw} y2={ph * f} stroke="var(--accent)" strokeWidth={0.8} strokeDasharray="4 4" opacity={0.45} />
    ))}
  </svg>
);

const DeskewReviewEditor = ({ row, wipe = 0.55 }) => {
  const pw = 300, ph = 424;
  const skew = row.skewDeg || 0;
  return (
    <div style={{
      marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)',
      background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden', animation: 'pgd-slide-up .18s ease-out',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))' }}>
        <Icon name="swap" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Align · {row.prefix}.jp2</span>
        {(row.flags || []).map(k => <DkFlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          detected {skew > 0 ? '+' : ''}{skew.toFixed(1)}° · residual {row.residual}° · score {Math.round((row.conf || 0) * 100)}%
        </span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Icon name="x" size={13} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* wipe comparison */}
        <div style={{ padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)', position: 'relative', minHeight: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ position: 'relative', width: pw, height: ph, borderRadius: 4, overflow: 'hidden', background: 'oklch(0.20 0.012 60)', boxShadow: '0 4px 16px rgba(0,0,0,0.35)' }}>
            {/* AFTER — square */}
            <DeskewPage pw={pw} ph={ph} rotate={0} />
            {/* BEFORE — rotated, clipped to wipe */}
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }}>
              <DeskewPage pw={pw} ph={ph} rotate={skew} />
            </div>
            {/* baseline guides over everything */}
            <GuideLines pw={pw} ph={ph} />
            <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>BEFORE · {skew > 0 ? '+' : ''}{skew.toFixed(1)}°</span>
            <span style={{ position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 4, background: 'color-mix(in oklab, var(--ocr) 90%, black)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>AFTER · 0.0°</span>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe * 100}%`, width: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }}>
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 26, height: 26, borderRadius: 99, background: '#fff', border: '1px solid var(--border-2)', display: 'grid', placeItems: 'center', cursor: 'col-resize', color: 'var(--ink-3)' }}>
                <Icon name="swap" size={12} />
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-3)', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 0, borderTop: '0.8px dashed var(--accent)' }} />baseline guides
            </span>
            <span className="mono">drag the handle to wipe</span>
          </div>
        </div>

        {/* controls */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* angle fine-tune */}
          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Correction angle</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-2)', cursor: 'pointer', display: 'grid', placeItems: 'center', fontFamily: 'inherit' }}>−</button>
              <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'var(--border-3)' }} />
                <div style={{ position: 'absolute', left: `calc(${50 + (-skew / 10) * 50}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: 99, background: 'var(--bg-surface)', border: '2px solid var(--accent)' }} />
              </div>
              <button style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-2)', cursor: 'pointer', display: 'grid', placeItems: 'center', fontFamily: 'inherit' }}>+</button>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', minWidth: 52, textAlign: 'right' }}>{(-skew).toFixed(1)}°</span>
            </div>
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>−10°</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>+10°</span>
            </div>
          </div>

          <SegRowK label="Detection method" options={['Text-baseline', 'Hough', 'Projection']} activeIdx={0} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', cursor: 'pointer' }}>
            <Toggle on={true} />
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-1)' }}>Snap to nearest right angle</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>±0.3°</span>
          </label>

          <Divider />

          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Apply to</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'this', name: 'This page only', count: 1, active: true },
                { id: 'selected', name: 'Selected pages', count: 3 },
                { id: 'same', name: 'All flagged with same issue', count: (row.flags && DESKEW_FLAG_COUNTS[row.flags[0]]) || 5 },
              ].map(opt => (
                <label key={opt.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  background: opt.active ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)',
                  border: '1px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-1)'),
                }}>
                  <span style={{ width: 14, height: 14, borderRadius: 99, flex: '0 0 auto', background: opt.active ? 'var(--accent)' : 'transparent', border: '1.5px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-2)'), display: 'grid', placeItems: 'center' }}>
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
            <Button variant="default" size="sm" icon="x">Leave as-is</Button>
            <Button variant="default" size="sm" icon="check">Accept as-is</Button>
            <Button variant="primary" size="sm" icon="swap">Apply rotation</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SegRowK = ({ label, options, activeIdx }) => (
  <div>
    <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 7 }}>{label}</div>
    <Segmented options={options} activeIdx={activeIdx} />
  </div>
);

/* ---------------------- DeskewPages (Pages tab body) ---------------------- */
const DeskewPages = ({ state = 'review', density = 'M', filter = 'all', selected = [], editing = null, stale = false }) => {
  const totals = state === 'running' ? DESKEW_TOTALS_RUNNING : state === 'done' ? DESKEW_TOTALS_DONE : DESKEW_TOTALS_REVIEW;
  const rows = state === 'running'
    ? DESKEW_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined, skewDeg: undefined })
    : DESKEW_ROWS;

  const filtered =
    filter === 'flagged'  ? rows.filter(r => r.state === 'flagged') :
    filter === 'clean'    ? rows.filter(r => r.state === 'clean') :
    filter === 'skipped'  ? rows.filter(r => r.state === 'skipped') :
    filter === 'reviewed' ? rows.filter(r => r.state === 'reviewed') :
    filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) : rows;

  const editingRow = editing != null ? DESKEW_ROWS.find(r => r.idx === editing) : null;
  const hasSelection = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <DeskewBanner state={state} totals={totals} stale={stale} />
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

      <DeskewToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${DESKEW_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => (
          <DeskewCard key={r.idx} row={r} density={density}
            selected={selected.includes(r.idx)}
            hovered={i === 2 && state !== 'running' && !hasSelection && editing == null}
            expanded={editing === r.idx} />
        ))}
      </div>

      {editingRow ? <DeskewReviewEditor row={editingRow} /> : null}

      {hasSelection ? <DeskewBulkBar count={selected.length} flagSummary="2 extreme-skew · 1 residual" /> : null}
    </div>
  );
};

/* ---------------------- DeskewOverview ---------------------- */
const DeskewOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? DESKEW_TOTALS_RUNNING : state === 'done' ? DESKEW_TOTALS_DONE : DESKEW_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DeskewBanner state={state} totals={totals} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { label: 'pages',     value: totals.total, tone: 'ink-1' },
          { label: 'deskewed',  value: `${totals.done}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' },
          { label: 'square',    value: totals.clean, tone: 'exact' },
          { label: 'flagged',   value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' },
          { label: 'skipped',   value: totals.skipped, tone: 'ink-2', sub: 'no baseline' },
          { label: 'avg angle', value: totals.avgAngle, tone: 'ink-1', sub: 'before correction' },
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
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Issues found across {totals.done} deskewed pages</div>
          </div>
          <Button variant="ghost" size="sm" icon="eye">Open Pages</Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(DESKEW_FLAG_COUNTS).map(([k, n]) => {
            const f = DESKEW_FLAGS[k];
            const max = Math.max(...Object.values(DESKEW_FLAG_COUNTS));
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 40px', gap: 12, alignItems: 'center' }}>
                <DkFlagChip kind={k} size="md" />
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
          ['4 min ago',  'Auto-deskew run completed',  '387 pages · 19 flagged · 9 skipped'],
          ['4 min ago',  'Stage started',              'method: text-baseline · snap on'],
          ['7 min ago',  'Settings changed',           'max correction: 6° → 8°'],
          ['10 min ago', 'Dewarp stage confirmed',     '387 pages forwarded'],
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

/* ---------------------- DeskewStepSettings (preset-aware) ---------------------- */
const DeskewStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 2 changes vs project default', sub: 'Save these as the project default, or revert to inherit.',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Loose-leaf scans', sub: 'Loaded from a saved preset; not the project default.',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · Text-baseline deskew', sub: 'Changes here can be saved back as the project default for Deskew.',
  };
  const methodIdx = state === 'preset' ? 1 : state === 'modified' ? 2 : 0;
  const maxAngle = state === 'modified' ? 12 : state === 'preset' ? 10 : 8;
  const minConf = state === 'modified' ? 55 : 60;
  const snap = state === 'preset' ? 0.5 : 0.3;

  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Deskew</h2>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>How the worker measures rotation, how far it will correct, and what it flags for review.</div>
      </div>

      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
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
        <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Deskew and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>19 downstream stages</span> as stale.</span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button>
        </div>
      ) : null}

      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="sparkles" size={14} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Preset</span>
        <div style={{ flex: 1, maxWidth: 320, height: 28, padding: '0 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>
            {state === 'preset' ? 'Loose-leaf scans' : state === 'modified' ? 'Text-baseline (modified)' : 'Text-baseline deskew (built-in)'}
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
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Angle detection</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How the worker measures the rotation</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'baseline', name: 'Text-baseline', sub: 'fit to detected line bottoms' },
              { id: 'hough',    name: 'Hough lines',   sub: 'dominant line angle' },
              { id: 'proj',     name: 'Projection profile', sub: 'variance peak vs angle' },
            ].map((opt, i) => {
              const a = i === methodIdx;
              return (
                <div key={opt.id} style={{ minWidth: 150, flex: 1, padding: '8px 12px', borderRadius: 7, background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (a ? 'var(--accent)' : 'var(--border-1)'), cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{opt.name}</div>
                  <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)' }}>{opt.sub}</div>
                </div>
              );
            })}
          </div>
        </div>

        <SettingRow title="Max correction angle" sub="Pages needing more rotation than this flag as extreme-skew">
          <SettingSlider value={maxAngle} min={0} max={15} unit="°" />
        </SettingRow>

        <SettingRow title="Min baseline score" sub="Below this the angle estimate flags as low-score">
          <SettingSlider value={minConf} min={0} max={100} unit="%" />
        </SettingRow>

        <SettingRow title="Snap to right angle" sub="Angles within this of 0° snap to exactly square">
          <SettingSlider value={snap} min={0} max={2} unit="°" pct={snap / 2} />
        </SettingRow>

        <SettingRow title="Skip illustration pages" sub="Pages with no text baselines pass through unrotated" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Full-page plates can't be measured from baselines.</div>
          <Toggle on={state !== 'modified'} />
        </SettingRow>

        <SettingRow title="Residual guard" sub="Flag pages still off by > 0.5° after correction" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Catches multi-angle pages a single rotation can't fix.</div>
          <Toggle on={true} />
        </SettingRow>

        <SettingRow title="Re-run deskew" sub="Clears current rotations and re-runs with the settings above">
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="default" size="sm" icon="refresh">Re-deskew all 387</Button>
            <Button variant="ghost" size="sm" icon="refresh">Re-deskew flagged only · 19</Button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
};

Object.assign(window, {
  DeskewThumb, DkFlagChip, DkStatusDot, DeskewCard,
  DeskewBanner, DeskewToolbar, DeskewBulkBar, DeskewReviewEditor,
  DeskewPages, DeskewOverview, DeskewStepSettings,
});
