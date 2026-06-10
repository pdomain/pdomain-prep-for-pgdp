// page-order.jsx — Page order stage (stage 11) content components.
// PoSequence (the hero: scan order vs OCR'd folio, with out-of-sequence
// detection + proposed reorder), PoPages (grid), PoOverview, PoStepSettings.

const { useState: useSPGO } = React;

/* ---------------------- mini page glyph + chips ---------------------- */
const PoMini = ({ w = 30, h = 40, dim }) => (
  <div style={{ width: w, height: h, borderRadius: 2, background: '#fff', boxShadow: 'inset 0 0 0 1px rgba(40,40,40,0.18)', position: 'relative', opacity: dim ? 0.5 : 1, flex: '0 0 auto' }}>
    <div style={{ position: 'absolute', inset: '16% 18%', backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.2 0 0) 0 1px, transparent 1px 4px)', opacity: 0.5 }} />
  </div>
);
const PoFlagChip = ({ kind, size = 'sm' }) => { const f = PO_FLAGS[kind]; if (!f) return null; const d = size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 } : { h: 16, px: 6, fs: 9.5, dot: 4.5 }; return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: d.h, padding: `0 ${d.px}px`, borderRadius: 99, fontSize: d.fs, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)` }}><span style={{ width: d.dot, height: d.dot, borderRadius: 99, background: f.tone }} />{f.label}</span>; };

const PoBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.scanned / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}><span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>Reading folios…<span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.scanned} / {totals.total} · {totals.rateHz}/s</span></div><div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} /></div></div>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ocr)', flex: '0 0 auto' }}>{pct}%</span>
      </div>
    );
  }
  const issues = totals.outOfSeq + totals.dupes;
  const tone = issues > 0 ? 'var(--fuzzy)' : 'var(--exact)';
  return (
    <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, ' + tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + tone + ' 7%, var(--bg-surface))', display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
      <div style={{ width: 4, background: tone }} />
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))', color: tone, display: 'grid', placeItems: 'center' }}><Icon name={issues > 0 ? 'alert' : 'checkCircle'} size={15} /></div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{totals.numbered} of {totals.total} pages numbered{issues > 0 ? <> · <span style={{ color: tone }}>{totals.outOfSeq} out of sequence</span>{totals.dupes ? `, ${totals.dupes} duplicate` : ''}</> : <> · sequence verified</>}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{issues > 0 ? <>Detected from OCR folios. Open <span style={{ color: 'var(--ink-1)' }}>Sequence</span> to review the proposed reorder; {totals.gaps} gaps and {totals.missing} unnumbered pages noted.</> : 'Scans are in printed-page order. Confirm to advance to Spellcheck.'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['out-of-seq', totals.outOfSeq, 'var(--mismatch)'], ['gaps', totals.gaps, 'var(--ocr)'], ['duplicates', totals.dupes, 'var(--mismatch)'], ['no folio', totals.missing, 'var(--fuzzy)']].filter(([_, n]) => n > 0).map(([k, n, color]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}><span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />{k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span></span>)}</div>
          </div>
        </div>
        {stale ? <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={12} />Settings changed — 14 downstream stages now stale</div> : null}
      </div>
    </div>
  );
};

/* ---------------------- Sequence tab (the hero) ---------------------- */
const PoSequence = () => {
  const folioTone = (r) => r.state === 'reviewed' ? 'var(--ocr)' : (r.flags || []).length ? PO_FLAGS[r.flags[0]].tone : 'var(--exact)';
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      {/* sequence strip */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Folio sequence · scan order</div>
          <div style={{ display: 'flex', gap: 6 }}><Button variant="default" size="sm" icon="swap">Sort by folio</Button><Button variant="primary" size="sm" icon="check">Apply detected order</Button></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 46 }}>
          {PO_ROWS.map(r => { const issue = (r.flags || []).some(f => f !== 'nonNumeric'); const n = r.kind === 'arabic' ? parseInt(r.folio) || 0 : 0; return (
            <div key={r.scan} title={`scan ${r.scan} · folio ${r.folio || '—'}`} style={{ flex: 1, height: `${20 + n * 4.5}%`, minHeight: 6, borderRadius: '2px 2px 0 0', background: issue ? folioTone(r) : 'color-mix(in oklab, var(--ocr) 35%, var(--bg-sunk))', opacity: issue ? 1 : 0.8 }} />
          ); })}
        </div>
        <div className="mono" style={{ marginTop: 6, fontSize: 10, color: 'var(--ink-4)' }}>bar height = folio number · coloured = needs attention · a dip means a scan sits out of order</div>
      </div>
      {/* sequence list */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '70px 48px 1fr 110px 1fr 120px', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)' }}>
          {['scan', '', 'page', 'folio (OCR)', 'status', 'action'].map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)' }}>{h}</span>)}
        </div>
        <div style={{ maxHeight: 560, overflow: 'auto' }}>
          {PO_ROWS.map((r, i) => {
            const issue = (r.flags || []).some(f => f !== 'nonNumeric');
            const tone = folioTone(r);
            return (
              <div key={r.scan} style={{ display: 'grid', gridTemplateColumns: '70px 48px 1fr 110px 1fr 120px', gap: 12, padding: '8px 16px', alignItems: 'center', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', background: issue ? `color-mix(in oklab, ${tone} 5%, transparent)` : 'transparent' }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>#{String(r.scan).padStart(2, '0')}</span>
                <PoMini />
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.prefix}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ minWidth: 30, height: 24, padding: '0 8px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: r.folio ? (issue ? tone : 'var(--ink-1)') : 'var(--ink-4)', background: issue ? `color-mix(in oklab, ${tone} 12%, var(--bg-surface))` : 'var(--bg-raised)', border: `1px solid ${issue ? `color-mix(in oklab, ${tone} 40%, transparent)` : 'var(--border-1)'}` }}>{r.folio || '—'}</span>
                  {r.suggest ? <><Icon name="arrowR" size={11} style={{ color: 'var(--ink-4)' }} /><span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--exact)' }}>{r.suggest}</span></> : null}
                </span>
                <span>{(r.flags || []).length ? (r.flags.map(k => <PoFlagChip key={k} kind={k} size="md" />)) : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--exact)' }}><Icon name="check" size={11} stroke={3} />in order</span>}</span>
                <span style={{ textAlign: 'right' }}>
                  {r.want ? <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mismatch)', fontWeight: 600 }}><Icon name="arrowUp" size={11} />→ #{String(r.want).padStart(2, '0')}</span>
                  : r.state === 'reviewed' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ocr)' }}><Icon name="check" size={10} stroke={3} />reviewed</span>
                  : issue ? <Button variant="ghost" size="sm">Resolve</Button> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Pages grid ---------------------- */
const PoPages = ({ density = 'M' }) => {
  const cols = density === 'L' ? 4 : density === 'S' ? 9 : 6;
  const w = density === 'L' ? 200 : density === 'S' ? 96 : 140, h = density === 'L' ? 254 : density === 'S' ? 122 : 178;
  return (
    <div style={{ padding: '20px 28px 28px', flex: 1, minHeight: 0 }}>
      <PoBanner state="review" totals={PO_TOTALS_REVIEW} />
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {PO_ROWS.map(r => {
          const issue = (r.flags || []).some(f => f !== 'nonNumeric');
          const tone = issue ? PO_FLAGS[r.flags[0]].tone : 'var(--exact)';
          return (
            <div key={r.scan} style={{ padding: 4, borderRadius: 6 }}>
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: w - 8, height: h - 36, borderRadius: 3, background: '#fff', boxShadow: 'inset 0 0 0 1px rgba(40,40,40,0.18)', position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: '15% 16%', backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.16 0 0) 0 1.5px, transparent 1.5px 6px)', opacity: 0.8 }} />
                  <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', minWidth: 22, height: 20, padding: '0 6px', borderRadius: 4, background: issue ? `color-mix(in oklab, ${tone} 85%, black)` : 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono-font)', display: 'grid', placeItems: 'center' }}>{r.folio || '—'}</div>
                </div>
                <span className="mono" style={{ position: 'absolute', top: 4, left: 4, fontSize: 9, color: 'var(--ink-4)', background: 'rgba(255,255,255,0.7)', padding: '0 3px', borderRadius: 2 }}>#{r.scan}</span>
                {issue && density !== 'S' ? <div style={{ position: 'absolute', top: 4, right: 4 }}><PoFlagChip kind={r.flags[0]} /></div> : null}
              </div>
              <div className="mono" style={{ marginTop: 5, fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.prefix}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PoOverview = () => {
  const t = PO_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PoBanner state="review" totals={t} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[{ label: 'pages', value: t.total, tone: 'ink-1' }, { label: 'numbered', value: t.numbered, tone: 'exact' }, { label: 'out of seq', value: t.outOfSeq, tone: t.outOfSeq > 0 ? 'mismatch' : 'ink-2' }, { label: 'gaps', value: t.gaps, tone: 'ocr', sub: 'missing leaf?' }, { label: 'duplicates', value: t.dupes, tone: t.dupes > 0 ? 'mismatch' : 'ink-2' }, { label: 'no folio', value: t.missing, tone: 'fuzzy', sub: 'front / blank' }].map((s, i) => <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}><div className="label" style={{ color: 'var(--ink-3)' }}>{s.label}</div><div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${s.tone})`, letterSpacing: '-0.01em' }}>{s.value}</div>{s.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{s.sub}</div> : null}</div>)}
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>How order is detected</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>Each scan's printed page number comes from <span className="mono">stage 10 · OCR</span>. The arabic body should increase by one per leaf; a scan whose folio breaks that run is <span style={{ color: 'var(--mismatch)' }}>out of sequence</span>. Roman-numeral and unnumbered front matter are handled as a separate run, so they don't trip the body check.</div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Detection flags</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Object.entries(PO_FLAG_COUNTS).map(([k, n]) => { const f = PO_FLAGS[k]; const max = Math.max(...Object.values(PO_FLAG_COUNTS)); return <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 36px', gap: 10, alignItems: 'center' }}><PoFlagChip kind={k} size="md" /><div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} /></div><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span></div>; })}</div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div></div>
        {[['1 min ago', 'Sequence checked', '387 pages · 6 out of sequence · 2 duplicates'], ['1 min ago', 'Folios read', '358 numbered from OCR · 18 unnumbered'], ['4 min ago', 'OCR confirmed', '387 pages forwarded']].map((r, i) => <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center' }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r[0]}</span><span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{r[1]}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r[2]}</span></div>)}
      </div>
    </div>
  );
};

const PoRow = ({ title, sub, children, control }) => <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: control === 'seg' ? 'flex-start' : 'center', borderTop: '1px solid var(--border-1)' }}><div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div></div>{children}</div>;
const PoSeg = ({ options, activeIdx }) => <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7, flexWrap: 'wrap' }}>{options.map((o, i) => { const a = i === activeIdx; return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>; })}</div>;

const PoStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? { tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 1 change vs project default', sub: 'Save these as the project default, or revert to inherit.' } : state === 'preset' ? { tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Roman front matter', sub: 'Loaded from a saved preset; not the project default.' } : { tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · OCR folios', sub: 'Changes here can be saved back as the project default for Page order.' };
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Page order</h2><div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>Where page numbers come from, the numbering scheme, and how aggressively to auto-apply a reorder.</div></div>
      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div></div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>{state === 'modified' ? <><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></> : state === 'preset' ? <Button variant="default" size="sm" icon="refresh">Reset to project default</Button> : null}</div>
      </div>
      {state === 'modified' ? <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Page order and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>14 downstream stages</span> as stale.</span><span style={{ flex: 1 }} /><Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button></div> : null}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <PoRow title="Number source" sub="Where the page number is read from" control="seg"><PoSeg options={['OCR folios', 'Filename', 'Manual']} activeIdx={0} /></PoRow>
        <PoRow title="Numbering scheme" sub="How front matter and body are numbered" control="seg"><PoSeg options={['Roman + arabic', 'Arabic only', 'Custom']} activeIdx={0} /></PoRow>
        <PoRow title="Front-matter handling" sub="Treat roman / unnumbered leaves as a separate run" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>So a 'iv' before '1' isn't read as out of sequence.</div><Toggle on={true} /></PoRow>
        <PoRow title="Gap tolerance" sub="Allow this many missing folios before flagging a gap"><PoSeg options={['0', '1', '2']} activeIdx={0} /></PoRow>
        <PoRow title="Auto-apply unambiguous reorders" sub="Reorder without review when the corrected sequence is unambiguous" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Ambiguous cases (duplicates, misreads) always wait for you.</div><Toggle on={state === 'preset'} /></PoRow>
        <PoRow title="Re-check sequence" sub="Re-read folios and recompute the order"><div style={{ display: 'flex', gap: 8 }}><Button variant="default" size="sm" icon="refresh">Re-check all 387</Button><Button variant="ghost" size="sm" icon="swap">Apply detected order</Button></div></PoRow>
      </div>
    </div>
  );
};

Object.assign(window, { PoFlagChip, PoBanner, PoSequence, PoPages, PoOverview, PoStepSettings });
