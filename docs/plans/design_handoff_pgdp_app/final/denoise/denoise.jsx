// denoise.jsx — Denoise-stage (stage 7, Image group) content components.
// Cleans bilevel speckle/blobs without eroding text. The distinctive piece:
// a FIRST-PASS word/mark detector runs before despeckle and PROTECTS
// components that read as intentional ink (foot page-numbers, printer's
// signature marks, catchwords) so they aren't mistaken for noise.
//
// CleanThumb (bilevel output + protected-mark overlay), DenoisePages,
// DenoiseOverview, DenoiseStepSettings, DenoiseReviewEditor (before/after
// wipe + protect layer + loupe). Same scaffold as threshold.jsx.

const { useState: useSDN } = React;

/* ---------------------- Protected foot-mark ----------------------
   The little marginal mark the first-pass detector kept. Rendered at the
   page foot inside a dashed "protected" box. On flagged pages the box takes
   the flag tone (protect-conflict / mark-at-risk) to pull the eye there.
*/
const FootMark = ({ kind, conf, tone }) => {
  const ink = 'oklch(0.16 0 0)';
  return (
    <div style={{
      position: 'absolute', bottom: '4%', left: '50%', transform: 'translateX(-50%)',
      padding: '3px 5px', borderRadius: 2,
      border: `1px dashed ${tone}`,
      background: `color-mix(in oklab, ${tone} 8%, transparent)`,
      display: 'flex', alignItems: 'center', gap: 3,
    }}>
      {/* tiny eye dot = "the detector saw this" */}
      <span style={{ width: 4, height: 4, borderRadius: 99, background: tone, flex: '0 0 auto' }} />
      {kind === 'pageNum' ? (
        <span style={{ display: 'flex', gap: 1.5 }}>
          {[0, 1].map(i => <span key={i} style={{ width: 2, height: 6, background: ink }} />)}
        </span>
      ) : kind === 'signature' ? (
        <span style={{ display: 'flex', alignItems: 'flex-end', gap: 1 }}>
          <span style={{ width: 2, height: 5, background: ink }} />
          <span style={{ width: 2, height: 7, background: ink }} />
          <span style={{ width: 2, height: 4, background: ink }} />
        </span>
      ) : (
        <span style={{ width: 12, height: 2.5, background: ink }} />
      )}
    </div>
  );
};

/* ---------------------- CleanThumb ----------------------
   Bilevel output. Clean = crisp; residual noise = scattered pepper scaled by
   row.noise; eroded = thin/broken strokes. Protected foot-marks overlay on
   top. Flagged pages tint the protect box / carry a corner accent.
*/
const CleanThumb = ({ row, w, h }) => {
  const flags = row.flags || [];
  const has = (k) => flags.includes(k);
  const ink = 'oklch(0.16 0 0)';
  const eroded = row.eroded || has('textEroded');
  const lineH = eroded ? 1.0 : 1.7;
  const lineImg = eroded
    ? `repeating-linear-gradient(to right, ${ink} 0 5px, transparent 5px 9px)`
    : null;

  const noiseN = Math.round((row.noise || 0) * 60);
  const speckles = Array.from({ length: noiseN }, (_, i) => ({
    x: (i * 41) % 92 + 4, y: (i * 59) % 80 + 8, s: (i % 3) ? 1 : 1.6,
  }));

  // dominant protected mark + its tone (flag tone if this page is flagged about it)
  const mark = (row.protect || [])[0];
  const protTone = has('protectConflict') ? 'var(--ocr)'
    : has('markAtRisk') ? 'var(--fuzzy)'
    : 'var(--ocr)';

  return (
    <div style={{ width: w, height: h, position: 'relative', background: '#fff', border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden' }}>
      {/* heading */}
      <div style={{ position: 'absolute', top: '8%', left: '20%', right: '34%', height: lineH + 1, background: ink }} />
      {/* body lines */}
      <div style={{ position: 'absolute', inset: '15% 16% 18% 16%', backgroundImage: lineImg || `repeating-linear-gradient(to bottom, ${ink} 0 ${lineH}px, transparent ${lineH}px 6px)`, opacity: eroded ? 0.7 : 0.9 }} />
      {/* ink-bleed blob (blob-remains) */}
      {has('blobRemains') ? (
        <div style={{ position: 'absolute', top: '40%', right: '20%', width: '14%', height: '7%', background: ink, borderRadius: '40%', opacity: 0.85 }} />
      ) : null}
      {/* residual speckle */}
      {speckles.map((sp, i) => (
        <span key={i} style={{ position: 'absolute', left: `${sp.x}%`, top: `${sp.y}%`, width: sp.s, height: sp.s, borderRadius: 99, background: '#111' }} />
      ))}
      {/* protected foot-mark */}
      {mark ? <FootMark kind={mark.kind} conf={mark.conf} tone={protTone} /> : null}
    </div>
  );
};

/* ---------------------- Flag chip / status dot / protect pill ---------------------- */
const DnFlagChip = ({ kind, size = 'sm' }) => {
  const f = DENOISE_FLAGS[kind]; if (!f) return null;
  const dims = size === 'lg' ? { h: 22, px: 8, fs: 11, dot: 6 }
    : size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 }
    : { h: 16, px: 6, fs: 9.5, dot: 4.5 };
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: dims.h, padding: `0 ${dims.px}px`, borderRadius: 99,
      fontSize: dims.fs, fontWeight: 600,
      background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`,
      color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)`,
    }}>
      <span style={{ width: dims.dot, height: dims.dot, borderRadius: 99, background: f.tone }} />
      {f.label}
    </span>
  );
};

const DnStatusDot = ({ state, size = 8 }) => {
  const tone = state === 'clean' ? 'var(--exact)' : state === 'flagged' ? 'var(--fuzzy)' : state === 'reviewed' ? 'var(--ocr)' : state === 'running' ? 'var(--ocr)' : state === 'failed' ? 'var(--mismatch)' : 'var(--ink-4)';
  return (
    <span style={{ width: size, height: size, borderRadius: 99, background: tone, boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none', animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none', display: 'inline-block', flex: '0 0 auto' }} />
  );
};

// "N protected" pill — the first-pass detector kept N marginal marks.
const ProtectPill = ({ count, tone = 'var(--ocr)', compact }) => (
  <span className="mono" style={{
    display: 'inline-flex', alignItems: 'center', gap: 4, height: compact ? 16 : 18, padding: compact ? '0 5px' : '0 7px', borderRadius: 99,
    background: `color-mix(in oklab, ${tone} 14%, rgba(12,12,16,0.78))`, color: tone,
    border: `1px solid color-mix(in oklab, ${tone} 40%, transparent)`, fontSize: compact ? 9.5 : 10, fontWeight: 600,
  }}>
    <Icon name="eye" size={compact ? 9 : 10} />
    {count}
  </span>
);

const MarkChip = ({ kind, conf, size = 'md' }) => {
  const m = MARK_KINDS[kind]; if (!m) return null;
  const low = conf < 0.5;
  const tone = low ? 'var(--fuzzy)' : 'var(--ocr)';
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: size === 'lg' ? 22 : 20, padding: '0 8px', borderRadius: 99,
      background: 'var(--bg-surface)', border: `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`, color: 'var(--ink-1)', fontSize: 11, fontWeight: 500,
    }}>
      <Icon name={m.icon} size={11} style={{ color: tone }} />
      {m.label}
      <span style={{ color: low ? 'var(--fuzzy)' : 'var(--ink-4)', fontWeight: 600 }}>{Math.round(conf * 100)}%</span>
    </span>
  );
};

/* ---------------------- DenoiseCard ---------------------- */
const DENOISE_DENSITY = {
  S: { col: 9, w: 96,  h: 122, fs: 10,   flagMax: 1, flagSize: 'sm' },
  M: { col: 6, w: 140, h: 178, fs: 11,   flagMax: 2, flagSize: 'sm' },
  L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' },
};

const DenoiseCard = ({ row, density = 'M', selected, hovered, expanded }) => {
  const cfg = DENOISE_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).slice(0, cfg.flagMax);
  const extra = (row.flags || []).length - flags.length;
  const protCount = (row.protect || []).length;
  return (
    <div style={{
      position: 'relative', padding: 4, borderRadius: 6,
      background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : expanded ? 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' : 'transparent',
      border: '1.5px solid ' + (selected ? 'var(--accent)' : expanded ? 'var(--ocr)' : hovered ? 'var(--border-3)' : 'transparent'),
      cursor: 'pointer', transition: 'border-color .12s, background .12s',
    }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} /> : <CleanThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />}

        {!isRunning ? (
          <div style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 4, background: selected ? 'var(--accent)' : 'rgba(12,12,16,0.78)', border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(240,240,242,0.40)'), display: 'grid', placeItems: 'center', color: selected ? 'var(--accent-ink)' : 'transparent' }}>
            <Icon name="check" size={11} stroke={3} />
          </div>
        ) : null}

        {row.pageNumber != null ? (
          <div style={{ position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4, background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <DnStatusDot state={row.state} size={6} />
            {row.pageNumber}
          </div>
        ) : null}

        {/* protected-marks pill bottom-right */}
        {!isRunning && protCount > 0 && density !== 'S' ? (
          <div style={{ position: 'absolute', bottom: 6, right: 6 }}>
            <ProtectPill count={protCount} compact tone={(row.flags || []).includes('markAtRisk') ? 'var(--fuzzy)' : 'var(--ocr)'} />
          </div>
        ) : null}

        {flags.length > 0 ? (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            {flags.map(k => <DnFlagChip key={k} kind={k} size={cfg.flagSize} />)}
            {extra > 0 ? <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(12,12,16,0.85)', color: '#f0f0f2' }}>+{extra}</span> : null}
          </div>
        ) : null}

        {row.state === 'reviewed' ? (
          <div style={{ position: 'absolute', top: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 4, height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))', color: 'var(--ocr)', border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)', fontSize: 9.5, fontWeight: 600 }}>
            <Icon name="check" size={9} stroke={3} />reviewed
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? (
          <span className="mono" style={{ fontSize: cfg.fs - 1, color: 'var(--ink-4)' }}>
            {row.state === 'clean' ? 'clean' : row.state === 'flagged' ? `${row.flags.length} flag${row.flags.length>1?'s':''}` : row.state === 'reviewed' ? 'ok·rv' : row.state}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- First-pass detect strip ----------------------
   The explainer that makes the OCR-guided behaviour legible. Sits above the
   grid / in the overview.
*/
const FirstPassStrip = ({ compact }) => {
  const d = DENOISE_DETECT;
  return (
    <div style={{
      borderRadius: 8, border: '1px solid color-mix(in oklab, var(--ocr) 32%, var(--border-1))',
      background: 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))',
      padding: compact ? '9px 12px' : '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ width: compact ? 26 : 30, height: compact ? 26 : 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}>
        <Icon name="eye" size={compact ? 13 : 15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? 12.5 : 13, fontWeight: 600, color: 'var(--ink-1)' }}>
          First-pass word detection ran before despeckle
        </div>
        <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Protected <span className="mono" style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{d.marksFound}</span> marginal marks so foot page-numbers,
          printer's signature marks and catchwords aren't mistaken for speckle.
          <span className="mono" style={{ color: 'var(--fuzzy)' }}> {d.lowConf} low-score → mark-at-risk.</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {Object.entries(d.byKind).map(([k, n]) => (
          <span key={k} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 99, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)', fontSize: 10.5 }}>
            <Icon name={MARK_KINDS[k].icon} size={10} style={{ color: 'var(--ocr)' }} />
            {MARK_KINDS[k].label} <span style={{ color: 'var(--ink-4)' }}>{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

/* ---------------------- Banner (3-state) ---------------------- */
const DenoiseBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
            Detecting marks &amp; despeckling…
            <span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.done} / {totals.total} · {totals.rateHz}/s · {totals.protectedMarks} protected</span>
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
              {totals.done} pages cleaned
              {flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed</> : <> · all clean</>}
              <span className="mono" style={{ marginLeft: 8, color: 'var(--ocr)', fontWeight: 500, fontSize: 12 }}>· {totals.protectedMarks} marks protected</span>
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
              {flagged > 0 ? 'Click any flagged page to compare before / after and resolve protect conflicts; bulk-select to re-clean.' : 'Speckle cleared, marginal marks preserved. Confirm to advance to Page layout.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['clean', totals.clean, 'var(--exact)'], ['flagged', totals.flagged, 'var(--fuzzy)'], ['reviewed', totals.reviewed, 'var(--ocr)'], ['errors', totals.errors, 'var(--mismatch)']].filter(([_, n]) => n > 0).map(([k, n, color]) => (
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
            <Icon name="alert" size={12} />Settings changed — 17 downstream stages now stale
          </div>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Toolbar ---------------------- */
const DenoiseToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [
    { id: 'all',      name: 'All',       count: totals.total },
    { id: 'flagged',  name: 'Flagged',   count: totals.flagged, dot: 'var(--fuzzy)' },
    { id: 'clean',    name: 'Clean',     count: totals.clean,   dot: 'var(--exact)' },
    { id: 'protected',name: 'Protected', count: totals.protectedMarks, dot: 'var(--ocr)' },
    { id: 'reviewed', name: 'Reviewed',  count: totals.reviewed, dot: 'var(--ocr)' },
    ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : []),
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>
        {chips.map(f => {
          const active = filter === f.id;
          return (
            <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: active ? 'var(--bg-surface)' : 'transparent', boxShadow: active ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: active ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: 'pointer' }}>
              {f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}
              {f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span>
            </div>
          );
        })}
      </div>

      <Divider vertical style={{ height: 22 }} />

      {filter === 'flagged' ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(DENOISE_FLAG_COUNTS).slice(0, 4).map(([k, n]) => {
            const f = DENOISE_FLAGS[k];
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
        <Button variant="default" size="sm" icon="refresh">Re-clean with new strength</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
          Density
          <div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
            {['S', 'M', 'L'].map(d => {
              const a = density === d;
              return <div key={d} style={{ padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)' }}>{d}</div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Bulk bar ---------------------- */
const DenoiseBulkBar = ({ count, flagSummary }) => (
  <div style={{ position: 'sticky', bottom: 12, marginTop: 12, zIndex: 5, padding: '10px 14px', borderRadius: 10, background: 'var(--ink-1)', color: 'var(--bg-page)', boxShadow: '0 12px 28px rgba(15,23,42,.22), 0 2px 6px rgba(15,23,42,.10)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{count} selected</span>
    {flagSummary ? (
      <>
        <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
        <span style={{ fontSize: 11.5, color: 'color-mix(in oklab, var(--bg-page) 70%, transparent)' }}>{flagSummary}</span>
      </>
    ) : null}
    <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    {[
      { id: 'mild',    name: 'Re-clean · mild',  icon: 'refresh' },
      { id: 'strong',  name: 'Re-clean · strong', icon: 'refresh' },
      { id: 'protect', name: 'Keep protected',   icon: 'eye' },
      { id: 'accept',  name: 'Accept as-is',     icon: 'check' },
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
    {options.map((o, i) => {
      const a = i === activeIdx;
      return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>;
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

/* ---------------------- DenoiseReviewEditor ----------------------
   Before/after wipe (noisy bilevel → cleaned) plus the protect layer: a
   loupe on the page foot shows the protected mark, why it was kept, and a
   Keep / Drop control — the place a protect-conflict gets resolved.
*/
const NoisyPanel = ({ noise = 0.3 }) => {
  const ink = 'oklch(0.16 0 0)';
  const n = Math.round(noise * 120);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff' }}>
      <div style={{ position: 'absolute', top: '8%', left: '20%', right: '34%', height: 3, background: ink }} />
      <div style={{ position: 'absolute', inset: '15% 14% 16% 14%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.8px, transparent 1.8px 8px)`, opacity: 0.9 }} />
      {Array.from({ length: n }, (_, i) => ({ x: (i * 41) % 94 + 3, y: (i * 59) % 86 + 6, s: (i % 3) ? 1.2 : 2 })).map((sp, i) => (
        <span key={i} style={{ position: 'absolute', left: `${sp.x}%`, top: `${sp.y}%`, width: sp.s, height: sp.s, borderRadius: 99, background: '#111' }} />
      ))}
    </div>
  );
};
const CleanPanel = () => {
  const ink = 'oklch(0.16 0 0)';
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff' }}>
      <div style={{ position: 'absolute', top: '8%', left: '20%', right: '34%', height: 3, background: ink }} />
      <div style={{ position: 'absolute', inset: '15% 14% 16% 14%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.8px, transparent 1.8px 8px)`, opacity: 0.92 }} />
    </div>
  );
};

const DenoiseReviewEditor = ({ row, wipe = 0.5 }) => {
  const pw = 300, ph = 424;
  const mark = (row.protect || [])[0] || { kind: 'pageNum', conf: 0.5 };
  const low = mark.conf < 0.5;
  const mTone = low ? 'var(--fuzzy)' : 'var(--ocr)';
  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)', background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden', animation: 'pgd-slide-up .18s ease-out' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))' }}>
        <Icon name="sparkles" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Clean · {row.prefix}.tif</span>
        {(row.flags || []).map(k => <DnFlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>residual {Math.round((row.noise || 0) * 100)}% · Δblack {(row.blackD * 100).toFixed(1)}% · {(row.protect || []).length} protected</span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={13} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* wipe + protect loupe */}
        <div style={{ padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)', position: 'relative', minHeight: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ position: 'relative', width: pw, height: ph, borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.35)' }}>
            <CleanPanel />
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }}>
              <NoisyPanel noise={row.noise || 0.3} />
            </div>
            {/* protected foot-mark box, drawn over both sides */}
            <div style={{ position: 'absolute', bottom: '5%', left: '50%', transform: 'translateX(-50%)', padding: '4px 8px', borderRadius: 3, border: `1.5px dashed ${mTone}`, background: `color-mix(in oklab, ${mTone} 10%, transparent)`, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="eye" size={11} style={{ color: mTone }} />
              <span style={{ display: 'flex', gap: 2 }}>{[0,1].map(i => <span key={i} style={{ width: 2.5, height: 9, background: 'oklch(0.16 0 0)' }} />)}</span>
            </div>
            <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>BEFORE · noisy</span>
            <span style={{ position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 4, background: 'color-mix(in oklab, var(--ocr) 90%, black)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>AFTER · cleaned</span>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe * 100}%`, width: 2, background: 'var(--accent)' }}>
              <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 26, height: 26, borderRadius: 99, background: '#fff', border: '1px solid var(--border-2)', display: 'grid', placeItems: 'center', cursor: 'col-resize', color: 'var(--ink-3)' }}><Icon name="swap" size={12} /></span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-3)', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, border: `1.5px dashed ${mTone}` }} />protected mark</span>
            <span className="mono">drag the handle to wipe</span>
          </div>
        </div>

        {/* controls */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* protect resolver — the heart of this stage */}
          <div style={{ borderRadius: 8, border: `1px solid color-mix(in oklab, ${mTone} 40%, var(--border-1))`, background: `color-mix(in oklab, ${mTone} 6%, var(--bg-surface))`, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Icon name="eye" size={13} style={{ color: mTone }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>First-pass kept this mark</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              Matched <span className="mono" style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{MARK_KINDS[mark.kind].label}</span> at the page foot ·
              score <span className="mono" style={{ color: mTone, fontWeight: 600 }}>{Math.round(mark.conf * 100)}%</span>.
              {low ? ' Below the protect threshold — confirm it is real ink, not a speckle.' : ' Despeckle would have removed it as an isolated component.'}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
              <Button variant="primary" size="sm" icon="check">Keep mark</Button>
              <Button variant="default" size="sm" icon="trash">Drop as noise</Button>
            </div>
          </div>

          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 7 }}>Clean strength</div>
            <Segmented options={['Off', 'Mild', 'Standard', 'Strong']} activeIdx={2} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>Despeckle ≤</div>
              <div className="mono" style={{ height: 28, borderRadius: 6, background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>4 px</div>
            </div>
            <div>
              <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>Fill holes ≤</div>
              <div className="mono" style={{ height: 28, borderRadius: 6, background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>2 px</div>
            </div>
          </div>

          <Divider />

          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Apply to</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'this', name: 'This page only', count: 1, active: true },
                { id: 'selected', name: 'Selected pages', count: 3 },
                { id: 'same', name: 'All flagged with same issue', count: (row.flags && DENOISE_FLAG_COUNTS[row.flags[0]]) || 5 },
              ].map(opt => (
                <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', background: opt.active ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-1)') }}>
                  <span style={{ width: 14, height: 14, borderRadius: 99, flex: '0 0 auto', background: opt.active ? 'var(--accent)' : 'transparent', border: '1.5px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-2)'), display: 'grid', placeItems: 'center' }}>{opt.active ? <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--accent-ink)' }} /> : null}</span>
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
            <Button variant="primary" size="sm" icon="refresh">Re-clean</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- DenoisePages ---------------------- */
const DenoisePages = ({ state = 'review', density = 'M', filter = 'all', selected = [], editing = null, stale = false }) => {
  const totals = state === 'running' ? DENOISE_TOTALS_RUNNING : state === 'done' ? DENOISE_TOTALS_DONE : DENOISE_TOTALS_REVIEW;
  const rows = state === 'running'
    ? DENOISE_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined, protect: undefined })
    : DENOISE_ROWS;

  const filtered =
    filter === 'flagged'   ? rows.filter(r => r.state === 'flagged') :
    filter === 'clean'     ? rows.filter(r => r.state === 'clean') :
    filter === 'reviewed'  ? rows.filter(r => r.state === 'reviewed') :
    filter === 'protected' ? rows.filter(r => (r.protect || []).length > 0) :
    filter === 'selected'  ? rows.filter(r => selected.includes(r.idx)) : rows;

  const editingRow = editing != null ? DENOISE_ROWS.find(r => r.idx === editing) : null;
  const hasSelection = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <DenoiseBanner state={state} totals={totals} stale={stale} />
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running' || !canAdvance}>Confirm and advance · {totals.total} pages</Button>
          {state !== 'running' && !canAdvance ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{totals.flagged - totals.reviewed} flagged pages still need review</span> : null}
        </div>
      </div>

      {state !== 'running' ? <div style={{ marginBottom: 14 }}><FirstPassStrip compact /></div> : null}

      <DenoiseToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: `repeat(${DENOISE_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => (
          <DenoiseCard key={r.idx} row={r} density={density} selected={selected.includes(r.idx)} hovered={i === 2 && state !== 'running' && !hasSelection && editing == null} expanded={editing === r.idx} />
        ))}
      </div>

      {editingRow ? <DenoiseReviewEditor row={editingRow} /> : null}
      {hasSelection ? <DenoiseBulkBar count={selected.length} flagSummary="1 protect-conflict · 1 residual-noise" /> : null}
    </div>
  );
};

/* ---------------------- DenoiseOverview ---------------------- */
const DenoiseOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? DENOISE_TOTALS_RUNNING : state === 'done' ? DENOISE_TOTALS_DONE : DENOISE_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DenoiseBanner state={state} totals={totals} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { label: 'pages',     value: totals.total, tone: 'ink-1' },
          { label: 'cleaned',   value: `${totals.done}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' },
          { label: 'clean',     value: totals.clean, tone: 'exact' },
          { label: 'flagged',   value: totals.flagged, tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' },
          { label: 'protected', value: totals.protectedMarks, tone: 'ocr', sub: 'marks kept' },
          { label: 'avg Δblack', value: totals.avgBlackD, tone: 'ink-1', sub: 'ink removed' },
        ].map((stat, i) => (
          <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}>
            <div className="label" style={{ color: 'var(--ink-3)' }}>{stat.label}</div>
            <div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${stat.tone})`, letterSpacing: '-0.01em' }}>{stat.value}</div>
            {stat.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{stat.sub}</div> : null}
          </div>
        ))}
      </div>

      {/* first-pass detection summary */}
      <FirstPassStrip />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 14 }}>
        {/* why ordering note */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>Why detect before clean</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            A blind despeckler treats an isolated component as noise. But a foot page-number, a printer's
            <span style={{ color: 'var(--ink-1)' }}> signature mark</span>, or a
            <span style={{ color: 'var(--ink-1)' }}> catchword</span> is real ink — just small and alone.
            The first pass reads the page well enough to tell them apart, so the cleaner never eats them.
          </div>
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-page)', border: '1px solid var(--border-1)', fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="info" size={12} style={{ color: 'var(--ocr)', flex: '0 0 auto' }} />
            Full recognition still runs later at <span className="mono" style={{ color: 'var(--ink-1)' }}>stage 10 · OCR</span>. This pass is a fast "is this ink meant to be here?" classifier only.
          </div>
        </div>

        {/* flag distribution */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Flag distribution</div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Issues found across {totals.done} cleaned pages</div>
            </div>
            <Button variant="ghost" size="sm" icon="eye">Open Pages</Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(DENOISE_FLAG_COUNTS).map(([k, n]) => {
              const f = DENOISE_FLAGS[k];
              const max = Math.max(...Object.values(DENOISE_FLAG_COUNTS));
              return (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 36px', gap: 10, alignItems: 'center' }}>
                  <DnFlagChip kind={k} size="md" />
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
          ['2 min ago',  'Clean run completed',        '387 pages · 18 flagged · 431 marks protected'],
          ['2 min ago',  'First-pass detection',       '431 marks · 14 low-score'],
          ['2 min ago',  'Stage started',              'method: connected-component · despeckle ≤ 4px'],
          ['5 min ago',  'Post-transform crop confirmed', '387 pages forwarded'],
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

/* ---------------------- DenoiseStepSettings (preset-aware) ---------------------- */
const DenoiseStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 3 changes vs project default', sub: 'Save these as the project default, or revert to inherit.',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Heavy speckle (microfilm)', sub: 'Loaded from a saved preset; not the project default.',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · Connected-component clean', sub: 'Changes here can be saved back as the project default for Denoise.',
  };
  const methodIdx = state === 'preset' ? 2 : state === 'modified' ? 0 : 1;
  const despeckle = state === 'preset' ? 7 : state === 'modified' ? 6 : 4;
  const fillHoles = 2;
  const strengthIdx = state === 'preset' ? 3 : 2;
  const minDetect = state === 'modified' ? 40 : 50;

  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Denoise</h2>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>How hard the cleaner works, and how the first-pass detector protects marginal marks from removal.</div>
      </div>

      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {state === 'modified' ? (<><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></>) : state === 'preset' ? (<Button variant="default" size="sm" icon="refresh">Reset to project default</Button>) : null}
        </div>
      </div>

      {state === 'modified' ? (
        <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Saving will mark Denoise and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>17 downstream stages</span> as stale.</span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button>
        </div>
      ) : null}

      <div style={{ padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="sparkles" size={14} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Preset</span>
        <div style={{ flex: 1, maxWidth: 320, height: 28, padding: '0 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>{state === 'preset' ? 'Heavy speckle (microfilm)' : state === 'modified' ? 'Connected-component (modified)' : 'Connected-component clean (built-in)'}</span>
          <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
        </div>
        <Button variant="default" size="sm" icon="plus">Save as preset…</Button>
        <span style={{ flex: 1 }} />
        <a style={{ fontSize: 11.5, color: 'var(--ink-3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Manage presets <Icon name="arrowR" size={11} /></a>
      </div>

      {/* ---- First-pass word detection section (the OCR-guided protect controls) ---- */}
      <div style={{ background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', border: '1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="eye" size={15} style={{ color: 'var(--ocr)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>First-pass word detection</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Runs a fast detector before despeckle so marginal marks aren't removed as noise.</div>
          </div>
          <Toggle on={true} />
        </div>

        <SettingRow title="Protect marginalia" sub="Mark kinds the detector keeps even when isolated" control="segmented">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(MARK_KINDS).map(([k, m], i) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: 7, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))', border: '1px solid color-mix(in oklab, var(--ocr) 35%, var(--border-1))', color: 'var(--ink-1)', fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>
                <Icon name={m.icon} size={11} style={{ color: 'var(--ocr)' }} />
                {m.label}
                <Icon name="check" size={10} stroke={3} style={{ color: 'var(--ocr)' }} />
              </span>
            ))}
          </div>
        </SettingRow>

        <SettingRow title="Min detection confidence" sub="Marks below this still protect, but surface as mark-at-risk for review">
          <SettingSlider value={minDetect} min={0} max={100} unit="%" />
        </SettingRow>
      </div>

      {/* ---- Standard clean controls ---- */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Method</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How the worker removes noise</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'morph',  name: 'Morphological',     sub: 'open + close' },
              { id: 'cc',     name: 'Connected-component', sub: 'drop small blobs · default' },
              { id: 'median', name: 'Median',            sub: '3×3 median filter' },
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

        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, padding: '14px 16px', alignItems: 'flex-start', borderTop: '1px solid var(--border-1)' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Strength</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How aggressively to clean</div>
          </div>
          <Segmented options={['Off', 'Mild', 'Standard', 'Strong']} activeIdx={strengthIdx} />
        </div>

        <SettingRow title="Despeckle size" sub="Drop isolated black components at or below this size">
          <SettingSlider value={despeckle} min={1} max={12} unit=" px" />
        </SettingRow>

        <SettingRow title="Fill holes ≤" sub="Close pin-holes in strokes at or below this size">
          <SettingSlider value={fillHoles} min={0} max={6} unit=" px" />
        </SettingRow>

        <SettingRow title="Protect thin strokes" sub="Skip erosion below a minimum stroke width" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Keeps serifs and hairlines from dropping out.</div>
          <Toggle on={state !== 'modified'} />
        </SettingRow>

        <SettingRow title="Erosion guard" sub="Flag text-eroded when ink removed exceeds a threshold" control="toggle">
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Catches over-cleaning that ate real text.</div>
          <Toggle on={true} />
        </SettingRow>

        <SettingRow title="Re-run denoise" sub="Clears current cleanup and re-runs with the settings above">
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="default" size="sm" icon="refresh">Re-clean all 387</Button>
            <Button variant="ghost" size="sm" icon="refresh">Re-clean flagged only · 18</Button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
};

Object.assign(window, {
  CleanThumb, FootMark, DnFlagChip, DnStatusDot, ProtectPill, MarkChip, FirstPassStrip,
  DenoiseCard, DenoiseBanner, DenoiseToolbar, DenoiseBulkBar, DenoiseReviewEditor,
  DenoisePages, DenoiseOverview, DenoiseStepSettings,
});
