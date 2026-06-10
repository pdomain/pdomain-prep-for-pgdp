// scannocheck.jsx — Scannocheck stage (stage 12, OCR group) components.
// ScannoSuspects (the queue — the hero), ScannoPages (grid by suspect count),
// ScannoOverview, ScannoStepSettings, plus ScannoThumb / chips.

const { useState: useSSC } = React;

const ScTypeChip = ({ kind, size = 'sm' }) => { const f = SCANNO_TYPES[kind]; if (!f) return null; const d = size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 } : { h: 16, px: 6, fs: 9.5, dot: 4.5 }; return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: d.h, padding: `0 ${d.px}px`, borderRadius: 99, fontSize: d.fs, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)` }}><span style={{ width: d.dot, height: d.dot, borderRadius: 99, background: f.tone }} />{f.label}</span>; };
const ScStatusDot = ({ state, size = 8 }) => { const tone = state === 'clean' ? 'var(--exact)' : state === 'flagged' ? 'var(--fuzzy)' : state === 'reviewed' ? 'var(--ocr)' : state === 'running' ? 'var(--ocr)' : 'var(--mismatch)'; return <span style={{ width: size, height: size, borderRadius: 99, background: tone, boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none', animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none', display: 'inline-block', flex: '0 0 auto' }} />; };

/* ---------------------- ScannoThumb (page with suspect marks) ---------------------- */
const ScannoThumb = ({ row, w, h }) => {
  const ink = 'oklch(0.16 0 0)';
  const n = Math.min(row.suspects || 0, 5);
  const marks = Array.from({ length: n }, (_, i) => ({ x: (i * 37) % 70 + 16, y: (i * 53) % 64 + 18, stealth: (row.kinds || []).includes('stealth') && i === 0 }));
  return (
    <div style={{ width: w, height: h, position: 'relative', background: '#fff', border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '8%', left: '20%', right: '34%', height: 2.4, background: ink }} />
      <div style={{ position: 'absolute', inset: '15% 16% 16% 16%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.5px, transparent 1.5px 6px)`, opacity: 0.85 }} />
      {marks.map((m, i) => (
        <span key={i} style={{ position: 'absolute', top: `${m.y}%`, left: `${m.x}%`, width: '16%', height: 6, background: `color-mix(in oklab, ${m.stealth ? 'var(--fuzzy)' : 'var(--mismatch)'} 42%, transparent)`, borderBottom: `1.5px solid ${m.stealth ? 'var(--fuzzy)' : 'var(--mismatch)'}`, borderRadius: 1 }} />
      ))}
    </div>
  );
};

const SCANNO_DENSITY = { S: { col: 9, w: 96, h: 122, fs: 10 }, M: { col: 6, w: 140, h: 178, fs: 11 }, L: { col: 4, w: 200, h: 254, fs: 12.5 } };
const ScannoCard = ({ row, density = 'M', selected, hovered }) => {
  const cfg = SCANNO_DENSITY[density];
  const isRunning = row.state === 'running';
  const tone = row.suspects > 0 ? ((row.kinds || []).includes('stealth') ? 'var(--fuzzy)' : 'var(--mismatch)') : 'var(--exact)';
  return (
    <div style={{ position: 'relative', padding: 4, borderRadius: 6, background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'transparent', border: '1.5px solid ' + (selected ? 'var(--accent)' : hovered ? 'var(--border-3)' : 'transparent'), cursor: 'pointer', transition: 'border-color .12s, background .12s' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} /> : <ScannoThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />}
        {row.pageNumber != null ? <div style={{ position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4, background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><ScStatusDot state={row.state} size={6} />{row.pageNumber}</div> : null}
        {!isRunning && row.suspects > 0 && density !== 'S' ? <div className="mono" style={{ position: 'absolute', top: 6, right: 6, height: 18, padding: '0 6px', borderRadius: 99, background: `color-mix(in oklab, ${tone} 88%, black)`, color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{row.suspects}{(row.kinds || []).includes('stealth') ? ' ⚑' : ''}</div> : null}
        {!isRunning && row.state === 'reviewed' ? <div style={{ position: 'absolute', top: 6, left: 6, height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))', color: 'var(--ocr)', border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)', fontSize: 9.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="check" size={9} stroke={3} />ok</div> : null}
      </div>
      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? <span className="mono" style={{ fontSize: cfg.fs - 1, color: row.suspects > 0 ? tone : 'var(--ink-4)' }}>{row.suspects > 0 ? `${row.suspects} susp` : 'clean'}</span> : null}
      </div>
    </div>
  );
};

const ScannoBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}><span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>Scanning for scannos…<span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.done} / {totals.total} · {totals.rateHz}/s · {totals.suspects} suspects</span></div><div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} /></div></div>
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
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{totals.suspects} suspects on {flagged} pages{flagged > 0 ? <> · <span style={{ color: 'var(--fuzzy)' }}>{totals.stealth} stealth</span></> : <> · text clean</>}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{flagged > 0 ? <>Scannos are OCR errors. Ordinary ones fail the lexicon; <span style={{ color: 'var(--ink-1)' }}>stealth scannos</span> are real words in the wrong place — work the Suspects queue. Cleared text flows to Text review.</> : 'No scannos outstanding. Confirm to advance.'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['suspects', totals.suspects, 'var(--mismatch)'], ['stealth', totals.stealth, 'var(--fuzzy)'], ['pages flagged', totals.flagged, 'var(--fuzzy)'], ['reviewed', totals.reviewed, 'var(--ocr)']].filter(([_, n]) => n > 0).map(([k, n, color]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}><span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />{k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span></span>)}</div>
          </div>
        </div>
        {stale ? <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={12} />Settings changed — 10 downstream stages now stale</div> : null}
      </div>
    </div>
  );
};

/* ---------------------- Suspects queue (the hero) ---------------------- */
const ScannoSuspects = ({ filter = 'all' }) => {
  const list = filter === 'stealth' ? SCANNO_SUSPECTS.filter(s => s.type === 'stealth') : SCANNO_SUSPECTS;
  const filters = [
    { id: 'all', name: 'All', count: SCANNO_TOTALS_REVIEW.suspects },
    { id: 'stealth', name: 'Stealth', count: SCANNO_TOTALS_REVIEW.stealth, dot: 'var(--fuzzy)' },
    ...Object.entries(SCANNO_TYPE_COUNTS).filter(([k]) => k !== 'stealth').slice(0, 4).map(([k, n]) => ({ id: k, name: SCANNO_TYPES[k].label, count: n, dot: SCANNO_TYPES[k].tone })),
  ];
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>{filters.map(f => { const a = filter === f.id; return <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer' }}>{f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span></div>; })}</div>
        <span style={{ flex: 1 }} />
        <Button variant="default" size="sm" icon="check">Accept all dictionary fixes</Button>
        <Button variant="primary" size="sm" iconRight="arrowR">Send cleared to Text review</Button>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 120px 70px 150px', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)' }}>{['in context', 'fix', 'type', 'score', 'action'].map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)', textAlign: i === 3 ? 'right' : 'left' }}>{h}</span>)}</div>
        <div style={{ maxHeight: 620, overflow: 'auto' }}>
          {list.map((s, i) => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 120px 70px 150px', gap: 12, padding: '11px 16px', alignItems: 'center', borderTop: i === 0 ? 0 : '1px solid var(--border-1)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 13.5, color: 'var(--ink-1)' }}>
                  <span style={{ color: 'var(--ink-3)' }}>…{s.ctxL} </span>
                  <span style={{ padding: '1px 4px', borderRadius: 3, background: `color-mix(in oklab, ${SCANNO_TYPES[s.type].tone} 22%, transparent)`, boxShadow: `inset 0 -2px 0 ${SCANNO_TYPES[s.type].tone}`, fontWeight: 600 }}>{s.word}</span>
                  <span style={{ color: 'var(--ink-3)' }}> {s.ctxR}…</span>
                </div>
                <div className="mono" style={{ marginTop: 3, fontSize: 10.5, color: 'var(--ink-4)' }}>{s.page} · L{s.line} · {s.rule}{s.note ? ` · ${s.note}` : ''}</div>
              </div>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 13.5, color: 'var(--exact)', fontWeight: 600 }}>{s.fix}</span>
              <ScTypeChip kind={s.type} size="md" />
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: s.score >= 0.85 ? 'var(--fuzzy)' : 'var(--ink-2)', textAlign: 'right' }}>{Math.round(s.score * 100)}%</span>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <Button variant="primary" size="sm" icon="check">Fix</Button>
                <Button variant="ghost" size="sm">Keep</Button>
                <button style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-4)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} title="View on page"><Icon name="eye" size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ScannoPages = ({ state = 'review', density = 'M', filter = 'all', selected = [] }) => {
  const totals = state === 'running' ? SCANNO_TOTALS_RUNNING : state === 'done' ? SCANNO_TOTALS_DONE : SCANNO_TOTALS_REVIEW;
  const rows = state === 'running' ? SCANNO_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, suspects: undefined }) : SCANNO_ROWS;
  const filtered = filter === 'flagged' ? rows.filter(r => r.state === 'flagged') : filter === 'clean' ? rows.filter(r => r.state === 'clean') : filter === 'stealth' ? rows.filter(r => (r.kinds || []).includes('stealth')) : rows;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}><ScannoBanner state={state} totals={totals} /></div>
        <div style={{ flex: '0 0 auto' }}><Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running'}>Confirm and advance · {totals.total} pages</Button></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {[['all', 'All', totals.total], ['flagged', 'Flagged', totals.flagged], ['stealth', 'Stealth pages', totals.stealth ? 5 : 0], ['clean', 'Clean', totals.clean]].map(([id, name, n]) => { const a = filter === id; return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', border: '1px solid ' + (a ? 'var(--border-2)' : 'transparent'), fontSize: 12, fontWeight: a ? 600 : 500, color: a ? 'var(--ink-1)' : 'var(--ink-3)', cursor: 'pointer' }}>{name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{n}</span></span>; })}
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: `repeat(${SCANNO_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => <ScannoCard key={r.idx} row={r} density={density} hovered={i === 3 && state !== 'running'} />)}
      </div>
    </div>
  );
};

const ScannoOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? SCANNO_TOTALS_RUNNING : state === 'done' ? SCANNO_TOTALS_DONE : SCANNO_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ScannoBanner state={state} totals={totals} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[{ label: 'pages', value: totals.total, tone: 'ink-1' }, { label: 'checked', value: `${totals.done}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' }, { label: 'suspects', value: totals.suspects, tone: 'mismatch' }, { label: 'stealth', value: totals.stealth, tone: 'fuzzy', sub: 'real-word errors' }, { label: 'pages flagged', value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2' }, { label: 'clean', value: totals.clean, tone: 'exact' }].map((s, i) => <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}><div className="label" style={{ color: 'var(--ink-3)' }}>{s.label}</div><div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${s.tone})`, letterSpacing: '-0.01em' }}>{s.value}</div>{s.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{s.sub}</div> : null}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Scanno types</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Object.entries(SCANNO_TYPE_COUNTS).map(([k, n]) => { const f = SCANNO_TYPES[k]; const max = Math.max(...Object.values(SCANNO_TYPE_COUNTS)); return <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 36px', gap: 10, alignItems: 'center' }}><ScTypeChip kind={k} size="md" /><div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} /></div><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span></div>; })}</div>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>Why stealth scannos matter</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>A plain spellcheck only catches words that aren't in the dictionary. A <span style={{ color: 'var(--fuzzy)' }}>stealth scanno</span> — <span style={{ fontFamily: 'Georgia, serif' }}>arid</span> for <span style={{ fontFamily: 'Georgia, serif' }}>and</span>, <span style={{ fontFamily: 'Georgia, serif' }}>be</span> for <span style={{ fontFamily: 'Georgia, serif' }}>he</span> — is a real word, so it sails past. Wordcheck adds a curated stealth list + context so the proofer sees them before they reach the page.</div>
        </div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div></div>
        {[['1 min ago', 'Scanno scan completed', '387 pages · 146 suspects · 31 stealth'], ['1 min ago', 'Stage started', 'lexicon: eng + custom · stealth list v3'], ['5 min ago', 'Hyphen join confirmed', '387 pages forwarded']].map((r, i) => <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center' }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r[0]}</span><span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{r[1]}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r[2]}</span></div>)}
      </div>
    </div>
  );
};

const ScRow = ({ title, sub, children, control }) => <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: control === 'seg' ? 'flex-start' : 'center', borderTop: '1px solid var(--border-1)' }}><div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div></div>{children}</div>;
const ScSeg = ({ options, activeIdx }) => <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7, flexWrap: 'wrap' }}>{options.map((o, i) => { const a = i === activeIdx; return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>; })}</div>;
const ScSlider = ({ value, min, max, unit = '' }) => { const p = (value - min) / (max - min); return <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 360 }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{min}{unit}</span><div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}><div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 99, background: 'var(--accent)' }} /><div style={{ position: 'absolute', left: `calc(${p * 100}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: 99, background: 'var(--bg-surface)', border: '2px solid var(--accent)' }} /></div><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{max}{unit}</span><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 40, textAlign: 'right' }}>{value}{unit}</span></div>; };

const ScannoStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? { tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 2 changes vs project default', sub: 'Save these as the project default, or revert to inherit.' } : state === 'preset' ? { tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Pre-1920 prose', sub: 'Loaded from a saved preset; not the project default.' } : { tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · eng + custom lexicon', sub: 'Changes here can be saved back as the project default for Wordcheck.' };
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Wordcheck</h2><div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>The lexicon, which scanno rule-sets run, the stealth-word list, and what auto-clears.</div></div>
      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div></div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>{state === 'modified' ? <><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></> : state === 'preset' ? <Button variant="default" size="sm" icon="refresh">Reset to project default</Button> : null}</div>
      </div>
      {state === 'modified' ? <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Wordcheck and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>10 downstream stages</span> as stale.</span><span style={{ flex: 1 }} /><Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button></div> : null}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <ScRow title="Lexicon" sub="Dictionary + project word-list a word is checked against" control="seg"><ScSeg options={['English', 'English + custom', 'Custom only']} activeIdx={1} /></ScRow>
        <ScRow title="Scanno rule-sets" sub="Pattern families that flag ordinary scannos">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{['Common substitutions', 'Split / joined words', 'Punctuation', 'Long-s / ligatures'].map((r, i) => <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: 7, background: i < 3 ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (i < 3 ? 'var(--accent)' : 'var(--border-1)'), color: 'var(--ink-1)', fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>{r}{i < 3 ? <Icon name="check" size={10} stroke={3} style={{ color: 'var(--accent)' }} /> : null}</span>)}</div>
        </ScRow>
        <ScRow title="Stealth-word list" sub="Real words commonly produced by scannos — checked in context" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Curated list (arid/and, be/he, tho/the…) · <a style={{ color: 'var(--accent)' }}>edit list · 214 entries</a>.</div><Toggle on={true} /></ScRow>
        <ScRow title="Auto-clear above score" sub="Tokens the OCR scored above this skip the queue when the lexicon agrees"><ScSlider value={state === 'modified' ? 99 : 98} min={90} max={100} unit="%" /></ScRow>
        <ScRow title="Flag dictionary misses" sub="Queue words not in the lexicon (names, archaisms) for a glance" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Off keeps proper nouns out of the queue.</div><Toggle on={state !== 'default'} /></ScRow>
        <ScRow title="Re-run scanno check" sub="Clears decisions and re-scans with the settings above"><div style={{ display: 'flex', gap: 8 }}><Button variant="default" size="sm" icon="refresh">Re-check all 387</Button><Button variant="ghost" size="sm" icon="refresh">Re-check flagged · 16</Button></div></ScRow>
      </div>
    </div>
  );
};

/* ---------------------- Word-list builder ----------------------
   Ranked good/bad word recommendations with the evidence behind each; the
   human accepts/rejects, writing the per-book lists, and confirmed entries
   promote to the shared library. Recommendations are review aids, not edits.
*/
const ScannoListBuilder = ({ filter = 'all' }) => {
  const list = filter === 'good' ? LIST_CANDIDATES.filter(c => c.list === 'good')
    : filter === 'bad' ? LIST_CANDIDATES.filter(c => c.list === 'bad')
    : LIST_CANDIDATES;
  const chips = [
    { id: 'all',  name: 'All',        count: LIST_TOTALS.good + LIST_TOTALS.bad },
    { id: 'good', name: 'Good words', count: LIST_TOTALS.good, dot: 'var(--exact)' },
    { id: 'bad',  name: 'Bad words',  count: LIST_TOTALS.bad,  dot: 'var(--mismatch)' },
  ];
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, var(--ocr) 28%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="fileText" size={14} style={{ color: 'var(--ocr)' }} />
        <div style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-3)' }}>Auto-recommended from frequency · OCR score · edit-distance · NER / gazetteer · stealth context. <span style={{ color: 'var(--ink-2)' }}>Recommendations are review aids — a human decides; accepted entries write the per-book lists.</span></div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>book {LIST_TOTALS.bookGood} good · {LIST_TOTALS.bookBad} bad · library {LIST_TOTALS.libraryGood}/{LIST_TOTALS.libraryBad}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>{chips.map(f => { const a = filter === f.id; return <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer' }}>{f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span></div>; })}</div>
        <span style={{ flex: 1 }} />
        <Button variant="default" size="sm" icon="check">Accept all high-confidence</Button>
        <Button variant="default" size="sm" icon="swap">Promote confirmed → library</Button>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 70px 190px', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)' }}>{['candidate', 'evidence', 'rank', 'decision'].map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)', textAlign: i === 2 ? 'right' : 'left' }}>{h}</span>)}</div>
        <div style={{ maxHeight: 600, overflow: 'auto' }}>
          {list.map((c, i) => { const good = c.list === 'good'; const tone = good ? 'var(--exact)' : (c.stealth ? 'var(--fuzzy)' : 'var(--mismatch)'); return (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 70px 190px', gap: 12, padding: '11px 16px', alignItems: 'center', borderTop: i === 0 ? 0 : '1px solid var(--border-1)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: tone, flex: '0 0 auto' }} />
                  <span style={{ fontFamily: 'Georgia, serif', fontSize: 14, color: 'var(--ink-1)', fontWeight: 600 }}>{c.token}</span>
                  {!good ? <><Icon name="arrowR" size={11} style={{ color: 'var(--ink-4)' }} /><span style={{ fontFamily: 'Georgia, serif', fontSize: 13.5, color: 'var(--exact)', fontWeight: 600 }}>{c.fix}</span></> : null}
                </div>
                <div className="mono" style={{ marginTop: 3, fontSize: 10, color: 'var(--ink-4)' }}>{good ? 'good · stop flagging' : (c.stealth ? 'bad · stealth' : 'bad · ' + c.rule)}{c.note ? ` · ${c.note}` : ''}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{c.ev.map((e, j) => <span key={j} className="mono" style={{ height: 18, padding: '0 6px', borderRadius: 4, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', color: 'var(--ink-3)', fontSize: 9.5, display: 'inline-flex', alignItems: 'center' }}>{e}</span>)}</div>
              <div style={{ textAlign: 'right' }}><span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: c.rank >= 0.8 ? tone : 'var(--ink-2)' }}>{Math.round(c.rank * 100)}</span></div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <Button variant="primary" size="sm" icon="check">{good ? 'Add good' : 'Add bad'}</Button>
                <Button variant="ghost" size="sm">{good ? 'Skip' : 'Keep'}</Button>
                <button style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-4)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} title="defer · book-only · promote"><Icon name="moreH" size={13} /></button>
              </div>
            </div>
          ); })}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ScTypeChip, ScStatusDot, ScannoThumb, ScannoCard, ScannoBanner, ScannoSuspects, ScannoListBuilder, ScannoPages, ScannoOverview, ScannoStepSettings });
