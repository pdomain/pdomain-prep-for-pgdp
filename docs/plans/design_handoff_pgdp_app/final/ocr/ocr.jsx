// ocr.jsx — OCR stage (stage 10) content components.
// OcrPages (grid coloured by confidence), OcrRecognition (the Recognition tab:
// page image with word boxes + recognised text + low-conf tokens), OcrOverview,
// OcrStepSettings, plus OcrThumb / chips. Engine: Tesseract (sample).

const { useState: useSOC } = React;

const confTone = (c) => c >= 0.95 ? 'var(--exact)' : c >= 0.85 ? 'var(--ocr)' : c >= 0.70 ? 'var(--fuzzy)' : 'var(--mismatch)';

/* GPU/CPU backend chip (mirrors the grayscale stage). DocTR runs on GPU·CUDA
   with a CPU fallback; Tesseract is CPU-only. */
const OcrBackendChip = ({ backend = 'gpu', compact = false }) => {
  const isGpu = backend === 'gpu';
  const color = isGpu ? 'var(--exact)' : 'var(--fuzzy)';
  const label = isGpu ? 'GPU · CUDA' : 'CPU · fallback';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: compact ? '1px 7px' : '2px 8px', height: compact ? 18 : 22, borderRadius: 99, background: `color-mix(in oklab, ${color} 12%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 35%, var(--border-1))`, color, fontSize: compact ? 10 : 11, fontWeight: 600, fontFamily: 'var(--mono-font, monospace)', letterSpacing: '.02em' }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color, boxShadow: `0 0 6px ${color}` }} />{label}
    </span>
  );
};
const ocrPerPage = (engine, backend) => engine === 'tesseract' ? OCR_ENGINES.tesseract.perPageCpuSec : (backend === 'gpu' ? OCR_ENGINES.doctr.perPageGpuSec : OCR_ENGINES.doctr.perPageCpuSec);
const fmtOcrTotal = (sec, n = 387) => { const t = sec * n; return t < 90 ? `${Math.round(t)}s` : t < 3600 ? `${Math.round(t / 60)}m` : `${(t / 3600).toFixed(1)}h`; };

/* ---------------------- OcrThumb ---------------------- */
const OcrThumb = ({ row, w, h }) => {
  const ink = 'oklch(0.16 0 0)';
  const tone = row.illust ? 'var(--ink-4)' : confTone(row.meanConf);
  return (
    <div style={{ width: w, height: h, position: 'relative', background: '#fff', border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden' }}>
      {row.illust ? (
        <div style={{ position: 'absolute', inset: '16%', background: '#111', opacity: 0.13, borderRadius: 2 }}><div style={{ position: 'absolute', inset: 6, border: '1px solid #111', opacity: 0.3 }} /></div>
      ) : (
        <>
          <div style={{ position: 'absolute', top: '8%', left: '20%', right: '34%', height: 2.4, background: ink }} />
          <div style={{ position: 'absolute', inset: '15% 16% 16% 16%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.5px, transparent 1.5px 6px)`, opacity: 0.85 }} />
          {/* low-conf word highlights */}
          {(row.lowConf > 8) ? [['28%', '34%', '18%'], ['52%', '22%', '12%'], ['64%', '40%', '20%']].map(([t, l, wd], i) => (
            <span key={i} style={{ position: 'absolute', top: t, left: l, width: wd, height: 7, background: `color-mix(in oklab, ${confTone(0.6)} 38%, transparent)`, borderRadius: 1 }} />
          )) : null}
        </>
      )}
      {/* confidence corner ribbon */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderStyle: 'solid', borderWidth: `${Math.min(w, h) * 0.16}px ${Math.min(w, h) * 0.16}px 0 0`, borderColor: `${tone} transparent transparent transparent`, opacity: 0.85 }} />
    </div>
  );
};

const OcFlagChip = ({ kind, size = 'sm' }) => { const f = OCR_FLAGS[kind]; if (!f) return null; const d = size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 } : { h: 16, px: 6, fs: 9.5, dot: 4.5 }; return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: d.h, padding: `0 ${d.px}px`, borderRadius: 99, fontSize: d.fs, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)` }}><span style={{ width: d.dot, height: d.dot, borderRadius: 99, background: f.tone }} />{f.label}</span>; };
const OcStatusDot = ({ state, size = 8 }) => { const tone = state === 'clean' ? 'var(--exact)' : state === 'flagged' ? 'var(--fuzzy)' : state === 'reviewed' ? 'var(--ocr)' : state === 'running' ? 'var(--ocr)' : 'var(--mismatch)'; return <span style={{ width: size, height: size, borderRadius: 99, background: tone, boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none', animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none', display: 'inline-block', flex: '0 0 auto' }} />; };

const OCR_DENSITY = { S: { col: 9, w: 96, h: 122, fs: 10, flagMax: 1, flagSize: 'sm' }, M: { col: 6, w: 140, h: 178, fs: 11, flagMax: 2, flagSize: 'sm' }, L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' } };

const OcrCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = OCR_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).slice(0, cfg.flagMax);
  const extra = (row.flags || []).length - flags.length;
  return (
    <div style={{ position: 'relative', padding: 4, borderRadius: 6, background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : expanded ? 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' : 'transparent', border: '1.5px solid ' + (selected ? 'var(--accent)' : expanded ? 'var(--ocr)' : hovered ? 'var(--border-3)' : 'transparent'), cursor: 'pointer', transition: 'border-color .12s, background .12s' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} /> : <OcrThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />}
        {!isRunning ? <div style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 4, background: selected ? 'var(--accent)' : 'rgba(12,12,16,0.78)', border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(240,240,242,0.40)'), display: 'grid', placeItems: 'center', color: selected ? 'var(--accent-ink)' : 'transparent' }}><Icon name="check" size={11} stroke={3} /></div> : null}
        {row.pageNumber != null ? <div style={{ position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4, background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><OcStatusDot state={row.state} size={6} />{row.pageNumber}</div> : null}
        {!isRunning && !row.illust && density !== 'S' ? <div className="mono" style={{ position: 'absolute', bottom: 6, right: 6, height: 16, padding: '0 5px', borderRadius: 3, background: 'rgba(12,12,16,0.72)', color: confTone(row.meanConf), fontSize: 9.5, fontWeight: 700 }}>{Math.round(row.meanConf * 100)}%</div> : null}
        {flags.length > 0 ? <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>{flags.map(k => <OcFlagChip key={k} kind={k} size={cfg.flagSize} />)}{extra > 0 ? <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(12,12,16,0.85)', color: '#f0f0f2' }}>+{extra}</span> : null}</div> : row.state === 'reviewed' ? <div style={{ position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4, height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))', color: 'var(--ocr)', border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)', fontSize: 9.5, fontWeight: 600 }}><Icon name="check" size={9} stroke={3} />reviewed</div> : null}
        {!isRunning && row.override ? <div className="mono" style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--accent) 88%, black)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }} title={`override · ${row.override.lang}`}><Icon name="swap" size={8} />{row.override.label}</div> : null}
      </div>
      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? <span className="mono" style={{ fontSize: cfg.fs - 1, color: 'var(--ink-4)' }}>{row.illust ? 'no text' : `${row.words}w`}</span> : null}
      </div>
    </div>
  );
};

const OcrBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}><span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>Recognising text…<span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.done} / {totals.total} · {totals.rateHz}/s · {OCR_ENGINE.name}</span></div><div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} /></div></div>
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
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{totals.words} words · mean score <span style={{ color: confTone(totals.meanConf) }}>{Math.round(totals.meanConf * 100)}%</span>{flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} pages flagged</span></> : <> · all clean</>}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{flagged > 0 ? <>{totals.lowConfWords} low-score words across the book. Open the <span style={{ color: 'var(--ink-1)' }}>Recognition</span> tab to check them in place; the Spellcheck stage catches the rest.</> : 'Every page recognised. Confirm to advance to Page order.'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['clean', totals.clean, 'var(--exact)'], ['flagged', totals.flagged, 'var(--fuzzy)'], ['reviewed', totals.reviewed, 'var(--ocr)']].filter(([_, n]) => n > 0).map(([k, n, color]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}><span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />{k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span></span>)}</div>
          </div>
        </div>
        {stale ? <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={12} />Settings changed — 15 downstream stages now stale</div> : null}
      </div>
    </div>
  );
};

const OcrToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [{ id: 'all', name: 'All', count: totals.total }, { id: 'flagged', name: 'Flagged', count: totals.flagged, dot: 'var(--fuzzy)' }, { id: 'clean', name: 'Clean', count: totals.clean, dot: 'var(--exact)' }, { id: 'reviewed', name: 'Reviewed', count: totals.reviewed, dot: 'var(--ocr)' }, ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : [])];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>{chips.map(f => { const a = filter === f.id; return <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer' }}>{f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span></div>; })}</div>
      <Divider vertical style={{ height: 22 }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{[['≥95', 'var(--exact)'], ['85–95', 'var(--ocr)'], ['70–85', 'var(--fuzzy)'], ['<70', 'var(--mismatch)']].map(([l, c]) => <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-3)' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{l}%</span>)}</div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="default" size="sm" icon="refresh">Re-OCR selection</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>Density<div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>{['S', 'M', 'L'].map(d => { const a = density === d; return <div key={d} style={{ padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)' }}>{d}</div>; })}</div></div>
      </div>
    </div>
  );
};

/* ---------------------- Recognition tab ---------------------- */
const OcrRecognition = () => {
  const row = OCR_ROWS[4]; // p0005, flagged
  return (
    <div style={{ padding: '18px 28px 28px', display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, flex: 1, minHeight: 0 }}>
      {/* page with word boxes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{row.prefix}</span>
          <OcFlagChip kind="garbledRun" size="md" /><OcFlagChip kind="dictMiss" size="md" />
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>mean {Math.round(row.meanConf * 100)}% · {row.lowConf} low-score</span>
          <Button variant="ghost" size="sm" icon="refresh">Re-OCR page</Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'grid', placeItems: 'center', padding: 18, overflow: 'auto' }}>
          <div style={{ width: 360, background: '#fff', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.25)', padding: '26px 30px' }}>
            <div style={{ height: 6, width: '52%', background: 'oklch(0.16 0 0)', margin: '0 auto 18px' }} />
            {OCR_SAMPLE_LINES.map((ln, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {ln.words.map((wd, j) => {
                  const [text, conf] = wd; const low = conf < 0.85;
                  return <span key={j} style={{ position: 'relative', fontSize: 12.5, color: 'oklch(0.18 0 0)', fontFamily: 'Georgia, serif', padding: '0 2px', borderRadius: 2, background: low ? `color-mix(in oklab, ${confTone(conf)} 22%, transparent)` : 'transparent', boxShadow: low ? `inset 0 -2px 0 ${confTone(conf)}` : 'none' }}>{text}</span>;
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* side panel: low-conf tokens + engine + histogram */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="alert" size={13} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>Low-score tokens</span><span style={{ flex: 1 }} /><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{OCR_LOWCONF_TOKENS.length}</span></div>
          {OCR_LOWCONF_TOKENS.map((t, i) => (
            <div key={i} style={{ padding: '9px 14px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 34, height: 18, borderRadius: 4, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono-font)', color: '#fff', background: confTone(t.conf) }}>{Math.round(t.conf * 100)}</span>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 13, color: 'var(--ink-1)' }}>{t.word}</span>
              <Icon name="arrowR" size={12} style={{ color: 'var(--ink-4)' }} />
              <span style={{ fontFamily: 'Georgia, serif', fontSize: 13, color: 'var(--exact)', fontWeight: 600 }}>{t.suggest}</span>
              <span style={{ flex: 1 }} />
              <button style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="check" size={11} /></button>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>Score · this page</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 48 }}>{OCR_CONF_HIST.map((v, i) => <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: confTone(0.5 + i * 0.09), borderRadius: '2px 2px 0 0' }} />)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}><span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-4)' }}>50%</span><span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-4)' }}>100%</span></div>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '12px 14px', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>engine</span><span className="mono" style={{ color: 'var(--ink-1)' }}>{OCR_ENGINE.name}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>model</span><span className="mono" style={{ color: 'var(--ink-1)' }}>{OCR_ENGINE.model}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>page segmentation</span><span className="mono" style={{ color: 'var(--ink-1)' }}>{OCR_ENGINE.psm}</span></div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}><Button variant="default" size="sm" icon="check">Accept page</Button><Button variant="primary" size="sm" iconRight="arrowR">Next flagged</Button></div>
      </div>
    </div>
  );
};

/* ---------------------- settings primitives ---------------------- */
const OcSlider = ({ value, min, max, unit = '', pct }) => { const p = pct != null ? pct : (value - min) / (max - min); return <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 360 }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{min}{unit}</span><div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}><div style={{ width: `${p * 100}%`, height: '100%', borderRadius: 99, background: 'var(--accent)' }} /><div style={{ position: 'absolute', left: `calc(${p * 100}% - 7px)`, top: -5, width: 14, height: 14, borderRadius: 99, background: 'var(--bg-surface)', border: '2px solid var(--accent)' }} /></div><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{max}{unit}</span><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 40, textAlign: 'right' }}>{value}{unit}</span></div>; };
const OcSeg = ({ options, activeIdx }) => <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7, flexWrap: 'wrap' }}>{options.map((o, i) => { const a = i === activeIdx; return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>; })}</div>;
const OcRow = ({ title, sub, children, control }) => <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '240px 1fr 36px' : '240px 1fr', gap: 12, padding: '14px 16px', alignItems: control === 'seg' ? 'flex-start' : 'center', borderTop: '1px solid var(--border-1)' }}><div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div></div>{children}</div>;

/* ---------------------- Pages / Overview / Settings ---------------------- */
const OcrPages = ({ state = 'review', density = 'M', filter = 'all', selected = [], stale = false }) => {
  const totals = state === 'running' ? OCR_TOTALS_RUNNING : state === 'done' ? OCR_TOTALS_DONE : OCR_TOTALS_REVIEW;
  const rows = state === 'running' ? OCR_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined }) : OCR_ROWS;
  const filtered = filter === 'flagged' ? rows.filter(r => r.state === 'flagged') : filter === 'clean' ? rows.filter(r => r.state === 'clean') : filter === 'reviewed' ? rows.filter(r => r.state === 'reviewed') : filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) : rows;
  const hasSel = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}><OcrBanner state={state} totals={totals} stale={stale} /></div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}><Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running' || !canAdvance}>Confirm and advance · {totals.total} pages</Button>{state !== 'running' && !canAdvance ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{totals.flagged - totals.reviewed} flagged pages still need review</span> : null}</div>
      </div>
      <OcrToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${OCR_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => <OcrCard key={r.idx} row={r} density={density} selected={selected.includes(r.idx)} hovered={i === 4 && state !== 'running' && !hasSel} />)}
      </div>
    </div>
  );
};

const OcrOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? OCR_TOTALS_RUNNING : state === 'done' ? OCR_TOTALS_DONE : OCR_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <OcrBanner state={state} totals={totals} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[{ label: 'pages', value: totals.total, tone: 'ink-1' }, { label: 'recognised', value: `${totals.done}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' }, { label: 'words', value: totals.words, tone: 'ink-1' }, { label: 'mean score', value: `${Math.round(totals.meanConf * 100)}%`, tone: 'exact' }, { label: 'low-score', value: totals.lowConfWords, tone: 'fuzzy', sub: 'words' }, { label: 'flagged', value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: 'pages' }].map((s, i) => <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}><div className="label" style={{ color: 'var(--ink-3)' }}>{s.label}</div><div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${s.tone})`, letterSpacing: '-0.01em' }}>{s.value}</div>{s.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{s.sub}</div> : null}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Word score</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 90 }}>{OCR_CONF_HIST.map((v, i) => <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}><div style={{ width: '100%', height: `${v * 100}%`, minHeight: 3, background: confTone(0.5 + i * 0.09), borderRadius: '3px 3px 0 0' }} /><span className="mono" style={{ fontSize: 9, color: 'var(--ink-4)' }}>{50 + i * 9}</span></div>)}</div>
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-3)' }}>{Math.round(OCR_CONF_HIST[5] * 100)}% of words score above 95%.</div>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Page flags</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Object.entries(OCR_FLAG_COUNTS).map(([k, n]) => { const f = OCR_FLAGS[k]; const max = Math.max(...Object.values(OCR_FLAG_COUNTS)); return <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 36px', gap: 10, alignItems: 'center' }}><OcFlagChip kind={k} size="md" /><div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} /></div><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span></div>; })}</div>
        </div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div></div>
        {[['2 min ago', 'OCR run completed', `387 pages · ${OCR_TOTALS_REVIEW.words} words · 18 flagged`], ['2 min ago', 'Stage started', `${OCR_ENGINE.name} · ${OCR_ENGINE.model}`], ['6 min ago', 'Page layout confirmed', '387 pages · zones forwarded']].map((r, i) => <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center' }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r[0]}</span><span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{r[1]}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r[2]}</span></div>)}
      </div>
    </div>
  );
};

const OcrStepSettings = ({ state = 'default', engine = 'doctr', backend = 'gpu' }) => {
  const eng = OCR_ENGINES[engine] || OCR_ENGINES.doctr;
  const isDoctr = engine === 'doctr';
  const perSec = ocrPerPage(engine, backend);
  const banner = state === 'modified' ? { tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 2 changes vs project default', sub: 'Save these as the project default, or revert to inherit.' } : state === 'preset' ? { tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Antiquarian (long-s + fraktur)', sub: 'Loaded from a saved preset; not the project default.' } : { tone: 'var(--exact)', icon: 'checkCircle', label: `Using project default · ${eng.name}`, sub: 'Changes here can be saved back as the project default for OCR.' };
  const conf = state === 'modified' ? 80 : 75;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · OCR</h2><div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>The recognition engine (and GPU/CPU backend), its model + languages, and per-page overrides for multilingual books.</div></div>
      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div></div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>{state === 'modified' ? <><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></> : state === 'preset' ? <Button variant="default" size="sm" icon="refresh">Reset to project default</Button> : null}</div>
      </div>
      {state === 'modified' ? <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark OCR and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>15 downstream stages</span> as stale.</span><span style={{ flex: 1 }} /><Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button></div> : null}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start' }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Engine</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>DocTR is your primary model; Tesseract is the fallback</div></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{['doctr', 'tesseract'].map(id => { const e = OCR_ENGINES[id]; const a = engine === id; const primary = e.kind === 'primary'; const sec = id === 'tesseract' ? e.perPageCpuSec : (backend === 'gpu' ? e.perPageGpuSec : e.perPageCpuSec); return (
            <div key={id} style={{ flex: 1, minWidth: 210, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1.5px solid ' + (a ? 'var(--accent)' : 'var(--border-1)') }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{e.name}</span>
                <span className="mono" style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: '.04em', background: primary ? 'color-mix(in oklab, var(--exact) 16%, transparent)' : 'var(--bg-raised)', color: primary ? 'var(--exact)' : 'var(--ink-3)' }}>{e.tag.toUpperCase()}</span>
                {a ? <span style={{ marginLeft: 'auto', width: 16, height: 16, borderRadius: 99, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={9} stroke={3} style={{ color: '#fff' }} /></span> : null}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>{e.blurb}</div>
              <div className="mono" style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-4)' }}>{e.backends ? 'GPU + CPU' : 'CPU only'} · ~{sec}s/page</div>
            </div>
          ); })}</div>
        </div>
        {isDoctr ? (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'center', borderTop: '1px solid var(--border-1)' }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Compute backend</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>DocTR runs on GPU with a CPU fallback</div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <OcSeg options={['GPU · CUDA', 'CPU · fallback']} activeIdx={backend === 'gpu' ? 0 : 1} />
            <OcrBackendChip backend={backend} />
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>~{perSec}s/page · ~{fmtOcrTotal(perSec)} for 387 pages</span>
            {backend === 'cpu' ? <span className="mono" style={{ fontSize: 11, color: 'var(--mismatch)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="alert" size={11} />no CUDA device — running on CPU</span> : null}
          </div>
        </div>
        ) : null}
        {isDoctr ? (<>
          <OcRow title="Detection model" sub="Locates text regions on the page" control="seg"><OcSeg options={eng.config.detModel} activeIdx={0} /></OcRow>
          <OcRow title="Recognition model" sub="Reads the glyphs — default is our English book-corpus fine-tune" control="seg"><OcSeg options={eng.config.recModel} activeIdx={3} /></OcRow>
          <OcRow title="Language / charset" sub="Vocabulary + script the model loads" control="seg"><OcSeg options={eng.config.lang} activeIdx={0} /></OcRow>
        </>) : (<>
          <OcRow title="Language pack" sub="traineddata to load" control="seg"><OcSeg options={eng.config.langpack} activeIdx={1} /></OcRow>
          <OcRow title="Page segmentation (psm)" sub="How Tesseract splits the page" control="seg"><OcSeg options={eng.config.psm} activeIdx={0} /></OcRow>
          <OcRow title="Legacy + LSTM" sub="Run both engines and combine — better on fraktur / long-s" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Slower; helps on antiquarian type.</div><Toggle on={false} /></OcRow>
        </>)}
        <OcRow title="Low-score threshold" sub="Words below this are flagged for review"><OcSlider value={conf} min={50} max={95} unit="%" /></OcRow>
        <OcRow title="Keep alternatives" sub="Store the runner-up reading for each low-score word" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Lets the proofer swap to the second guess in one click.</div><Toggle on={true} /></OcRow>
        <OcRow title="Preserve layout" sub="Carry zone + line structure into the text output" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Keeps columns, headings and footnotes separable downstream.</div><Toggle on={true} /></OcRow>
        <OcRow title="Re-run OCR" sub="Clears recognised text and re-runs with the settings above"><div style={{ display: 'flex', gap: 8 }}><Button variant="default" size="sm" icon="refresh">Re-OCR all 387</Button><Button variant="ghost" size="sm" icon="refresh">Re-OCR flagged · 18</Button></div></OcRow>
      </div>

      {isDoctr ? (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="sparkles" size={14} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Advanced · model weights</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Pick specific detection + recognition checkpoints, including custom weights loaded from the Hugging Face hub.</div></div>
          <Button variant="default" size="sm" icon="plus">Load from Hugging Face…</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {[['Detection weights', OCR_ENGINES.doctr.weights.detect], ['Recognition weights', OCR_ENGINES.doctr.weights.recog]].map(([title, list], ci) => (
            <div key={title} style={{ padding: '12px 16px', borderLeft: ci ? '1px solid var(--border-1)' : 'none' }}>
              <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>{title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map(wt => { const a = wt.active || (!list.some(x => x.active) && wt.note.indexOf('default') >= 0); const hf = wt.source === 'huggingface'; return (
                  <div key={wt.name} style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (a ? 'var(--accent)' : 'var(--border-1)') }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{wt.name}</span>
                      <span className="mono" style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: '.04em', background: hf ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'var(--bg-raised)', color: hf ? 'var(--accent)' : 'var(--ink-3)' }}>{hf ? 'HF' : 'BUILT-IN'}</span>
                      {a ? <span style={{ marginLeft: 'auto', width: 15, height: 15, borderRadius: 99, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={9} stroke={3} style={{ color: '#fff' }} /></span> : null}
                    </div>
                    <div className="mono" style={{ marginTop: 3, fontSize: 10, color: 'var(--ink-4)' }}>{hf ? `${wt.repo} · ${wt.note}` : wt.note}</div>
                  </div>
                ); })}
              </div>
            </div>
          ))}
        </div>
      </div>
      ) : null}

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="swap" size={14} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Per-page overrides</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Pages inherit this engine + model unless overridden. Use for multilingual books, or the odd page that needs a different model (e.g. Greek).</div></div>
          <Button variant="default" size="sm" icon="plus">Add override</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 60px 120px 140px 1fr', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)' }}>{['pages', 'count', 'engine', 'model / language', 'reason'].map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)' }}>{h}</span>)}</div>
        {OCR_OVERRIDES.map((o, i) => { const e = OCR_ENGINES[o.engine]; return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 60px 120px 140px 1fr', gap: 12, padding: '9px 16px', alignItems: 'center', borderTop: i === 0 ? 0 : '1px solid var(--border-1)' }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-1)', fontWeight: 600 }}>{o.pages}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{o.count} pp</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: e.kind === 'primary' ? 'var(--exact)' : 'var(--fuzzy)' }} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>{e.name}</span></span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ocr)' }}>{o.lang}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-3)' }}>{o.reason}</span><button style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-4)', cursor: 'pointer', display: 'inline-grid', placeItems: 'center' }}><Icon name="wrench" size={11} /></button></span>
          </div>
        ); })}
      </div>
    </div>
  );
};

Object.assign(window, { OcrThumb, OcFlagChip, OcStatusDot, OcrCard, OcrBanner, OcrToolbar, OcrRecognition, OcrPages, OcrOverview, OcrStepSettings, confTone });
