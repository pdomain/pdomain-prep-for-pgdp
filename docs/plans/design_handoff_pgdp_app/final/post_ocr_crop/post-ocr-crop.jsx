// post-ocr-crop.jsx — Post-OCR crop (stage 13, Compose group) components.
// Content-aware: crops to the true content extent (text-block ∪ kept
// marginalia ∪ illustration) now that OCR + layout are known. Protects
// sidenotes in the outer margin and decides keep/drop on stray folio marks.
// Same grid + flag-review + editor pattern, with content overlays.

const { useState: useSPO } = React;

/* ---------------------- ContentThumb ---------------------- */
const ContentThumb = ({ row, w, h }) => {
  const cb = row.contentBox || { t:.12, r:.16, b:.13, l:.16 };
  const cr = row.crop || { t:.09, r:.12, b:.10, l:.12 };
  const ink = 'oklch(0.16 0 0)';
  const tight = (row.flags || []).includes('contentTight');
  const clip = (row.flags || []).includes('marginaliaClip');
  const cropColor = tight ? 'var(--mismatch)' : 'var(--accent)';
  return (
    <div style={{ width: w, height: h, position: 'relative', background: '#fff', border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden' }}>
      {/* content */}
      {row.illust ? (
        <div style={{ position: 'absolute', top: (cb.t*100)+'%', left: (cb.l*100)+'%', right: (cb.r*100)+'%', bottom: (cb.b*100)+'%', background: '#111', opacity: 0.14, borderRadius: 2 }}>
          <div style={{ position: 'absolute', inset: 6, border: '1px solid #111', opacity: 0.3 }} />
        </div>
      ) : (
        <>
          <div style={{ position: 'absolute', top: (cb.t*100)+'%', left: (cb.l*100)+'%', right: (cb.r*100)+'%', bottom: (cb.b*100)+'%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.4px, transparent 1.4px 6px)`, opacity: 0.85 }} />
          <div style={{ position: 'absolute', top: `calc(${cb.t*100}% - 1%)`, left: (cb.l*100)+'%', width: '32%', height: 2.4, background: ink }} />
        </>
      )}
      {/* sidenote block in the outer margin */}
      {row.sidenote ? (
        <div style={{ position: 'absolute', top: '22%', bottom: '30%', [row.sidenote === 'L' ? 'left' : 'right']: '4%', width: '9%', background: clip ? 'color-mix(in oklab, var(--fuzzy) 32%, transparent)' : 'oklch(0.16 0 0 / 0.5)', border: clip ? '1px solid var(--fuzzy)' : 'none', borderRadius: 1 }}>
          <div style={{ position: 'absolute', inset: '8% 14%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1px, transparent 1px 4px)`, opacity: 0.6 }} />
        </div>
      ) : null}
      {/* stray mark */}
      {row.stray ? (
        <span style={{ position: 'absolute', [row.stray.includes('b') ? 'bottom' : 'top']: '5%', [row.stray.includes('r') ? 'right' : 'left']: '8%', width: 5, height: 5, borderRadius: 99, background: 'var(--gt)', boxShadow: '0 0 0 2px color-mix(in oklab, var(--gt) 30%, transparent)' }} />
      ) : null}
      {/* content bbox (faint) */}
      <div style={{ position: 'absolute', top: (cb.t*100)+'%', left: (cb.l*100)+'%', right: (cb.r*100)+'%', bottom: (cb.b*100)+'%', border: '1px dashed color-mix(in oklab, var(--ocr) 60%, transparent)', pointerEvents: 'none' }} />
      {/* proposed crop */}
      <div style={{ position: 'absolute', top: (cr.t*100)+'%', left: (cr.l*100)+'%', right: (cr.r*100)+'%', bottom: (cr.b*100)+'%', border: `1.5px solid ${cropColor}`, boxShadow: `0 0 0 1px color-mix(in oklab, ${cropColor} 30%, transparent)`, pointerEvents: 'none' }} />
    </div>
  );
};

const PocFlagChip = ({ kind, size = 'sm' }) => {
  const f = POC_FLAGS[kind]; if (!f) return null;
  const d = size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 } : { h: 16, px: 6, fs: 9.5, dot: 4.5 };
  return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: d.h, padding: `0 ${d.px}px`, borderRadius: 99, fontSize: d.fs, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)` }}><span style={{ width: d.dot, height: d.dot, borderRadius: 99, background: f.tone }} />{f.label}</span>;
};
const PocStatusDot = ({ state, size = 8 }) => {
  const tone = state === 'clean' ? 'var(--exact)' : state === 'flagged' ? 'var(--fuzzy)' : state === 'reviewed' ? 'var(--ocr)' : state === 'running' ? 'var(--ocr)' : 'var(--mismatch)';
  return <span style={{ width: size, height: size, borderRadius: 99, background: tone, boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none', animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none', display: 'inline-block', flex: '0 0 auto' }} />;
};

const POC_DENSITY = { S: { col: 9, w: 96, h: 122, fs: 10, flagMax: 1, flagSize: 'sm' }, M: { col: 6, w: 140, h: 178, fs: 11, flagMax: 2, flagSize: 'sm' }, L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' } };

const PocCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = POC_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).slice(0, cfg.flagMax);
  const extra = (row.flags || []).length - flags.length;
  return (
    <div style={{ position: 'relative', padding: 4, borderRadius: 6, background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : expanded ? 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' : 'transparent', border: '1.5px solid ' + (selected ? 'var(--accent)' : expanded ? 'var(--ocr)' : hovered ? 'var(--border-3)' : 'transparent'), cursor: 'pointer', transition: 'border-color .12s, background .12s' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} /> : <ContentThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />}
        {!isRunning ? <div style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 4, background: selected ? 'var(--accent)' : 'rgba(12,12,16,0.78)', border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(240,240,242,0.40)'), display: 'grid', placeItems: 'center', color: selected ? 'var(--accent-ink)' : 'transparent' }}><Icon name="check" size={11} stroke={3} /></div> : null}
        {row.pageNumber != null ? <div style={{ position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4, background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><PocStatusDot state={row.state} size={6} />{row.pageNumber}</div> : null}
        {!isRunning && row.side && density !== 'S' ? <div className="mono" style={{ position: 'absolute', bottom: 6, right: 6, height: 16, padding: '0 5px', borderRadius: 3, background: 'rgba(12,12,16,0.72)', color: 'rgba(240,240,242,0.85)', fontSize: 9.5, fontWeight: 600 }}>{row.side === 'verso' ? 'L' : 'R'}</div> : null}
        {flags.length > 0 ? <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>{flags.map(k => <PocFlagChip key={k} kind={k} size={cfg.flagSize} />)}{extra > 0 ? <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(12,12,16,0.85)', color: '#f0f0f2' }}>+{extra}</span> : null}</div> : row.state === 'reviewed' ? <div style={{ position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4, height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))', color: 'var(--ocr)', border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)', fontSize: 9.5, fontWeight: 600 }}><Icon name="check" size={9} stroke={3} />reviewed</div> : null}
      </div>
      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? <span className="mono" style={{ fontSize: cfg.fs - 1, color: 'var(--ink-4)' }}>{row.state === 'clean' ? 'fit' : row.state === 'flagged' ? `${row.flags.length} flag${row.flags.length > 1 ? 's' : ''}` : row.state === 'reviewed' ? 'ok·rv' : row.state}</span> : null}
      </div>
    </div>
  );
};

const PocBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.cropped / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}><span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>Cropping to content…<span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.cropped} / {totals.total} · {totals.rateHz}/s · {totals.flagged} flagged</span></div><div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} /></div></div>
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
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{totals.cropped} pages cropped to content{flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed</> : <> · all fit</>}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{flagged > 0 ? 'Most flags are sidenote-clips and stray folio marks — decide what counts as content. Canvas map then normalises everyone to one canvas.' : 'Every page cropped to its true content extent. Confirm to advance to Canvas map.'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['fit', totals.clean, 'var(--exact)'], ['flagged', totals.flagged, 'var(--fuzzy)'], ['reviewed', totals.reviewed, 'var(--ocr)']].filter(([_, n]) => n > 0).map(([k, n, color]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}><span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />{k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span></span>)}</div>
          </div>
        </div>
        {stale ? <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={12} />Settings changed — 13 downstream stages now stale</div> : null}
      </div>
    </div>
  );
};

const PocToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [{ id: 'all', name: 'All', count: totals.total }, { id: 'flagged', name: 'Flagged', count: totals.flagged, dot: 'var(--fuzzy)' }, { id: 'clean', name: 'Fit', count: totals.clean, dot: 'var(--exact)' }, { id: 'reviewed', name: 'Reviewed', count: totals.reviewed, dot: 'var(--ocr)' }, ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : [])];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>{chips.map(f => { const a = filter === f.id; return <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer' }}>{f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span></div>; })}</div>
      <Divider vertical style={{ height: 22 }} />
      {filter === 'flagged' ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{Object.entries(POC_FLAG_COUNTS).slice(0, 4).map(([k, n]) => { const f = POC_FLAGS[k]; return <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 99, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)', fontSize: 11, cursor: 'pointer' }}><span style={{ width: 5, height: 5, borderRadius: 99, background: f.tone }} />{f.label}<span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span></span>; })}</div> : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-3)' }}><span style={{ width: 10, height: 10, borderRadius: 2, border: '1px dashed color-mix(in oklab, var(--ocr) 60%, transparent)' }} />content bbox</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-3)' }}><span style={{ width: 10, height: 10, borderRadius: 2, border: '1.5px solid var(--accent)' }} />crop</span>
        </div>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="default" size="sm" icon="refresh">Re-crop with new rule</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>Density<div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>{['S', 'M', 'L'].map(d => { const a = density === d; return <div key={d} style={{ padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)' }}>{d}</div>; })}</div></div>
      </div>
    </div>
  );
};

const PocBulkBar = ({ count }) => (
  <div style={{ position: 'sticky', bottom: 12, marginTop: 12, zIndex: 5, padding: '10px 14px', borderRadius: 10, background: 'var(--ink-1)', color: 'var(--bg-page)', boxShadow: '0 12px 28px rgba(15,23,42,.22), 0 2px 6px rgba(15,23,42,.10)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{count} selected</span>
    <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    {[{ id: 'keepside', name: 'Keep sidenotes', icon: 'check' }, { id: 'dropstray', name: 'Drop stray marks', icon: 'trash' }, { id: 'retight', name: 'Re-fit content', icon: 'refresh' }, { id: 'accept', name: 'Accept as-is', icon: 'check' }].map(b => <button key={b.id} style={{ height: 26, padding: '0 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--bg-page) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--bg-page) 22%, transparent)', color: 'var(--bg-page)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}><Icon name={b.icon} size={11} />{b.name}</button>)}
    <span style={{ flex: 1 }} /><span className="mono" style={{ fontSize: 10.5, color: 'color-mix(in oklab, var(--bg-page) 55%, transparent)' }}><KeyCap>esc</KeyCap> clear</span>
  </div>
);

/* ---------------------- Inline content editor ---------------------- */
const PocEditor = ({ row }) => {
  const clip = (row.flags || []).includes('marginaliaClip');
  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)', background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden', animation: 'pgd-slide-up .18s ease-out' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))' }}>
        <Icon name="scissors" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Crop to content · {row.prefix}.tif</span>
        {(row.flags || []).map(k => <PocFlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.side} · text-block + {row.sidenote ? '1 sidenote' : '0 sidenotes'}</span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={13} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 0 }}>
        <div style={{ padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)', minHeight: 420, display: 'grid', placeItems: 'center' }}>
          <ContentThumb row={row} w={300} h={424} />
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {clip ? (
            <div style={{ padding: '10px 12px', borderRadius: 7, border: '1px solid color-mix(in oklab, var(--fuzzy) 40%, var(--border-1))', background: 'color-mix(in oklab, var(--fuzzy) 6%, var(--bg-surface))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Icon name="alert" size={13} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>Sidenote in the {row.side === 'verso' ? 'left' : 'right'} margin</span></div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>The crop would clip it. Keep it and Canvas map will widen this page's <span style={{ color: 'var(--ink-1)' }}>outer margin</span> (mirrored across the spread).</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}><Button variant="primary" size="sm" icon="check">Keep sidenote</Button><Button variant="default" size="sm" icon="trash">Drop</Button></div>
            </div>
          ) : null}
          <div><div className="label" style={{ color: 'var(--ink-3)', marginBottom: 7 }}>Crop to</div><PocSeg options={['Text block', 'Text + sidenotes', 'All content']} activeIdx={row.sidenote ? 1 : 0} /></div>
          <div><div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Content padding</div><PocSlider value={18} min={0} max={60} unit="px" /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', cursor: 'pointer' }}><Toggle on={true} /><span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-1)' }}>Keep folio / page number</span></label>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><Button variant="ghost" size="sm">Cancel</Button><Button variant="default" size="sm" icon="check">Accept</Button><Button variant="primary" size="sm" icon="scissors">Re-crop</Button></div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Settings primitives ---------------------- */
const PocSlider = ({ value, min, max, unit = '', pct }) => {
  const p = pct != null ? pct : (value - min) / (max - min);
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 360 }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{min}{unit}</span><div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}><div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 99, background: 'var(--accent)' }} /><div style={{ position: 'absolute', left: `calc(${p * 100}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: 99, background: 'var(--bg-surface)', border: '2px solid var(--accent)' }} /></div><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{max}{unit}</span><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 40, textAlign: 'right' }}>{value}{unit}</span></div>;
};
const PocSeg = ({ options, activeIdx }) => <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7, flexWrap: 'wrap' }}>{options.map((o, i) => { const a = i === activeIdx; return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>; })}</div>;
const PocRow = ({ title, sub, children, control }) => <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: control === 'seg' ? 'flex-start' : 'center', borderTop: '1px solid var(--border-1)' }}><div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div></div>{children}</div>;

/* ---------------------- Pages / Overview / Settings ---------------------- */
const PocPages = ({ state = 'review', density = 'M', filter = 'all', selected = [], editing = null, stale = false }) => {
  const totals = state === 'running' ? POC_TOTALS_RUNNING : state === 'done' ? POC_TOTALS_DONE : POC_TOTALS_REVIEW;
  const rows = state === 'running' ? POC_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined }) : POC_ROWS;
  const filtered = filter === 'flagged' ? rows.filter(r => r.state === 'flagged') : filter === 'clean' ? rows.filter(r => r.state === 'clean') : filter === 'reviewed' ? rows.filter(r => r.state === 'reviewed') : filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) : rows;
  const editingRow = editing != null ? POC_ROWS.find(r => r.idx === editing) : null;
  const hasSel = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}><PocBanner state={state} totals={totals} stale={stale} /></div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}><Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running' || !canAdvance}>Confirm and advance · {totals.total} pages</Button>{state !== 'running' && !canAdvance ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{totals.flagged - totals.reviewed} flagged pages still need review</span> : null}</div>
      </div>
      <PocToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${POC_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => <PocCard key={r.idx} row={r} density={density} selected={selected.includes(r.idx)} hovered={i === 4 && state !== 'running' && !hasSel && editing == null} expanded={editing === r.idx} />)}
      </div>
      {editingRow ? <PocEditor row={editingRow} /> : null}
      {hasSel ? <PocBulkBar count={selected.length} /> : null}
    </div>
  );
};

const PocOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? POC_TOTALS_RUNNING : state === 'done' ? POC_TOTALS_DONE : POC_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PocBanner state={state} totals={totals} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[{ label: 'pages', value: totals.total, tone: 'ink-1' }, { label: 'cropped', value: `${totals.cropped}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' }, { label: 'fit', value: totals.clean, tone: 'exact' }, { label: 'flagged', value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' }, { label: 'sidenotes', value: '31', tone: 'fuzzy', sub: 'kept · → canvas' }, { label: 'avg trim', value: totals.avgTrim, tone: 'ink-1', sub: 'vs post-transform' }].map((s, i) => <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}><div className="label" style={{ color: 'var(--ink-3)' }}>{s.label}</div><div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${s.tone})`, letterSpacing: '-0.01em' }}>{s.value}</div>{s.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{s.sub}</div> : null}</div>)}
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>Content-aware, not edge-aware</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>The two earlier crops worked from page <span style={{ color: 'var(--ink-1)' }}>edges</span>. Now that OCR and layout are done, this pass crops to the actual <span style={{ color: 'var(--ink-1)' }}>content</span> — the text-block plus any kept sidenotes and illustration zones — so dead margin is trimmed precisely without ever clipping real ink. Sidenote-bearing pages forward their outer-margin needs to <span className="mono">Canvas map</span>, which mirrors margins across facing pages.</div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Flag distribution</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Object.entries(POC_FLAG_COUNTS).map(([k, n]) => { const f = POC_FLAGS[k]; const max = Math.max(...Object.values(POC_FLAG_COUNTS)); return <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 36px', gap: 10, alignItems: 'center' }}><PocFlagChip kind={k} size="md" /><div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} /></div><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span></div>; })}</div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div></div>
        {[['2 min ago', 'Content crop completed', '387 pages · 19 flagged · 31 sidenotes kept'], ['2 min ago', 'Stage started', 'crop to: text + sidenotes · pad 18px'], ['5 min ago', 'Page order confirmed', '387 pages forwarded']].map((r, i) => <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center' }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r[0]}</span><span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{r[1]}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r[2]}</span></div>)}
      </div>
    </div>
  );
};

const PocStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? { tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 2 changes vs project default', sub: 'Save these as the project default, or revert to inherit.' } : state === 'preset' ? { tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Annotated edition', sub: 'Loaded from a saved preset; not the project default.' } : { tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · Text + sidenotes', sub: 'Changes here can be saved back as the project default for Post-OCR crop.' };
  const cropToIdx = state === 'preset' ? 2 : state === 'modified' ? 0 : 1;
  const pad = state === 'modified' ? 8 : 18;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Post-OCR crop</h2><div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>What counts as content, how much padding to keep, and how stray marks and sidenotes are handled.</div></div>
      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div></div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>{state === 'modified' ? <><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></> : state === 'preset' ? <Button variant="default" size="sm" icon="refresh">Reset to project default</Button> : null}</div>
      </div>
      {state === 'modified' ? <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Post-OCR crop and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>13 downstream stages</span> as stale.</span><span style={{ flex: 1 }} /><Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button></div> : null}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start' }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Crop to</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>What the crop box encloses</div></div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[{ id: 'text', name: 'Text block', sub: 'body only' }, { id: 'side', name: 'Text + sidenotes', sub: 'incl. marginalia' }, { id: 'all', name: 'All content', sub: 'text + illustration' }].map((opt, i) => { const a = i === cropToIdx; return <div key={opt.id} style={{ minWidth: 150, flex: 1, padding: '8px 12px', borderRadius: 7, background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (a ? 'var(--accent)' : 'var(--border-1)'), cursor: 'pointer' }}><div style={{ fontSize: 12, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{opt.name}</div><div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)' }}>{opt.sub}</div></div>; })}</div>
        </div>
        <PocRow title="Content padding" sub="Whitespace kept around the content box"><PocSlider value={pad} min={0} max={60} unit="px" /></PocRow>
        <PocRow title="Keep marginalia / sidenotes" sub="Never crop into a detected sidenote; forward margin need to Canvas map" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Pages with sidenotes flag for review when the crop would clip them.</div><Toggle on={true} /></PocRow>
        <PocRow title="Keep folio / page numbers" sub="Treat an isolated number in the margin as content, not a stray mark" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Off drops stray marks as noise.</div><Toggle on={state !== 'modified'} /></PocRow>
        <PocRow title="Min margin guard" sub="Flag pages where content sits too close to a crop edge" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Catches content-tight crops before they reach proofers.</div><Toggle on={true} /></PocRow>
        <PocRow title="Re-run content crop" sub="Clears current crops and re-runs with the settings above"><div style={{ display: 'flex', gap: 8 }}><Button variant="default" size="sm" icon="refresh">Re-crop all 387</Button><Button variant="ghost" size="sm" icon="refresh">Re-crop flagged · 19</Button></div></PocRow>
      </div>
    </div>
  );
};

Object.assign(window, { ContentThumb, PocFlagChip, PocStatusDot, PocCard, PocBanner, PocToolbar, PocBulkBar, PocEditor, PocPages, PocOverview, PocStepSettings });
