// canvas-map.jsx — Canvas map (stage 14, Compose group) components.
// Places every page on one common canvas. CanvasPageRender (page-on-canvas
// with mirrored margins + sidenote/split handling), AspectScatter (the common
// aspect-ratio analysis), plus the grid / spreads / overview / settings.

const { useState: useSCM } = React;

/* ---------------------- CanvasPageRender ----------------------
   The common canvas (white rect, faint edge) with the page's content placed
   per its margins. Outer/inner margins resolve to left/right by page side
   (verso = left page → outer is left). Sidenote column sits inside the outer
   margin; a split child shows a rebuilt cut edge; oversize tints the canvas.
*/
const CanvasPageRender = ({ row, w, h, showGuides = true }) => {
  const m = row.margins || { t:.05, o:.06, b:.055, i:.04 };
  const verso = row.side === 'verso';
  const left = verso ? m.o : m.i;
  const right = verso ? m.i : m.o;
  const ink = 'oklch(0.16 0 0)';
  const over = (row.flags || []).includes('oversize');
  const tight = (row.flags || []).includes('marginTight');
  return (
    <div style={{ width: w, height: h, position: 'relative', background: '#fff', border: `1px solid ${over || tight ? 'var(--mismatch)' : 'var(--border-2)'}`, borderRadius: 2, overflow: 'hidden' }}>
      {/* margin guides */}
      {showGuides ? (
        <div style={{ position: 'absolute', top: (m.t*100)+'%', left: (left*100)+'%', right: (right*100)+'%', bottom: (m.b*100)+'%', border: '1px dashed color-mix(in oklab, var(--accent) 45%, transparent)' }} />
      ) : null}
      {/* content */}
      {row.illust ? (
        <div style={{ position: 'absolute', top: (m.t*100)+'%', left: (left*100)+'%', right: (right*100)+'%', bottom: (m.b*100)+'%', background: '#111', opacity: 0.13, borderRadius: 2 }}><div style={{ position: 'absolute', inset: 6, border: '1px solid #111', opacity: 0.3 }} /></div>
      ) : (
        <>
          <div style={{ position: 'absolute', top: `calc(${m.t*100}% + 6%)`, left: (left*100)+'%', right: (right*100)+'%', bottom: `calc(${m.b*100}% + 2%)`, backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.4px, transparent 1.4px 6px)`, opacity: over ? 0.95 : 0.82 }} />
          <div style={{ position: 'absolute', top: (m.t*100)+'%', left: (left*100)+'%', width: '30%', height: 2.2, background: ink }} />
        </>
      )}
      {/* sidenote column inside the outer margin */}
      {row.sidenote ? (
        <div style={{ position: 'absolute', top: '24%', bottom: '30%', [verso ? 'left' : 'right']: `${(verso ? m.o : m.o) * 30}%`, width: '7%', background: 'color-mix(in oklab, var(--fuzzy) 26%, transparent)', border: '1px solid var(--fuzzy)', borderRadius: 1 }}>
          <div style={{ position: 'absolute', inset: '8% 16%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1px, transparent 1px 4px)`, opacity: 0.55 }} />
        </div>
      ) : null}
      {/* split-child rebuilt cut edge (inner) */}
      {row.split ? (
        <div style={{ position: 'absolute', top: 0, bottom: 0, [verso ? 'right' : 'left']: 0, width: '3%', background: 'repeating-linear-gradient(45deg, color-mix(in oklab, var(--ocr) 30%, transparent) 0 3px, transparent 3px 6px)', borderLeft: verso ? 'none' : '1.5px dashed var(--ocr)', borderRight: verso ? '1.5px dashed var(--ocr)' : 'none' }} />
      ) : null}
    </div>
  );
};

/* ---------------------- AspectScatter ----------------------
   Page-dimension scatter. Body cluster (tight, near the common ratio) is
   highlighted; the chosen common-canvas ratio is the box. Outliers sit away.
*/
const AspectScatter = ({ w = 280, h = 180 }) => (
  <div style={{ position: 'relative', width: w, height: h, background: 'var(--bg-page)', border: '1px solid var(--border-1)', borderRadius: 6, overflow: 'hidden' }}>
    {/* axes */}
    <div style={{ position: 'absolute', left: 28, right: 10, bottom: 22, top: 10, borderLeft: '1px solid var(--border-2)', borderBottom: '1px solid var(--border-2)' }} />
    {/* chosen common-canvas ratio box */}
    <div style={{ position: 'absolute', left: `${28 + (w - 38) * 0.42}px`, top: `${10 + (h - 32) * 0.50}px`, width: 46, height: 30, border: '1.5px solid var(--accent)', background: 'color-mix(in oklab, var(--accent) 10%, transparent)', borderRadius: 2 }}>
      <span className="mono" style={{ position: 'absolute', top: -14, left: 0, fontSize: 8.5, color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>common</span>
    </div>
    {/* points */}
    {ASPECT_POINTS.map((p, i) => (
      <span key={i} style={{ position: 'absolute', left: `${28 + (w - 38) * p.x}px`, top: `${10 + (h - 32) * (1 - p.y)}px`, width: p.body ? 5 : 6, height: p.body ? 5 : 6, borderRadius: p.body ? 99 : 1, background: p.body ? 'var(--ocr)' : 'transparent', border: p.body ? 'none' : '1.5px solid var(--gt)', transform: 'translate(-50%,-50%)' }} />
    ))}
    <span className="mono" style={{ position: 'absolute', left: 4, top: '46%', fontSize: 8.5, color: 'var(--ink-4)', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>height</span>
    <span className="mono" style={{ position: 'absolute', bottom: 6, left: '46%', fontSize: 8.5, color: 'var(--ink-4)' }}>width</span>
  </div>
);

/* ---------------------- chips / dots ---------------------- */
const CmFlagChip = ({ kind, size = 'sm' }) => {
  const f = CMAP_FLAGS[kind]; if (!f) return null;
  const d = size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 } : { h: 16, px: 6, fs: 9.5, dot: 4.5 };
  return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: d.h, padding: `0 ${d.px}px`, borderRadius: 99, fontSize: d.fs, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)` }}><span style={{ width: d.dot, height: d.dot, borderRadius: 99, background: f.tone }} />{f.label}</span>;
};
const CmStatusDot = ({ state, size = 8 }) => {
  const tone = state === 'clean' ? 'var(--exact)' : state === 'flagged' ? 'var(--fuzzy)' : state === 'reviewed' ? 'var(--ocr)' : state === 'running' ? 'var(--ocr)' : 'var(--mismatch)';
  return <span style={{ width: size, height: size, borderRadius: 99, background: tone, boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none', animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none', display: 'inline-block', flex: '0 0 auto' }} />;
};

const CMAP_DENSITY = { S: { col: 9, w: 96, h: 122, fs: 10, flagMax: 1, flagSize: 'sm' }, M: { col: 6, w: 140, h: 178, fs: 11, flagMax: 2, flagSize: 'sm' }, L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' } };

const CmapCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = CMAP_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).slice(0, cfg.flagMax);
  const extra = (row.flags || []).length - flags.length;
  return (
    <div style={{ position: 'relative', padding: 4, borderRadius: 6, background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : expanded ? 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' : 'transparent', border: '1.5px solid ' + (selected ? 'var(--accent)' : expanded ? 'var(--ocr)' : hovered ? 'var(--border-3)' : 'transparent'), cursor: 'pointer', transition: 'border-color .12s, background .12s' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} /> : <CanvasPageRender row={row} w={cfg.w - 8} h={cfg.h - 36} showGuides={density !== 'S'} />}
        {!isRunning ? <div style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 4, background: selected ? 'var(--accent)' : 'rgba(12,12,16,0.78)', border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(240,240,242,0.40)'), display: 'grid', placeItems: 'center', color: selected ? 'var(--accent-ink)' : 'transparent' }}><Icon name="check" size={11} stroke={3} /></div> : null}
        {row.pageNumber != null ? <div style={{ position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4, background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><CmStatusDot state={row.state} size={6} />{row.pageNumber}</div> : null}
        {!isRunning && row.side && density !== 'S' ? <div className="mono" style={{ position: 'absolute', bottom: 6, right: 6, height: 16, padding: '0 5px', borderRadius: 3, background: 'rgba(12,12,16,0.72)', color: 'rgba(240,240,242,0.85)', fontSize: 9.5, fontWeight: 600 }}>{row.side === 'verso' ? 'L' : 'R'}</div> : null}
        {flags.length > 0 ? <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>{flags.map(k => <CmFlagChip key={k} kind={k} size={cfg.flagSize} />)}{extra > 0 ? <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(12,12,16,0.85)', color: '#f0f0f2' }}>+{extra}</span> : null}</div> : row.state === 'reviewed' ? <div style={{ position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4, height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))', color: 'var(--ocr)', border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)', fontSize: 9.5, fontWeight: 600 }}><Icon name="check" size={9} stroke={3} />reviewed</div> : null}
      </div>
      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? <span className="mono" style={{ fontSize: cfg.fs - 1, color: 'var(--ink-4)' }}>{row.state === 'clean' ? 'placed' : row.state === 'flagged' ? `${row.flags.length} flag${row.flags.length > 1 ? 's' : ''}` : row.state === 'reviewed' ? 'ok·rv' : row.state}</span> : null}
      </div>
    </div>
  );
};

/* ---------------------- Banner ---------------------- */
const CmapBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.placed / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}><span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>Placing pages on the common canvas…<span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.placed} / {totals.total} · {totals.rateHz}/s · {COMMON_CANVAS.w}×{COMMON_CANVAS.h}</span></div><div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} /></div></div>
        <Button variant="default" size="sm" icon="pause">Pause</Button><span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ocr)', flex: '0 0 auto' }}>{pct}%</span>
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
          <div style={{ width: 30, height: 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))', color: tone, display: 'grid', placeItems: 'center' }}><Icon name={flagged > 0 ? 'alert' : 'checkCircle'} size={15} /></div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{totals.placed} pages on a common {COMMON_CANVAS.w}×{COMMON_CANVAS.h} canvas{flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed</> : <> · uniform</>}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{flagged > 0 ? <>Ratio <span className="mono" style={{ color: 'var(--ink-1)' }}>{COMMON_CANVAS.ratioLabel}</span> from {COMMON_CANVAS.bodyPages} body pages · {totals.splits} split children · {totals.sidenotes} sidenote pages. Review the outliers, then confirm.</> : 'Every page placed and margined uniformly. Confirm to advance to Hyphen join.'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['placed', totals.clean, 'var(--exact)'], ['flagged', totals.flagged, 'var(--fuzzy)'], ['split children', totals.splits, 'var(--ocr)'], ['sidenotes', totals.sidenotes, 'var(--fuzzy)']].filter(([_, n]) => n > 0).map(([k, n, color]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}><span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />{k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span></span>)}</div>
          </div>
        </div>
        {stale ? <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={12} />Settings changed — 12 downstream stages now stale</div> : null}
      </div>
    </div>
  );
};

/* ---------------------- Toolbar / BulkBar ---------------------- */
const CmapToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [{ id: 'all', name: 'All', count: totals.total }, { id: 'flagged', name: 'Flagged', count: totals.flagged, dot: 'var(--fuzzy)' }, { id: 'splits', name: 'Split children', count: totals.splits, dot: 'var(--ocr)' }, { id: 'sidenotes', name: 'Sidenotes', count: totals.sidenotes, dot: 'var(--fuzzy)' }, { id: 'clean', name: 'Placed', count: totals.clean, dot: 'var(--exact)' }, ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : [])];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>{chips.map(f => { const a = filter === f.id; return <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer' }}>{f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span></div>; })}</div>
      <Divider vertical style={{ height: 22 }} />
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>canvas {COMMON_CANVAS.w}×{COMMON_CANVAS.h} · {COMMON_CANVAS.ratioLabel}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="default" size="sm" icon="refresh">Re-derive canvas</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>Density<div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>{['S', 'M', 'L'].map(d => { const a = density === d; return <div key={d} style={{ padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)' }}>{d}</div>; })}</div></div>
      </div>
    </div>
  );
};

const CmapBulkBar = ({ count }) => (
  <div style={{ position: 'sticky', bottom: 12, marginTop: 12, zIndex: 5, padding: '10px 14px', borderRadius: 10, background: 'var(--ink-1)', color: 'var(--bg-page)', boxShadow: '0 12px 28px rgba(15,23,42,.22), 0 2px 6px rgba(15,23,42,.10)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{count} selected</span><div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    {[{ id: 'fit', name: 'Fit to canvas', icon: 'swap' }, { id: 'mirror', name: 'Mirror margins', icon: 'copy' }, { id: 'exclude', name: 'Exclude from norm', icon: 'x' }, { id: 'accept', name: 'Accept as-is', icon: 'check' }].map(b => <button key={b.id} style={{ height: 26, padding: '0 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--bg-page) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--bg-page) 22%, transparent)', color: 'var(--bg-page)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}><Icon name={b.icon} size={11} />{b.name}</button>)}
    <span style={{ flex: 1 }} /><span className="mono" style={{ fontSize: 10.5, color: 'color-mix(in oklab, var(--bg-page) 55%, transparent)' }}><KeyCap>esc</KeyCap> clear</span>
  </div>
);

/* ---------------------- Inline place editor ---------------------- */
const CmSlider = ({ value, min, max, unit = '', pct }) => { const p = pct != null ? pct : (value - min) / (max - min); return <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 360 }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{min}{unit}</span><div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}><div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 99, background: 'var(--accent)' }} /><div style={{ position: 'absolute', left: `calc(${p * 100}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: 99, background: 'var(--bg-surface)', border: '2px solid var(--accent)' }} /></div><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{max}{unit}</span><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 44, textAlign: 'right' }}>{value}{unit}</span></div>; };
const CmSeg = ({ options, activeIdx }) => <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7, flexWrap: 'wrap' }}>{options.map((o, i) => { const a = i === activeIdx; return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>; })}</div>;
const CmRow = ({ title, sub, children, control }) => <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: control === 'seg' ? 'flex-start' : 'center', borderTop: '1px solid var(--border-1)' }}><div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div></div>{children}</div>;

const CmapPlaceEditor = ({ row }) => {
  const fl = (row.flags || [])[0];
  const verso = row.side === 'verso';
  // facing partner (schematic mirror)
  const partner = { ...row, side: verso ? 'recto' : 'verso', prefix: verso ? '(recto)' : '(verso)', flags: [], pageNumber: '' };
  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)', background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden', animation: 'pgd-slide-up .18s ease-out' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))' }}>
        <Icon name="image" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Place on canvas · {row.prefix}.tif</span>
        {(row.flags || []).map(k => <CmFlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.side} · canvas {COMMON_CANVAS.w}×{COMMON_CANVAS.h}</span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={13} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* facing-spread preview */}
        <div style={{ padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)', minHeight: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 2, boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }}>
            {verso ? <><CanvasPageRender row={row} w={196} h={290} /><CanvasPageRender row={partner} w={196} h={290} /></> : <><CanvasPageRender row={partner} w={196} h={290} /><CanvasPageRender row={row} w={196} h={290} /></>}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>facing spread · this page {verso ? 'left (verso)' : 'right (recto)'} · margins mirror at the gutter</div>
        </div>
        {/* controls */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fl === 'sidenote' ? (
            <div style={{ padding: '10px 12px', borderRadius: 7, border: '1px solid color-mix(in oklab, var(--fuzzy) 40%, var(--border-1))', background: 'color-mix(in oklab, var(--fuzzy) 6%, var(--bg-surface))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Icon name="info" size={13} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>Sidenote on the {verso ? 'left' : 'right'} (outer) margin</span></div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>The outer margin is widened to fit it. To keep the spread symmetric, the facing page's outer margin is widened to match.</div>
            </div>
          ) : fl === 'splitChild' ? (
            <div style={{ padding: '10px 12px', borderRadius: 7, border: '1px solid color-mix(in oklab, var(--ocr) 40%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Icon name="scissors" size={13} style={{ color: 'var(--ocr)' }} /><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>Split child · {row.split === 'col' ? 'column' : 'row'} cut</span></div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>The cut edge had no margin. A new <span style={{ color: 'var(--ink-1)' }}>inner margin</span> is rebuilt so this half sits naturally in the spread.</div>
            </div>
          ) : fl === 'oversize' ? (
            <div style={{ padding: '10px 12px', borderRadius: 7, border: '1px solid color-mix(in oklab, var(--mismatch) 40%, var(--border-1))', background: 'color-mix(in oklab, var(--mismatch) 6%, var(--bg-surface))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><Icon name="alert" size={13} style={{ color: 'var(--mismatch)' }} /><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>Content larger than the canvas</span></div>
              <div style={{ display: 'flex', gap: 6 }}><Button variant="primary" size="sm" icon="swap">Scale to fit</Button><Button variant="default" size="sm" icon="x">Exclude</Button></div>
            </div>
          ) : null}
          <div><div className="label" style={{ color: 'var(--ink-3)', marginBottom: 7 }}>Margins (mm)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="mono" style={{ width: 42, fontSize: 11, color: 'var(--ink-3)' }}>top</span><CmSlider value={16} min={0} max={40} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="mono" style={{ width: 42, fontSize: 11, color: 'var(--ink-3)' }}>outer</span><CmSlider value={row.sidenote ? 34 : 20} min={0} max={40} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="mono" style={{ width: 42, fontSize: 11, color: 'var(--ink-3)' }}>inner</span><CmSlider value={14} min={0} max={40} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="mono" style={{ width: 42, fontSize: 11, color: 'var(--ink-3)' }}>bottom</span><CmSlider value={18} min={0} max={40} /></div>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))', border: '1px solid var(--accent)', cursor: 'pointer' }}><Toggle on={true} /><span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-1)' }}>Mirror outer / inner on facing page</span></label>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><Button variant="ghost" size="sm">Cancel</Button><Button variant="default" size="sm" icon="check">Accept</Button><Button variant="primary" size="sm" icon="image">Re-place</Button></div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Pages / Spreads / Overview / Settings ---------------------- */
const CmapPages = ({ state = 'review', density = 'M', filter = 'all', selected = [], editing = null, stale = false }) => {
  const totals = state === 'running' ? CMAP_TOTALS_RUNNING : state === 'done' ? CMAP_TOTALS_DONE : CMAP_TOTALS_REVIEW;
  const rows = state === 'running' ? CMAP_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined }) : CMAP_ROWS;
  const filtered = filter === 'flagged' ? rows.filter(r => r.state === 'flagged') : filter === 'splits' ? rows.filter(r => r.split) : filter === 'sidenotes' ? rows.filter(r => r.sidenote) : filter === 'clean' ? rows.filter(r => r.state === 'clean') : filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) : rows;
  const editingRow = editing != null ? CMAP_ROWS.find(r => r.idx === editing) : null;
  const hasSel = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}><CmapBanner state={state} totals={totals} stale={stale} /></div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}><Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running' || !canAdvance}>Confirm and advance · {totals.total} pages</Button>{state !== 'running' && !canAdvance ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{totals.flagged - totals.reviewed} flagged pages still need review</span> : null}</div>
      </div>
      <CmapToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${CMAP_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => <CmapCard key={r.idx} row={r} density={density} selected={selected.includes(r.idx)} hovered={i === 4 && state !== 'running' && !hasSel && editing == null} expanded={editing === r.idx} />)}
      </div>
      {editingRow ? <CmapPlaceEditor row={editingRow} /> : null}
      {hasSel ? <CmapBulkBar count={selected.length} /> : null}
    </div>
  );
};

const CmapSpreads = () => (
  <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 5%, var(--bg-surface))', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 30, height: 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}><Icon name="copy" size={15} /></div>
      <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Facing pages</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Verso / recto pairs as the reader sees them. Outer and inner margins mirror at the gutter; sidenote margins widen on both sides to stay symmetric.</div></div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
      {CMAP_SPREADS.map(sp => {
        const versoRow = CMAP_ROWS.find(r => r.prefix === sp.verso) || CMAP_ROWS[1];
        const rectoRow = CMAP_ROWS.find(r => r.prefix === sp.recto) || CMAP_ROWS[0];
        const v = { ...versoRow, side: 'verso' }; const rc = { ...rectoRow, side: 'recto' };
        return (
          <div key={sp.id} style={{ background: 'var(--bg-surface)', border: '1px solid ' + (sp.mirror ? 'var(--border-1)' : 'color-mix(in oklab, var(--fuzzy) 45%, var(--border-1))'), borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 2, background: 'var(--bg-sunk)', borderRadius: 4, padding: 16, boxShadow: 'inset 0 0 0 1px var(--border-1)' }}>
              <CanvasPageRender row={v} w={150} h={216} />
              <div style={{ width: 4, background: 'linear-gradient(90deg, rgba(0,0,0,0.18), transparent 40%, transparent 60%, rgba(0,0,0,0.18))' }} />
              <CanvasPageRender row={rc} w={150} h={216} />
            </div>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600 }}>{sp.verso} · {sp.recto}</span>
              {sp.sidenote ? <CmFlagChip kind="sidenote" size="md" /> : null}
              {!sp.mirror ? <CmFlagChip kind="facingMismatch" size="md" /> : <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--exact)' }}><Icon name="check" size={10} stroke={3} />mirrored</span>}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{sp.note}</span>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const CmapOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? CMAP_TOTALS_RUNNING : state === 'done' ? CMAP_TOTALS_DONE : CMAP_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CmapBanner state={state} totals={totals} />
      {/* aspect analysis hero */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '16px', display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18 }}>
        <AspectScatter w={300} h={190} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>Common aspect ratio</div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>Derived from the <span style={{ color: 'var(--ocr)', fontWeight: 600 }}>{COMMON_CANVAS.bodyPages} pages that are mostly body text</span> (the tight cluster), not from the {COMMON_CANVAS.outliers} outliers — plates, title pages and foldouts sit apart and are fit <span style={{ color: 'var(--ink-1)' }}>within</span> the canvas rather than setting it.</div>
          <div style={{ marginTop: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {[['canvas', `${COMMON_CANVAS.w} × ${COMMON_CANVAS.h}`], ['ratio', COMMON_CANVAS.ratioLabel], ['from', `${COMMON_CANVAS.bodyPages} body pages`], ['outliers', `${COMMON_CANVAS.outliers} fit within`], ['dpi', `${COMMON_CANVAS.dpi}`]].map(([k, v]) => (
              <div key={k}><div className="label" style={{ color: 'var(--ink-4)' }}>{k}</div><div className="mono" style={{ marginTop: 3, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{v}</div></div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-3)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--ocr)' }} />body page</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 1, border: '1.5px solid var(--gt)' }} />outlier</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 7, border: '1.5px solid var(--accent)' }} />chosen ratio</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[{ label: 'pages', value: totals.total, tone: 'ink-1' }, { label: 'placed', value: `${totals.placed}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' }, { label: 'uniform', value: totals.clean, tone: 'exact' }, { label: 'flagged', value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' }, { label: 'split children', value: totals.splits, tone: 'ocr', sub: 'cut margin rebuilt' }, { label: 'sidenotes', value: totals.sidenotes, tone: 'fuzzy', sub: 'outer margin widened' }].map((s, i) => <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}><div className="label" style={{ color: 'var(--ink-3)' }}>{s.label}</div><div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${s.tone})`, letterSpacing: '-0.01em' }}>{s.value}</div>{s.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{s.sub}</div> : null}</div>)}
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Placement flags</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Object.entries(CMAP_FLAG_COUNTS).map(([k, n]) => { const f = CMAP_FLAGS[k]; const max = Math.max(...Object.values(CMAP_FLAG_COUNTS)); return <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 36px', gap: 10, alignItems: 'center' }}><CmFlagChip kind={k} size="md" /><div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} /></div><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span></div>; })}</div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div></div>
        {[['1 min ago', 'Canvas placement completed', '387 pages · 17 flagged · 31 sidenotes mirrored'], ['1 min ago', 'Common canvas derived', `${COMMON_CANVAS.w}×${COMMON_CANVAS.h} from ${COMMON_CANVAS.bodyPages} body pages`], ['4 min ago', 'Post-OCR crop confirmed', '387 pages forwarded']].map((r, i) => <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center' }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r[0]}</span><span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{r[1]}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r[2]}</span></div>)}
      </div>
    </div>
  );
};

const CmapStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? { tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 3 changes vs project default', sub: 'Save these as the project default, or revert to inherit.' } : state === 'preset' ? { tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Octavo (annotated)', sub: 'Loaded from a saved preset; not the project default.' } : { tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · Body-median canvas', sub: 'Changes here can be saved back as the project default for Canvas map.' };
  const targetIdx = state === 'preset' ? 3 : 0;
  const srcIdx = 0;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Canvas map</h2><div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>How the common canvas is chosen, the margin scheme, and how split children and facing-page sidenotes are handled.</div></div>
      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div></div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>{state === 'modified' ? <><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></> : state === 'preset' ? <Button variant="default" size="sm" icon="refresh">Reset to project default</Button> : null}</div>
      </div>
      {state === 'modified' ? <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Canvas map and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>12 downstream stages</span> as stale.</span><span style={{ flex: 1 }} /><Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button></div> : null}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start' }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Target canvas</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>What sets the common dimensions</div></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[{ id: 'body', name: 'Body median', sub: 'derive from body pages' }, { id: 'a4', name: 'A4', sub: '210 × 297' }, { id: 'letter', name: 'US Letter', sub: '8.5 × 11' }, { id: 'custom', name: 'Custom', sub: 'fixed w × h' }].map((opt, i) => { const a = i === targetIdx; return <div key={opt.id} style={{ minWidth: 140, flex: 1, padding: '8px 12px', borderRadius: 7, background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (a ? 'var(--accent)' : 'var(--border-1)'), cursor: 'pointer' }}><div style={{ fontSize: 12, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{opt.name}</div><div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)' }}>{opt.sub}</div></div>; })}</div>
        </div>
        <CmRow title="Aspect source" sub="Which pages vote on the common ratio" control="seg"><CmSeg options={['Body-text pages only', 'All pages']} activeIdx={srcIdx} /></CmRow>
        <CmRow title="Margins" sub="Top / outer / bottom / inner — outer & inner mirror on facing pages">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[['top', 16], ['outer', 20], ['bottom', 18], ['inner', 14]].map(([k, v]) => <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="mono" style={{ width: 46, fontSize: 11, color: 'var(--ink-3)' }}>{k}</span><CmSlider value={v} min={0} max={40} unit="mm" /></div>)}
          </div>
        </CmRow>
        <CmRow title="Mirror facing margins" sub="Swap outer/inner between verso and recto so spreads read symmetric" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Off uses the same left/right on every page.</div><Toggle on={true} /></CmRow>
        <CmRow title="Sidenote allowance" sub="Extra outer-margin width reserved when a page carries marginalia"><CmSlider value={18} min={0} max={50} unit="mm" /></CmRow>
        <CmRow title="Rebuild split-child margin" sub="Add an inner margin on the cut edge of pages from a page split" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>So a split half doesn't sit flush against the gutter.</div><Toggle on={true} /></CmRow>
        <CmRow title="Fit outliers within canvas" sub="Scale plates / foldouts to fit rather than letting them set the size" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Aspect-outlier pages never stretch.</div><Toggle on={true} /></CmRow>
        <CmRow title="Re-derive & re-place" sub="Recompute the common canvas and re-place every page"><div style={{ display: 'flex', gap: 8 }}><Button variant="default" size="sm" icon="refresh">Re-place all 387</Button><Button variant="ghost" size="sm" icon="refresh">Re-place flagged · 17</Button></div></CmRow>
      </div>
    </div>
  );
};

Object.assign(window, {
  CanvasPageRender, AspectScatter, CmFlagChip, CmStatusDot, CmapCard,
  CmapBanner, CmapToolbar, CmapBulkBar, CmapPlaceEditor,
  CmapPages, CmapSpreads, CmapOverview, CmapStepSettings,
});
