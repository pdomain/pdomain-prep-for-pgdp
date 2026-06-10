// text-zones.jsx — Text-zones stage (stage 9, OCR group) core components.
// Layout detection: segments pages into typed zones + a reading order.
// ZonePageRender (shared page+overlay renderer, used by thumbs AND the inline
// editors in text-zones-split.jsx), ZoneThumb, ZnFlagChip, ZoneCard,
// ZoneBanner, ZoneToolbar, ZoneBulkBar, ZonePages, ZoneOverview,
// ZoneStepSettings. Same scaffold as the prior stages.

const { useState: useSTZ } = React;

/* ---------------------- ZoneBox ----------------------
   One typed region drawn inside the page. Tinted fill + tone border, with
   schematic content (body = faint lines, heading = bars, illustration =
   block, table = grid). `lod` ('s'|'m'|'l') controls how much detail.
*/
const ZoneBox = ({ z, lod = 'm' }) => {
  const t = ZONE_TYPES[z.type] || ZONE_TYPES.body;
  const ink = 'oklch(0.20 0 0)';
  const lines = (n, op) => (
    <div style={{ position: 'absolute', inset: '14% 10%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1px, transparent 1px ${n}px)`, opacity: op }} />
  );
  return (
    <div style={{
      position: 'absolute',
      left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%`,
      background: `color-mix(in oklab, ${t.tone} 12%, transparent)`,
      border: `1px solid color-mix(in oklab, ${t.tone} 55%, transparent)`,
      borderRadius: 2, overflow: 'hidden', boxSizing: 'border-box',
    }}>
      {z.type === 'illustration' ? (
        <div style={{ position: 'absolute', inset: '12%', border: `1px dashed ${ink}`, opacity: 0.4, display: 'grid', placeItems: 'center' }}>
          <Icon name="image" size={lod === 'l' ? 18 : 11} style={{ color: ink, opacity: 0.45 }} />
        </div>
      ) : z.type === 'table' ? (
        <div style={{ position: 'absolute', inset: '10%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1px, transparent 1px 14%), repeating-linear-gradient(to right, ${ink} 0 1px, transparent 1px 20%)`, opacity: 0.4 }} />
      ) : z.type === 'heading' ? (
        <div style={{ position: 'absolute', inset: '22% 12%', background: ink, opacity: 0.5, borderRadius: 1 }} />
      ) : (
        lines(z.type === 'caption' || z.type === 'footnote' ? 3.4 : 4.4, z.type === 'header' || z.type === 'footer' ? 0.4 : 0.62)
      )}
      {/* reading-order badge */}
      {lod !== 's' && z.order != null && z.order < 90 ? (
        <span className="mono" style={{
          position: 'absolute', top: 2, left: 2, minWidth: lod === 'l' ? 16 : 12, height: lod === 'l' ? 16 : 12, padding: '0 3px',
          borderRadius: 3, background: t.tone, color: '#fff',
          fontSize: lod === 'l' ? 10 : 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{z.order}</span>
      ) : null}
    </div>
  );
};

/* ---------------------- ZonePageRender ----------------------
   The page with all its zone overlays. Optionally draws the suggested split
   guide (vertical for column, horizontal for row). Reused by thumbs and the
   inline split / zone editors.
*/
const ZonePageRender = ({ row, w, h, lod = 'm', showSplit = true }) => {
  const zones = ZONE_TEMPLATES[row.layoutKind] || ZONE_TEMPLATES.single;
  const split = row.split;
  const splitTone = split && split.conf < 0.7 ? 'var(--fuzzy)' : 'var(--ocr)';
  return (
    <div style={{ width: w, height: h, position: 'relative', background: '#fff', border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden' }}>
      {zones.map((z, i) => <ZoneBox key={i} z={z} lod={lod} />)}

      {/* split guide */}
      {showSplit && split && !split.applied ? (
        split.axis === 'col' ? (
          <div style={{ position: 'absolute', top: '4%', bottom: '4%', left: `${split.gutter * 100}%`, width: 0, borderLeft: `2px dashed ${splitTone}`, transform: 'translateX(-1px)' }}>
            <span style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', width: lod === 'l' ? 22 : 15, height: lod === 'l' ? 22 : 15, borderRadius: 99, background: splitTone, color: '#fff', display: 'grid', placeItems: 'center' }}>
              <Icon name="scissors" size={lod === 'l' ? 12 : 8} />
            </span>
          </div>
        ) : (
          <div style={{ position: 'absolute', left: '4%', right: '4%', top: `${split.gutter * 100}%`, height: 0, borderTop: `2px dashed ${splitTone}` }}>
            <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: lod === 'l' ? 22 : 15, height: lod === 'l' ? 22 : 15, borderRadius: 99, background: splitTone, color: '#fff', display: 'grid', placeItems: 'center' }}>
              <Icon name="scissors" size={lod === 'l' ? 12 : 8} />
            </span>
          </div>
        )
      ) : null}

      {/* applied-split marker (two child pages) */}
      {split && split.applied ? (
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'inline-flex', alignItems: 'center', gap: 3, height: 15, padding: '0 5px', borderRadius: 99, background: 'color-mix(in oklab, var(--exact) 85%, black)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 8.5, fontWeight: 700 }}>
          <Icon name="check" size={8} stroke={3} />split·2
        </div>
      ) : null}
    </div>
  );
};

/* ---------------------- ZoneThumb ---------------------- */
const ZoneThumb = ({ row, w, h, lod }) => <ZonePageRender row={row} w={w} h={h} lod={lod || 'm'} />;

/* ---------------------- Flag chip / status dot ---------------------- */
const ZnFlagChip = ({ kind, size = 'sm' }) => {
  const f = ZONE_FLAGS[kind]; if (!f) return null;
  const dims = size === 'lg' ? { h: 22, px: 8, fs: 11, dot: 6 } : size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 } : { h: 16, px: 6, fs: 9.5, dot: 4.5 };
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: dims.h, padding: `0 ${dims.px}px`, borderRadius: 99, fontSize: dims.fs, fontWeight: 600,
      background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)`,
    }}>
      <span style={{ width: dims.dot, height: dims.dot, borderRadius: 99, background: f.tone }} />
      {f.label}
    </span>
  );
};

const ZnStatusDot = ({ state, size = 8 }) => {
  const tone = state === 'clean' ? 'var(--exact)' : state === 'flagged' ? 'var(--fuzzy)' : state === 'split' ? 'var(--ocr)' : state === 'reviewed' ? 'var(--ocr)' : state === 'running' ? 'var(--ocr)' : state === 'failed' ? 'var(--mismatch)' : 'var(--ink-4)';
  return <span style={{ width: size, height: size, borderRadius: 99, background: tone, boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none', animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none', display: 'inline-block', flex: '0 0 auto' }} />;
};

/* ---------------------- ZoneCard ---------------------- */
const ZONE_DENSITY = {
  S: { col: 9, w: 96,  h: 122, fs: 10,   flagMax: 1, flagSize: 'sm', lod: 's' },
  M: { col: 6, w: 140, h: 178, fs: 11,   flagMax: 2, flagSize: 'sm', lod: 'm' },
  L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md', lod: 'l' },
};

const ZoneCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = ZONE_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).filter(f => f !== 'splitSuggested').slice(0, cfg.flagMax);
  const extra = (row.flags || []).filter(f => f !== 'splitSuggested').length - flags.length;
  const isSplit = (row.flags || []).includes('splitSuggested') && row.state !== 'reviewed';
  return (
    <div style={{
      position: 'relative', padding: 4, borderRadius: 6,
      background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : expanded ? 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' : 'transparent',
      border: '1.5px solid ' + (selected ? 'var(--accent)' : expanded ? 'var(--ocr)' : hovered ? 'var(--border-3)' : 'transparent'),
      cursor: 'pointer', transition: 'border-color .12s, background .12s',
    }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} /> : <ZoneThumb row={row} w={cfg.w - 8} h={cfg.h - 36} lod={cfg.lod} />}

        {!isRunning ? (
          <div style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 4, background: selected ? 'var(--accent)' : 'rgba(12,12,16,0.78)', border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(240,240,242,0.40)'), display: 'grid', placeItems: 'center', color: selected ? 'var(--accent-ink)' : 'transparent' }}>
            <Icon name="check" size={11} stroke={3} />
          </div>
        ) : null}

        {row.pageNumber != null ? (
          <div style={{ position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4, background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <ZnStatusDot state={row.state} size={6} />{row.pageNumber}
          </div>
        ) : null}

        {!isRunning && row.zones != null && density !== 'S' ? (
          <div className="mono" style={{ position: 'absolute', bottom: 6, right: 6, height: 16, padding: '0 5px', borderRadius: 3, background: 'rgba(12,12,16,0.72)', color: 'rgba(240,240,242,0.85)', fontSize: 9.5, fontWeight: 600 }}>{row.zones} zones</div>
        ) : null}

        {/* split badge top-right takes priority */}
        {isSplit ? (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 7px', borderRadius: 99, background: `color-mix(in oklab, ${row.split.conf < 0.7 ? 'var(--fuzzy)' : 'var(--ocr)'} 18%, rgba(12,12,16,0.78))`, color: row.split.conf < 0.7 ? 'var(--fuzzy)' : 'var(--ocr)', border: `1px solid color-mix(in oklab, ${row.split.conf < 0.7 ? 'var(--fuzzy)' : 'var(--ocr)'} 45%, transparent)`, fontSize: 9.5, fontWeight: 600 }} className="mono">
            <Icon name="scissors" size={9} />{row.split.axis === 'col' ? 'col' : 'row'} split
          </div>
        ) : flags.length > 0 ? (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {flags.map(k => <ZnFlagChip key={k} kind={k} size={cfg.flagSize} />)}
            {extra > 0 ? <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(12,12,16,0.85)', color: '#f0f0f2' }}>+{extra}</span> : null}
          </div>
        ) : row.state === 'reviewed' ? (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4, height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))', color: 'var(--ocr)', border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)', fontSize: 9.5, fontWeight: 600 }}>
            <Icon name="check" size={9} stroke={3} />reviewed
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? (
          <span className="mono" style={{ fontSize: cfg.fs - 1, color: 'var(--ink-4)' }}>
            {row.state === 'clean' ? `${row.lines}ln` : isSplit ? '→ 2 pp' : row.state === 'reviewed' ? 'ok·rv' : `${row.flags.filter(f=>f!=='splitSuggested').length} flag`}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Zone-type legend ---------------------- */
const ZoneLegend = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    {Object.entries(ZONE_TYPES).map(([k, t]) => (
      <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-3)' }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: `color-mix(in oklab, ${t.tone} 30%, transparent)`, border: `1px solid ${t.tone}` }} />
        {t.label}
      </span>
    ))}
  </div>
);

/* ---------------------- Banner (3-state) ---------------------- */
const ZoneBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>Detecting layout…<span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.done} / {totals.total} · {totals.rateHz}/s · {totals.splits} splits offered</span></div>
          <div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} /></div>
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
          <div style={{ width: 30, height: 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))', color: tone, display: 'grid', placeItems: 'center' }}><Icon name={flagged > 0 ? 'alert' : 'checkCircle'} size={15} /></div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
              {totals.done} pages segmented
              {flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed</> : <> · all clean</>}
              <span className="mono" style={{ marginLeft: 8, color: 'var(--ocr)', fontWeight: 500, fontSize: 12 }}>· {totals.splits} page-splits offered</span>
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
              {flagged > 0 ? 'Resolve layout flags here; column / row page-splits live in the Page splits tab. Confirm to forward zones to OCR.' : 'Zones + reading order resolved. Confirm to forward to OCR.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['clean', totals.clean, 'var(--exact)'], ['flagged', totals.flagged, 'var(--fuzzy)'], ['splits', totals.splits, 'var(--ocr)'], ['reviewed', totals.reviewed, 'var(--ocr)']].filter(([_, n]) => n > 0).map(([k, n, color]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />{k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        {stale ? (
          <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={12} />Settings changed — 16 downstream stages now stale
          </div>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Toolbar ---------------------- */
const ZoneToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [
    { id: 'all',      name: 'All',      count: totals.total },
    { id: 'flagged',  name: 'Flagged',  count: totals.flagged, dot: 'var(--fuzzy)' },
    { id: 'splits',   name: 'Splits',   count: totals.splits,  dot: 'var(--ocr)' },
    { id: 'clean',    name: 'Clean',    count: totals.clean,   dot: 'var(--exact)' },
    { id: 'reviewed', name: 'Reviewed', count: totals.reviewed, dot: 'var(--ocr)' },
    ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : []),
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>
        {chips.map(f => {
          const active = filter === f.id;
          return (
            <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: active ? 'var(--bg-surface)' : 'transparent', boxShadow: active ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: active ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: 'pointer' }}>
              {f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span>
            </div>
          );
        })}
      </div>
      <Divider vertical style={{ height: 22 }} />
      <ZoneLegend />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="default" size="sm" icon="refresh">Re-detect layout</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
          Density
          <div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
            {['S', 'M', 'L'].map(d => { const a = density === d; return <div key={d} style={{ padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)' }}>{d}</div>; })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Bulk bar ---------------------- */
const ZoneBulkBar = ({ count, flagSummary }) => (
  <div style={{ position: 'sticky', bottom: 12, marginTop: 12, zIndex: 5, padding: '10px 14px', borderRadius: 10, background: 'var(--ink-1)', color: 'var(--bg-page)', boxShadow: '0 12px 28px rgba(15,23,42,.22), 0 2px 6px rgba(15,23,42,.10)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{count} selected</span>
    {flagSummary ? (<><div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} /><span style={{ fontSize: 11.5, color: 'color-mix(in oklab, var(--bg-page) 70%, transparent)' }}>{flagSummary}</span></>) : null}
    <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    {[
      { id: 'redetect', name: 'Re-detect layout', icon: 'refresh' },
      { id: 'split',    name: 'Split into 2',     icon: 'scissors' },
      { id: 'merge',    name: 'Merge columns',    icon: 'swap' },
      { id: 'accept',   name: 'Accept as-is',     icon: 'check' },
    ].map(b => (
      <button key={b.id} style={{ height: 26, padding: '0 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--bg-page) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--bg-page) 22%, transparent)', color: 'var(--bg-page)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}>
        <Icon name={b.icon} size={11} />{b.name}
      </button>
    ))}
    <span style={{ flex: 1 }} />
    <span className="mono" style={{ fontSize: 10.5, color: 'color-mix(in oklab, var(--bg-page) 55%, transparent)' }}><KeyCap>esc</KeyCap> clear · <KeyCap>⇧</KeyCap>+click range</span>
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
    {options.map((o, i) => { const a = i === activeIdx; return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>; })}
  </div>
);
const SettingRow = ({ title, sub, children, control }) => (
  <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'center', borderTop: '1px solid var(--border-1)' }}>
    <div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div></div>
    {children}
  </div>
);

/* ---------------------- ZonePages (Pages tab body) ----------------------
   ZoneEditor + SplitEditor come from text-zones-split.jsx (loaded after).
*/
const ZonePages = ({ state = 'review', density = 'M', filter = 'all', selected = [], editing = null, stale = false }) => {
  const totals = state === 'running' ? ZONE_TOTALS_RUNNING : state === 'done' ? ZONE_TOTALS_DONE : ZONE_TOTALS_REVIEW;
  const rows = state === 'running' ? ZONE_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined, zones: undefined }) : ZONE_ROWS;
  const filtered =
    filter === 'flagged'  ? rows.filter(r => r.state === 'flagged') :
    filter === 'splits'   ? rows.filter(r => (r.flags || []).includes('splitSuggested')) :
    filter === 'clean'    ? rows.filter(r => r.state === 'clean') :
    filter === 'reviewed' ? rows.filter(r => r.state === 'reviewed') :
    filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) : rows;
  const editingRow = editing != null ? ZONE_ROWS.find(r => r.idx === editing) : null;
  const hasSelection = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}><ZoneBanner state={state} totals={totals} stale={stale} /></div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running' || !canAdvance}>Confirm and advance · {totals.total} pages</Button>
          {state !== 'running' && !canAdvance ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{totals.flagged - totals.reviewed} flagged pages still need review</span> : null}
        </div>
      </div>

      <ZoneToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${ZONE_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => <ZoneCard key={r.idx} row={r} density={density} selected={selected.includes(r.idx)} hovered={i === 1 && state !== 'running' && !hasSelection && editing == null} expanded={editing === r.idx} />)}
      </div>

      {editingRow ? (
        (editingRow.flags || []).includes('splitSuggested')
          ? <SplitEditor row={editingRow} />
          : <ZoneEditor row={editingRow} />
      ) : null}

      {hasSelection ? <ZoneBulkBar count={selected.length} flagSummary="1 merged-blocks · 1 reading-order" /> : null}
    </div>
  );
};

/* ---------------------- ZoneOverview ---------------------- */
const ZoneOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? ZONE_TOTALS_RUNNING : state === 'done' ? ZONE_TOTALS_DONE : ZONE_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ZoneBanner state={state} totals={totals} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { label: 'pages',     value: totals.total, tone: 'ink-1' },
          { label: 'segmented', value: `${totals.done}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' },
          { label: 'clean',     value: totals.clean, tone: 'exact' },
          { label: 'flagged',   value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' },
          { label: 'splits',    value: totals.splits, tone: 'ocr', sub: 'pages → 2' },
          { label: 'avg zones', value: totals.zonesAvg, tone: 'ink-1', sub: 'per page' },
        ].map((stat, i) => (
          <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}>
            <div className="label" style={{ color: 'var(--ink-3)' }}>{stat.label}</div>
            <div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${stat.tone})`, letterSpacing: '-0.01em' }}>{stat.value}</div>
            {stat.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{stat.sub}</div> : null}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* zone-type distribution */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Zone-type distribution</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {Object.entries(ZONE_TYPE_COUNTS).map(([k, n]) => {
              const t = ZONE_TYPES[k]; const max = Math.max(...Object.values(ZONE_TYPE_COUNTS));
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 40px', gap: 10, alignItems: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-2)' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: `color-mix(in oklab, ${t.tone} 30%, transparent)`, border: `1px solid ${t.tone}` }} />{t.label}
                  </span>
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: t.tone, opacity: .8 }} /></div>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* flag distribution */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Layout flags</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Across {totals.done} segmented pages</div></div>
            <Button variant="ghost" size="sm" icon="eye">Open Pages</Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(ZONE_FLAG_COUNTS).map(([k, n]) => {
              const f = ZONE_FLAGS[k]; const max = Math.max(...Object.values(ZONE_FLAG_COUNTS));
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 36px', gap: 10, alignItems: 'center' }}>
                  <ZnFlagChip kind={k} size="md" />
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} /></div>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div></div>
        {[
          ['1 min ago',  'Layout detection completed', '387 pages · 16 flagged · 7 splits offered'],
          ['1 min ago',  'Stage started',              'model: layout-v4 · granularity: line'],
          ['4 min ago',  'Settings changed',           'offer page splits: off → on'],
          ['7 min ago',  'Denoise stage confirmed',    '387 pages forwarded'],
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

/* ---------------------- ZoneStepSettings (preset-aware) ---------------------- */
const ZoneStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? { tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 2 changes vs project default', sub: 'Save these as the project default, or revert to inherit.' }
    : state === 'preset' ? { tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Two-column journal', sub: 'Loaded from a saved preset; not the project default.' }
    : { tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · Layout-v4', sub: 'Changes here can be saved back as the project default for Text zones.' };
  const granularityIdx = state === 'preset' ? 3 : 2;
  const orderIdx = state === 'modified' ? 1 : 0;
  const splitsOn = state !== 'modified';
  const minGutter = state === 'preset' ? 5 : 8;
  const minSplitConf = 60;

  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Page layout</h2>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>The layout model, how finely it segments, reading order, illustration detection, and when it offers a page split.</div>
      </div>

      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div></div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {state === 'modified' ? (<><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></>) : state === 'preset' ? (<Button variant="default" size="sm" icon="refresh">Reset to project default</Button>) : null}
        </div>
      </div>

      {state === 'modified' ? (
        <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Page layout and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>16 downstream stages</span> as stale.</span>
          <span style={{ flex: 1 }} /><Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button>
        </div>
      ) : null}

      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="sparkles" size={14} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Preset</span>
        <div style={{ flex: 1, maxWidth: 320, height: 28, padding: '0 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>{state === 'preset' ? 'Two-column journal' : state === 'modified' ? 'Layout-v4 (modified)' : 'Layout-v4 (built-in)'}</span>
          <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
        </div>
        <Button variant="default" size="sm" icon="plus">Save as preset…</Button>
        <span style={{ flex: 1 }} /><a style={{ fontSize: 11.5, color: 'var(--ink-3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Manage presets <Icon name="arrowR" size={11} /></a>
      </div>

      {/* ---- Page splitting section (the optional layout-driven split) ---- */}
      <div style={{ background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', border: '1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="scissors" size={15} style={{ color: 'var(--ocr)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Offer page splits from layout</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>When the detected columns or stacked blocks look like two pages, offer a split in the Page splits tab.</div>
          </div>
          <Toggle on={splitsOn} />
        </div>
        <SettingRow title="Split axis" sub="Which divisions to look for" control="segmented">
          <Segmented options={['Column', 'Row', 'Both']} activeIdx={2} />
        </SettingRow>
        <SettingRow title="Min gutter width" sub="A column/row gap narrower than this is not a split">
          <SettingSlider value={minGutter} min={2} max={20} unit=" mm" />
        </SettingRow>
        <SettingRow title="Min split score" sub="Below this the split is offered but flagged for review">
          <SettingSlider value={minSplitConf} min={0} max={100} unit="%" />
        </SettingRow>
        <SettingRow title="Auto-apply high-score splits" sub="Split without review when the score is very high (> 95%)" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Clear two-up scans split automatically; the rest wait for you.</div>
          <Toggle on={false} />
        </SettingRow>
      </div>

      {/* ---- Layout-detection controls ---- */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start' }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Segmentation granularity</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How deep the zone tree goes</div></div>
          <Segmented options={['Block', 'Paragraph', 'Line', 'Word']} activeIdx={granularityIdx} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start', borderTop: '1px solid var(--border-1)' }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Reading order</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How zones are linearised for OCR</div></div>
          <Segmented options={['Column-major', 'XY-cut', 'Manual']} activeIdx={orderIdx} />
        </div>
        <SettingRow title="Detect illustrations" sub="Tag image regions (cuts, plates, diagrams) so they're kept out of the text flow" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Detected regions forward to stage 13 · Illustrations. Missed ones can be boxed or lassoed by hand in the page editor.</div>
          <Toggle on={true} />
        </SettingRow>
        <SettingRow title="Detect tables" sub="Tag grid regions so they get structured handling downstream" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Tables forward as a region type, not flat text.</div>
          <Toggle on={true} />
        </SettingRow>
        <SettingRow title="Classify marginalia" sub="Separate running heads/feet, page numbers, side-notes from body" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Keeps headers and notes out of the body text flow.</div>
          <Toggle on={true} />
        </SettingRow>
        <SettingRow title="Re-run detection" sub="Clears current zones and re-detects with the settings above">
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="default" size="sm" icon="refresh">Re-detect all 387</Button>
            <Button variant="ghost" size="sm" icon="refresh">Re-detect flagged only · 16</Button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
};

Object.assign(window, {
  ZoneBox, ZonePageRender, ZoneThumb, ZnFlagChip, ZnStatusDot, ZoneCard, ZoneLegend,
  ZoneBanner, ZoneToolbar, ZoneBulkBar, ZonePages, ZoneOverview, ZoneStepSettings,
  ZnSettingSlider: SettingSlider, ZnSegmented: Segmented, ZnSettingRow: SettingRow,
});
