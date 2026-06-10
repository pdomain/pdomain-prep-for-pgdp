// threshold.jsx — Threshold-stage (stage 6, Image group) content components.
// ThresholdPages (Pages tab — grid + flag review + inline before/after
// editor with a histogram), ThresholdOverview, ThresholdStepSettings, plus
// BilevelThumb (pure black/white output with flag-specific artifacts) and
// ThFlagChip primitives. Same scaffold as dewarp.jsx / deskew.jsx.

const { useState: useST, useMemo: useMT } = React;

/* ---------------------- BilevelThumb ----------------------
   The binarized (black/white) output. Clean pages are crisp black text on
   white. Flagged pages carry the flag's artifact: speckle (pepper dots),
   bleed-through (faint ghost lines), ink-bleed (thick blobby lines),
   broken-text (dashed faint lines), low-contrast (weak gray text),
   uneven-light (a darkened margin gradient).
*/
const BilevelThumb = ({ row, w, h }) => {
  const flags = row.flags || [];
  const has = (k) => flags.includes(k);
  // ink darkness + weight react to flags
  const ink = has('lowContrast') ? 'oklch(0.55 0 0)' : 'oklch(0.16 0 0)';
  const lineH = has('inkBleed') ? 2.4 : has('brokenText') ? 1.0 : 1.6;
  const lineGap = has('inkBleed') ? 5 : 6;
  const lineImg = has('brokenText')
    ? `repeating-linear-gradient(to right, ${ink} 0 6px, transparent 6px 10px)`
    : null;

  // deterministic speckle positions
  const speckles = has('speckle') ? Array.from({ length: 26 }, (_, i) => ({
    x: (i * 37) % 92 + 4, y: (i * 53) % 88 + 6, s: (i % 3) + 1,
  })) : [];

  return (
    <div style={{
      width: w, height: h, position: 'relative',
      background: '#fff', border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden',
    }}>
      {row.illust ? null : (
        <>
          {/* uneven-light gradient margin */}
          {has('unevenLight') ? (
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(105deg, rgba(0,0,0,0.20) 0%, transparent 28%)' }} />
          ) : null}

          {/* bleed-through ghost lines (offset, faint) */}
          {has('bleedThrough') ? (
            <div style={{
              position: 'absolute', inset: '15% 17% 15% 15%',
              backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.78 0 0) 0 1.2px, transparent 1.2px 6px)',
              opacity: 0.7, transform: 'translateX(2px)',
            }} />
          ) : null}

          {/* main text lines */}
          <div style={{
            position: 'absolute', inset: '13% 16%',
            backgroundImage: lineImg || `repeating-linear-gradient(to bottom, ${ink} 0 ${lineH}px, transparent ${lineH}px ${lineGap}px)`,
            opacity: has('lowContrast') ? 0.6 : 0.92,
          }} />

          {/* heading bar */}
          <div style={{ position: 'absolute', top: '8%', left: '20%', right: '34%', height: lineH + 1.5, background: ink, opacity: has('lowContrast') ? 0.55 : 0.92 }} />

          {/* speckle / pepper noise */}
          {speckles.map((sp, i) => (
            <span key={i} style={{ position: 'absolute', left: `${sp.x}%`, top: `${sp.y}%`, width: sp.s, height: sp.s, borderRadius: 99, background: '#111' }} />
          ))}

          {/* page-number stripe */}
          <div style={{ position: 'absolute', left: '42%', right: '42%', bottom: '7%', height: lineH, background: ink, opacity: 0.85 }} />
        </>
      )}

      {row.illust ? (
        <div style={{ position: 'absolute', inset: '14%', display: 'flex', flexDirection: 'column', gap: '8%' }}>
          <div style={{ flex: 1, background: '#111', opacity: 0.12, borderRadius: 2, position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 6, border: '1px solid #111', opacity: 0.3 }} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ---------------------- Flag chip / status dot ---------------------- */
const ThFlagChip = ({ kind, size = 'sm' }) => {
  const f = THRESH_FLAGS[kind]; if (!f) return null;
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

const ThStatusDot = ({ state, size = 8 }) => {
  const tone =
    state === 'clean'    ? 'var(--exact)' :
    state === 'flagged'  ? 'var(--fuzzy)' :
    state === 'reviewed' ? 'var(--ocr)'   :
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

/* ---------------------- Method pill ---------------------- */
const MethodPill = ({ method }) => {
  const label = method === 'otsu' ? 'otsu' : method === 'sauvola' ? 'sauvola' : 'adaptive';
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 5px', borderRadius: 3,
      background: 'var(--bg-raised)', border: '1px solid var(--border-1)', color: 'var(--ink-3)',
      fontSize: 9.5, fontWeight: 600, letterSpacing: '.02em',
    }}>{label}</span>
  );
};

/* ---------------------- ThresholdCard (grid cell) ---------------------- */
const THRESH_DENSITY = {
  S: { col: 9, w: 96,  h: 122, fs: 10,   flagMax: 1, flagSize: 'sm' },
  M: { col: 6, w: 140, h: 178, fs: 11,   flagMax: 2, flagSize: 'sm' },
  L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' },
};

const ThresholdCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = THRESH_DENSITY[density];
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
          <BilevelThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />
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
            <ThStatusDot state={row.state} size={6} />
            {row.pageNumber}
          </div>
        ) : null}

        {!isRunning && row.blackPct != null && density !== 'S' ? (
          <div className="mono" style={{
            position: 'absolute', bottom: 6, right: 6, height: 16, padding: '0 5px', borderRadius: 3,
            background: 'rgba(12,12,16,0.72)', color: 'rgba(240,240,242,0.85)', fontSize: 9.5, fontWeight: 600,
          }}>{Math.round(row.blackPct * 100)}% blk</div>
        ) : null}

        {flags.length > 0 ? (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {flags.map(k => <ThFlagChip key={k} kind={k} size={cfg.flagSize} />)}
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
          row.method ? <MethodPill method={row.method} /> : null
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Histogram ----------------------
   A simple grayscale histogram with the chosen threshold marked. Bilevel
   binarizers cut everything left of the marker to black, right to white.
*/
const Histogram = ({ thresh = 140, w = 300, h = 70, bins = 48 }) => {
  // synthesised bimodal distribution (ink peak dark, paper peak light)
  const data = Array.from({ length: bins }, (_, i) => {
    const v = i / (bins - 1);
    const ink = Math.exp(-Math.pow((v - 0.22) / 0.10, 2));
    const paper = Math.exp(-Math.pow((v - 0.82) / 0.08, 2)) * 1.5;
    return ink * 0.7 + paper + 0.04;
  });
  const max = Math.max(...data);
  const markX = (thresh / 255) * w;
  return (
    <div style={{ position: 'relative', width: w, height: h }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
        {data.map((d, i) => {
          const left = (i / bins) * 255 < thresh;
          return (
            <div key={i} style={{
              flex: 1, height: `${(d / max) * 100}%`,
              background: left ? 'oklch(0.40 0 0)' : 'oklch(0.78 0 0)', borderRadius: '1px 1px 0 0',
            }} />
          );
        })}
      </div>
      {/* threshold marker */}
      <div style={{ position: 'absolute', top: -4, bottom: 0, left: markX, width: 2, background: 'var(--accent)' }}>
        <span style={{
          position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)',
          padding: '0 5px', height: 14, borderRadius: 3, background: 'var(--accent)', color: 'var(--accent-ink)',
          fontFamily: 'var(--mono-font)', fontSize: 9.5, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center',
        }}>{thresh}</span>
      </div>
    </div>
  );
};

/* ---------------------- Banner (3-state) ---------------------- */
const ThresholdBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{
        borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))',
        background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
            Binarizing pages…
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
    <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, ' + tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + tone + ' 7%, var(--bg-surface))', display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
      <div style={{ width: 4, background: tone }} />
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))', color: tone, display: 'grid', placeItems: 'center' }}>
            <Icon name={flagged > 0 ? 'alert' : 'checkCircle'} size={15} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
              {totals.done} pages binarized
              {flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed</>
                          : <> · all clean</>}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
              {flagged > 0
                ? 'Click any flagged page to compare grayscale against bilevel; tune the threshold or bulk re-run with a different method.'
                : 'Every page converted to clean black/white. Confirm to advance to Dewarp.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['clean',    totals.clean,    'var(--exact)'],
                ['flagged',  totals.flagged,  'var(--fuzzy)'],
                ['reviewed', totals.reviewed, 'var(--ocr)'],
                ['errors',   totals.errors,   'var(--mismatch)'],
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
            <Icon name="alert" size={12} />Settings changed — 21 downstream stages now stale
          </div>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Toolbar ---------------------- */
const ThresholdToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [
    { id: 'all',      name: 'All',      count: totals.total },
    { id: 'flagged',  name: 'Flagged',  count: totals.flagged, dot: 'var(--fuzzy)' },
    { id: 'clean',    name: 'Clean',    count: totals.clean,   dot: 'var(--exact)' },
    { id: 'reviewed', name: 'Reviewed', count: totals.reviewed, dot: 'var(--ocr)' },
    { id: 'errors',   name: 'Errors',   count: totals.errors,  dot: 'var(--mismatch)' },
    ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : []),
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>
        {chips.map(f => {
          const active = filter === f.id;
          return (
            <div key={f.id} style={{
              padding: '5px 10px', borderRadius: 6, background: active ? 'var(--bg-surface)' : 'transparent',
              boxShadow: active ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 7, color: active ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: 'pointer',
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
          {Object.entries(THRESH_FLAG_COUNTS).slice(0, 4).map(([k, n]) => {
            const f = THRESH_FLAGS[k];
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
        <Button variant="default" size="sm" icon="refresh">Re-binarize with new method</Button>
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
const ThresholdBulkBar = ({ count, flagSummary }) => (
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
      { id: 'sauvola', name: 'Re-run · Sauvola',  icon: 'refresh' },
      { id: 'adaptive', name: 'Re-run · Adaptive', icon: 'refresh' },
      { id: 'despeckle', name: 'Despeckle',        icon: 'sparkles' },
      { id: 'accept',  name: 'Accept as-is',       icon: 'check' },
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
  <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7, flexWrap: 'wrap' }}>
    {options.map((o, i) => {
      const a = i === activeIdx;
      return (
        <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>
      );
    })}
  </div>
);

const SettingRow = ({ title, sub, children, control, dim }) => (
  <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'center', borderTop: '1px solid var(--border-1)', opacity: dim ? 0.5 : 1 }}>
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div>
      <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div>
    </div>
    {children}
  </div>
);

/* ---------------------- ThresholdReviewEditor ----------------------
   Before/after wipe (grayscale input → bilevel output) plus a live
   histogram with a draggable threshold marker. Controls: method, threshold,
   window size + k-factor (Sauvola), apply-to scope.
*/
const GrayPanel = ({ pw, ph }) => (
  <div style={{ position: 'absolute', inset: 0, background: 'oklch(0.86 0 0)' }}>
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at top, oklch(0.90 0 0) 0%, transparent 55%), radial-gradient(ellipse at bottom right, oklch(0.74 0 0) 0%, transparent 60%)' }} />
    <div style={{ position: 'absolute', inset: '12% 14%', backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.42 0 0) 0 1.6px, transparent 1.6px 8px)', opacity: 0.55 }} />
    <div style={{ position: 'absolute', left: '42%', right: '42%', bottom: '6%', height: 2, background: 'oklch(0.42 0 0)', opacity: 0.5 }} />
  </div>
);
const BilevelPanel = ({ pw, ph }) => (
  <div style={{ position: 'absolute', inset: 0, background: '#fff' }}>
    <div style={{ position: 'absolute', inset: '12% 14%', backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.16 0 0) 0 1.8px, transparent 1.8px 8px)', opacity: 0.92 }} />
    <div style={{ position: 'absolute', top: '8%', left: '20%', right: '34%', height: 3, background: 'oklch(0.16 0 0)' }} />
    <div style={{ position: 'absolute', left: '42%', right: '42%', bottom: '6%', height: 2, background: 'oklch(0.16 0 0)' }} />
  </div>
);

const ThresholdReviewEditor = ({ row, wipe = 0.55 }) => {
  const pw = 300, ph = 424;
  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)', background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden', animation: 'pgd-slide-up .18s ease-out' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))' }}>
        <Icon name="image" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Threshold · {row.prefix}.tif</span>
        {(row.flags || []).map(k => <ThFlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {row.method} · t={row.thresh} · {Math.round(row.blackPct * 100)}% black · contrast {Math.round((row.contrast || 0) * 100)}%
        </span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Icon name="x" size={13} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* wipe + histogram */}
        <div style={{ padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)', position: 'relative', minHeight: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ position: 'relative', width: pw, height: ph, borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.35)' }}>
            <BilevelPanel pw={pw} ph={ph} />
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }}>
              <GrayPanel pw={pw} ph={ph} />
            </div>
            <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>BEFORE · grayscale</span>
            <span style={{ position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 4, background: 'color-mix(in oklab, var(--ocr) 90%, black)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>AFTER · bilevel</span>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe * 100}%`, width: 2, background: 'var(--accent)', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }}>
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 26, height: 26, borderRadius: 99, background: '#fff', border: '1px solid var(--border-2)', display: 'grid', placeItems: 'center', cursor: 'col-resize', color: 'var(--ink-3)' }}>
                <Icon name="swap" size={12} />
              </span>
            </div>
          </div>
          {/* histogram */}
          <div style={{ width: pw, padding: '10px 0 0' }}>
            <div className="label" style={{ color: 'var(--ink-4)', marginBottom: 16 }}>Grayscale histogram · cut at threshold</div>
            <Histogram thresh={row.thresh} w={pw} h={62} />
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>0 · black</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>255 · white</span>
            </div>
          </div>
        </div>

        {/* controls */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 7 }}>Method</div>
            <Segmented options={['Otsu', 'Sauvola', 'Adaptive']} activeIdx={row.method === 'otsu' ? 0 : row.method === 'sauvola' ? 1 : 2} />
          </div>

          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Threshold</div>
            <SettingSlider value={row.thresh} min={0} max={255} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>Window</div>
              <div className="mono" style={{ height: 28, borderRadius: 6, background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>31 px</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>k-factor</div>
              <div className="mono" style={{ height: 28, borderRadius: 6, background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>0.34</div>
            </div>
          </div>

          <Divider />

          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Apply to</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'this', name: 'This page only', count: 1, active: true },
                { id: 'selected', name: 'Selected pages', count: 3 },
                { id: 'same', name: 'All flagged with same issue', count: (row.flags && THRESH_FLAG_COUNTS[row.flags[0]]) || 6 },
              ].map(opt => (
                <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', background: opt.active ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-1)') }}>
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
            <Button variant="default" size="sm" icon="check">Accept as-is</Button>
            <Button variant="primary" size="sm" icon="refresh">Re-binarize</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- ThresholdPages (Pages tab body) ---------------------- */
const ThresholdPages = ({ state = 'review', density = 'M', filter = 'all', selected = [], editing = null, stale = false }) => {
  const totals = state === 'running' ? THRESH_TOTALS_RUNNING : state === 'done' ? THRESH_TOTALS_DONE : THRESH_TOTALS_REVIEW;
  const rows = state === 'running'
    ? THRESH_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined, blackPct: undefined, method: undefined })
    : THRESH_ROWS;

  const filtered =
    filter === 'flagged'  ? rows.filter(r => r.state === 'flagged') :
    filter === 'clean'    ? rows.filter(r => r.state === 'clean') :
    filter === 'reviewed' ? rows.filter(r => r.state === 'reviewed') :
    filter === 'errors'   ? rows.filter(r => r.state === 'failed') :
    filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) : rows;

  const editingRow = editing != null ? THRESH_ROWS.find(r => r.idx === editing) : null;
  const hasSelection = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ThresholdBanner state={state} totals={totals} stale={stale} />
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

      <ThresholdToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${THRESH_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => (
          <ThresholdCard key={r.idx} row={r} density={density}
            selected={selected.includes(r.idx)}
            hovered={i === 2 && state !== 'running' && !hasSelection && editing == null}
            expanded={editing === r.idx} />
        ))}
      </div>

      {editingRow ? <ThresholdReviewEditor row={editingRow} /> : null}

      {hasSelection ? <ThresholdBulkBar count={selected.length} flagSummary="2 speckle · 1 bleed-through" /> : null}
    </div>
  );
};

/* ---------------------- ThresholdOverview ---------------------- */
const ThresholdOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? THRESH_TOTALS_RUNNING : state === 'done' ? THRESH_TOTALS_DONE : THRESH_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ThresholdBanner state={state} totals={totals} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { label: 'pages',     value: totals.total, tone: 'ink-1' },
          { label: 'binarized', value: `${totals.done}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' },
          { label: 'clean',     value: totals.clean, tone: 'exact' },
          { label: 'flagged',   value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' },
          { label: 'reviewed',  value: totals.reviewed, tone: 'ocr' },
          { label: 'avg black', value: totals.avgBlack, tone: 'ink-1', sub: 'ink coverage' },
        ].map((stat, i) => (
          <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}>
            <div className="label" style={{ color: 'var(--ink-3)' }}>{stat.label}</div>
            <div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${stat.tone})`, letterSpacing: '-0.01em' }}>{stat.value}</div>
            {stat.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{stat.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* method mix + flag distribution side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Method mix</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { m: 'Sauvola',  n: 281, sub: 'adaptive · default', tone: 'var(--accent)' },
              { m: 'Otsu',     n: 78,  sub: 'global', tone: 'var(--ocr)' },
              { m: 'Adaptive', n: 28,  sub: 'gaussian window', tone: 'var(--gt)' },
            ].map(row => (
              <div key={row.m} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 36px', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>{row.m}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{row.sub}</div>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ width: `${(row.n / 387) * 100}%`, height: '100%', background: row.tone, opacity: 0.85 }} />
                </div>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{row.n}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Flag distribution</div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Issues found across {totals.done} pages</div>
            </div>
            <Button variant="ghost" size="sm" icon="eye">Open Pages</Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(THRESH_FLAG_COUNTS).map(([k, n]) => {
              const f = THRESH_FLAGS[k];
              const max = Math.max(...Object.values(THRESH_FLAG_COUNTS));
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 36px', gap: 10, alignItems: 'center' }}>
                  <ThFlagChip kind={k} size="md" />
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} />
                  </div>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div>
        </div>
        {[
          ['3 min ago',  'Binarize run completed',   '387 pages · 26 flagged'],
          ['3 min ago',  'Stage started',            'method: sauvola · window 31 · k 0.34'],
          ['6 min ago',  'Settings changed',         'despeckle: off → on'],
          ['9 min ago',  'Crop stage confirmed',     '387 pages forwarded'],
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

/* ---------------------- ThresholdStepSettings (preset-aware) ---------------------- */
const ThresholdStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 3 changes vs project default', sub: 'Save these as the project default, or revert to inherit.',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Faded newsprint', sub: 'Loaded from a saved preset; not the project default.',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · Sauvola adaptive', sub: 'Changes here can be saved back as the project default for Threshold.',
  };
  const methodIdx = state === 'preset' ? 2 : state === 'modified' ? 0 : 1;
  const isAdaptive = methodIdx !== 0; // Otsu is global → window/k disabled
  const windowPx = state === 'preset' ? 41 : 31;
  const kFactor = state === 'modified' ? 0.28 : 0.34;
  const minContrast = state === 'modified' ? 30 : 40;

  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Threshold</h2>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>Which binarizer runs, how it picks the cut, and what it flags for review.</div>
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
          <span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Threshold and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>21 downstream stages</span> as stale.</span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button>
        </div>
      ) : null}

      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="sparkles" size={14} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Preset</span>
        <div style={{ flex: 1, maxWidth: 320, height: 28, padding: '0 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>
            {state === 'preset' ? 'Faded newsprint' : state === 'modified' ? 'Sauvola (modified)' : 'Sauvola adaptive (built-in)'}
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
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Binarizer</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How the worker decides black vs white</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'otsu',     name: 'Otsu',            sub: 'global · fastest' },
              { id: 'sauvola',  name: 'Sauvola',         sub: 'local window · default' },
              { id: 'adaptive', name: 'Adaptive Gaussian', sub: 'gaussian window' },
              { id: 'niblack',  name: 'Niblack',         sub: 'local mean + std' },
            ].map((opt, i) => {
              const a = i === methodIdx;
              return (
                <div key={opt.id} style={{ minWidth: 140, flex: 1, padding: '8px 12px', borderRadius: 7, background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (a ? 'var(--accent)' : 'var(--border-1)'), cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{opt.name}</div>
                  <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)' }}>{opt.sub}</div>
                </div>
              );
            })}
          </div>
        </div>

        <SettingRow title="Window size" sub={isAdaptive ? 'Side of the local window the binarizer samples' : 'Otsu is global — window does not apply'} dim={!isAdaptive}>
          <SettingSlider value={windowPx} min={11} max={71} unit=" px" />
        </SettingRow>

        <SettingRow title="k-factor" sub={isAdaptive ? 'Sauvola/Niblack sensitivity — lower keeps more ink' : 'Otsu is global — k does not apply'} dim={!isAdaptive}>
          <SettingSlider value={kFactor} min={0.1} max={0.6} pct={(kFactor - 0.1) / 0.5} />
        </SettingRow>

        <SettingRow title="Min source contrast" sub="Pages below this flag as low-contrast">
          <SettingSlider value={minContrast} min={0} max={100} unit="%" />
        </SettingRow>

        <SettingRow title="Despeckle output" sub="Remove isolated black pixels after binarizing" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Median pass on the bilevel result. Adds ~0.1s per page.</div>
          <Toggle on={state !== 'default'} />
        </SettingRow>

        <SettingRow title="Bleed-through guard" sub="Flag pages where reverse-side show-through went black" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Compares both page sides where a duplex scan exists.</div>
          <Toggle on={true} />
        </SettingRow>

        <SettingRow title="Re-run threshold" sub="Clears current bilevel output and re-runs with the settings above">
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="default" size="sm" icon="refresh">Re-binarize all 387</Button>
            <Button variant="ghost" size="sm" icon="refresh">Re-binarize flagged only · 26</Button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
};

Object.assign(window, {
  BilevelThumb, ThFlagChip, ThStatusDot, MethodPill, Histogram, ThresholdCard,
  ThresholdBanner, ThresholdToolbar, ThresholdBulkBar, ThresholdReviewEditor,
  ThresholdPages, ThresholdOverview, ThresholdStepSettings,
});
