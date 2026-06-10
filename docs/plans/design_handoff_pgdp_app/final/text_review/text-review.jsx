// text-review.jsx — Text review stage (stage 16, Text group) components.
// The human proofing pass on the FINAL composited pages. The hero is the
// Review queue (TrReviewQueue); TrComments is the discussion layer; plus
// TrPages / TrOverview / TrStepSettings and the page-render helpers.
// All prefixed Tr* so nothing collides with sibling stages.

const { useState: useSTR } = React;

const trTone = (state) =>
  state === 'approved' ? 'var(--exact)' :
  state === 'pending'  ? 'var(--fuzzy)' :
  state === 'discuss'  ? 'var(--mismatch)' :
  state === 'running'  ? 'var(--ocr)' : 'var(--ink-4)';

const TrReasonChip = ({ kind, size = 'sm' }) => {
  const f = TR_REASONS[kind]; if (!f) return null;
  const d = size === 'md' ? { h: 18, px: 7, fs: 10, dot: 5 } : { h: 16, px: 6, fs: 9.5, dot: 4.5 };
  return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: d.h, padding: `0 ${d.px}px`, borderRadius: 99, fontSize: d.fs, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)` }}><span style={{ width: d.dot, height: d.dot, borderRadius: 99, background: f.tone }} />{f.label}</span>;
};

const TrStatusDot = ({ state, size = 8 }) => { const tone = trTone(state); return <span style={{ width: size, height: size, borderRadius: 99, background: tone, boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none', animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none', display: 'inline-block', flex: '0 0 auto' }} />; };

const TrAvatar = ({ id, size = 22 }) => {
  const r = (TR_REVIEWERS.find(x => x.id === id)) || { hue: 'var(--ink-4)' };
  return <span title={r.name || id} className="mono" style={{ width: size, height: size, borderRadius: 99, flex: '0 0 auto', display: 'inline-grid', placeItems: 'center', fontSize: size * 0.42, fontWeight: 700, color: '#fff', background: `color-mix(in oklab, ${r.hue} 78%, black)`, letterSpacing: '.02em' }}>{id}</span>;
};

/* ---------------------- TrPageThumb ----------------------
   FINAL composited page: uniform canvas with a faint margin guide (the
   canvas-mapped content box) and the text block inside. Concern marks only
   on pages still in review. */
const TrPageThumb = ({ row, w, h }) => {
  const ink = 'oklch(0.16 0 0)';
  const n = Math.min(row.concerns || 0, 4);
  const tone = trTone(row.state);
  const marks = Array.from({ length: n }, (_, i) => ({ x: (i * 41) % 56 + 24, y: (i * 47) % 56 + 22 }));
  return (
    <div style={{ width: w, height: h, position: 'relative', background: '#fff', border: '1px solid var(--border-2)', borderRadius: 3, overflow: 'hidden' }}>
      {/* canvas margin guide — the uniform mapped content box */}
      <div style={{ position: 'absolute', inset: '11% 13%', border: '1px dashed color-mix(in oklab, #111 18%, transparent)', borderRadius: 1 }} />
      <div style={{ position: 'absolute', top: '17%', left: '24%', right: '36%', height: 2.4, background: ink }} />
      <div style={{ position: 'absolute', inset: '24% 18% 16% 18%', backgroundImage: `repeating-linear-gradient(to bottom, ${ink} 0 1.5px, transparent 1.5px 6px)`, opacity: 0.82 }} />
      {marks.map((m, i) => (
        <span key={i} style={{ position: 'absolute', top: `${m.y}%`, left: `${m.x}%`, width: '14%', height: 6, background: `color-mix(in oklab, ${tone} 40%, transparent)`, borderBottom: `1.5px solid ${tone}`, borderRadius: 1 }} />
      ))}
      {/* approved tick watermark */}
      {row.state === 'approved' ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'color-mix(in oklab, var(--exact) 22%, transparent)' }}><Icon name="check" size={Math.min(w, h) * 0.4} stroke={2.2} /></div> : null}
    </div>
  );
};

const TR_DENSITY = { S: { col: 9, w: 96, h: 122, fs: 10 }, M: { col: 6, w: 140, h: 178, fs: 11 }, L: { col: 4, w: 200, h: 254, fs: 12.5 } };

const TrCard = ({ row, density = 'M', selected, hovered }) => {
  const cfg = TR_DENSITY[density];
  const isRunning = row.state === 'running';
  const tone = trTone(row.state);
  return (
    <div style={{ position: 'relative', padding: 4, borderRadius: 6, background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'transparent', border: '1.5px solid ' + (selected ? 'var(--accent)' : hovered ? 'var(--border-3)' : 'transparent'), cursor: 'pointer', transition: 'border-color .12s, background .12s' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} /> : <TrPageThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />}
        {row.pageNumber != null ? <div style={{ position: 'absolute', bottom: 6, left: 6, height: 18, padding: '0 6px', borderRadius: 4, background: 'rgba(12,12,16,0.78)', color: '#fff', fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><TrStatusDot state={row.state} size={6} />{row.pageNumber}</div> : null}
        {!isRunning && row.concerns > 0 && density !== 'S' ? <div className="mono" style={{ position: 'absolute', top: 6, right: 6, height: 18, padding: '0 6px', borderRadius: 99, background: `color-mix(in oklab, ${tone} 88%, black)`, color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{row.concerns}{row.state === 'discuss' ? ' ◆' : ''}</div> : null}
        {!isRunning && row.state === 'approved' ? <div style={{ position: 'absolute', top: 6, left: 6, height: 16, padding: '0 6px', borderRadius: 99, background: 'color-mix(in oklab, var(--exact) 18%, rgba(12,12,16,0.78))', color: 'var(--exact)', border: '1px solid color-mix(in oklab, var(--exact) 45%, transparent)', fontSize: 9.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="check" size={9} stroke={3} />ok</div> : null}
        {!isRunning && row.reviewer && row.state !== 'clean' ? <div style={{ position: 'absolute', bottom: 6, right: 6 }}><TrAvatar id={row.reviewer} size={density === 'L' ? 22 : 18} /></div> : null}
      </div>
      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span className="mono" style={{ fontSize: cfg.fs, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? <span className="mono" style={{ fontSize: cfg.fs - 1, color: row.concerns > 0 ? tone : 'var(--ink-4)' }}>{row.state === 'clean' ? 'clean' : row.state === 'approved' ? 'approved' : `${row.concerns} open`}</span> : null}
      </div>
    </div>
  );
};

const TrBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.done / totals.total) * 100);
    return (
      <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))', background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flex: '0 0 auto', background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))', color: 'var(--ocr)', display: 'grid', placeItems: 'center' }}><span style={{ width: 14, height: 14, borderRadius: 99, border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)', borderTopColor: 'var(--ocr)', animation: 'pgd-spin 1.1s linear infinite' }} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>Assembling the review queue…<span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>{totals.done} / {totals.total} · {totals.queue} queued so far</span></div><div style={{ marginTop: 8, height: 4, borderRadius: 99, background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} /></div></div>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ocr)', flex: '0 0 auto' }}>{pct}%</span>
      </div>
    );
  }
  const open = totals.pending + totals.discuss;
  const tone = totals.discuss > 0 ? 'var(--mismatch)' : open > 0 ? 'var(--fuzzy)' : 'var(--exact)';
  return (
    <div style={{ borderRadius: 10, border: '1px solid color-mix(in oklab, ' + tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + tone + ' 7%, var(--bg-surface))', display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
      <div style={{ width: 4, background: tone }} />
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, flex: '0 0 auto', background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))', color: tone, display: 'grid', placeItems: 'center' }}><Icon name={open > 0 ? 'eye' : 'checkCircle'} size={15} /></div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{open > 0 ? <>{totals.queue} pages await a human{totals.discuss > 0 ? <> · <span style={{ color: 'var(--mismatch)' }}>{totals.discuss} in discussion</span></> : null}</> : <>All pages reviewed</>}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>{open > 0 ? <>The last human gate before packaging. Read each flagged page against the scan, approve it, or open a comment. Cleared pages flow to Illustrations &amp; the proof pack.</> : 'Every page signed off. Confirm to advance to Illustrations.'}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{[['pending', totals.pending, 'var(--fuzzy)'], ['in discussion', totals.discuss, 'var(--mismatch)'], ['approved', totals.approved, 'var(--exact)'], ['auto-clean', totals.clean, 'var(--ink-4)']].filter(([_, n]) => n > 0).map(([k, n, color]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', color: 'var(--ink-2)' }}><span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />{k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span></span>)}</div>
          </div>
        </div>
        {stale ? <div style={{ padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)', border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)', color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={12} />Settings changed — 9 downstream stages now stale</div> : null}
      </div>
    </div>
  );
};

/* ---------------------- Review queue (the hero) ---------------------- */
const TrReviewQueue = ({ filter = 'all' }) => {
  const list = filter === 'discuss' ? TR_QUEUE.filter(q => q.status === 'discuss')
    : filter === 'mine' ? TR_QUEUE.filter(q => q.reviewer === 'MO')
    : Object.keys(TR_REASONS).includes(filter) ? TR_QUEUE.filter(q => q.reason === filter)
    : TR_QUEUE;
  const filters = [
    { id: 'all', name: 'All', count: TR_QUEUE.length },
    { id: 'mine', name: 'Mine', count: TR_QUEUE.filter(q => q.reviewer === 'MO').length, dot: 'var(--exact)' },
    { id: 'discuss', name: 'In discussion', count: TR_QUEUE.filter(q => q.status === 'discuss').length, dot: 'var(--mismatch)' },
    ...Object.entries(TR_REASON_COUNTS).slice(0, 3).map(([k, n]) => ({ id: k, name: TR_REASONS[k].label, count: TR_QUEUE.filter(q => q.reason === k).length, dot: TR_REASONS[k].tone })),
  ];
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>{filters.map(f => { const a = filter === f.id; return <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer' }}>{f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span></div>; })}</div>
        <span style={{ flex: 1 }} />
        <Button variant="default" size="sm" icon="check">Approve all low-risk</Button>
        <Button variant="primary" size="sm" iconRight="arrowR">Send approved to Illustrations</Button>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 120px 30px 30px 150px', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)' }}>{['page · what to check', 'reason', 'page', 'who', '', 'action'].map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)' }}>{h}</span>)}</div>
        <div style={{ maxHeight: 660, overflow: 'auto' }}>
          {list.map((q, i) => (
            <div key={q.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 120px 30px 30px 150px', gap: 12, padding: '11px 16px', alignItems: 'center', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', background: q.status === 'discuss' ? 'color-mix(in oklab, var(--mismatch) 4%, transparent)' : 'transparent' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 13.5, color: 'var(--ink-1)' }}>
                  {q.ctxL ? <span style={{ color: 'var(--ink-3)' }}>…{q.ctxL} </span> : null}
                  <span style={{ padding: '1px 4px', borderRadius: 3, background: `color-mix(in oklab, ${TR_REASONS[q.reason].tone} 22%, transparent)`, boxShadow: `inset 0 -2px 0 ${TR_REASONS[q.reason].tone}`, fontWeight: 600 }}>{q.word}</span>
                  {q.ctxR ? <span style={{ color: 'var(--ink-3)' }}> {q.ctxR}…</span> : null}
                  {q.suggest ? <><Icon name="arrowR" size={11} style={{ color: 'var(--ink-4)', margin: '0 4px', verticalAlign: 'middle' }} /><span style={{ color: 'var(--exact)', fontWeight: 600 }}>{q.suggest}</span></> : null}
                </div>
                <div className="mono" style={{ marginTop: 3, fontSize: 10.5, color: 'var(--ink-4)' }}>{q.note}</div>
              </div>
              <TrReasonChip kind={q.reason} size="md" />
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{q.page} · L{q.line}</span>
              <TrAvatar id={q.reviewer} size={22} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: q.comments > 0 ? 'var(--accent)' : 'var(--ink-5)' }} title={`${q.comments} comments`}><Icon name="fileText" size={12} />{q.comments > 0 ? <span className="mono" style={{ fontSize: 10.5, fontWeight: 600 }}>{q.comments}</span> : null}</span>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {q.status === 'discuss'
                  ? <><Button variant="default" size="sm" icon="fileText">Reply</Button><Button variant="ghost" size="sm" icon="check">Resolve</Button></>
                  : <><Button variant="primary" size="sm" icon="check">Approve</Button><button style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-4)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} title="Open comment"><Icon name="fileText" size={12} /></button></>}
                <button style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--ink-4)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} title="View on page"><Icon name="eye" size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------------------- Comments (discussion layer) ---------------------- */
const TrComments = ({ filter = 'all' }) => {
  const list = filter === 'open' ? TR_COMMENTS.filter(c => c.status === 'open') : filter === 'resolved' ? TR_COMMENTS.filter(c => c.status === 'resolved') : TR_COMMENTS;
  const chips = [
    { id: 'all', name: 'All', count: TR_COMMENTS.length },
    { id: 'open', name: 'Open', count: TR_COMMENTS.filter(c => c.status === 'open').length, dot: 'var(--accent)' },
    { id: 'resolved', name: 'Resolved', count: TR_COMMENTS.filter(c => c.status === 'resolved').length, dot: 'var(--exact)' },
  ];
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>{chips.map(f => { const a = filter === f.id; return <div key={f.id} style={{ padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none', display: 'flex', alignItems: 'center', gap: 7, color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer' }}>{f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}{f.name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span></div>; })}</div>
        <span style={{ flex: 1 }} />
        <Button variant="default" size="sm" icon="plus">New comment</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.map(c => {
          const resolved = c.status === 'resolved';
          return (
            <div key={c.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '13px 16px', opacity: resolved ? 0.72 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TrAvatar id={c.initials} size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{c.author}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{c.time}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 1 }}>{c.page} · folio {c.folio}</div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 9px', borderRadius: 99, fontSize: 10.5, fontWeight: 600, background: resolved ? 'color-mix(in oklab, var(--exact) 14%, transparent)' : 'color-mix(in oklab, var(--accent) 14%, transparent)', color: resolved ? 'var(--exact)' : 'var(--accent)', border: `1px solid color-mix(in oklab, ${resolved ? 'var(--exact)' : 'var(--accent)'} 38%, transparent)` }}>{resolved ? <><Icon name="check" size={10} stroke={3} />resolved</> : 'open'}</span>
              </div>
              <div style={{ marginTop: 10, marginLeft: 36, paddingLeft: 12, borderLeft: '2px solid var(--border-2)', fontFamily: 'Georgia, serif', fontSize: 12.5, color: 'var(--ink-3)', fontStyle: 'italic' }}>“…{c.anchor}…”</div>
              <div style={{ marginTop: 8, marginLeft: 36, fontSize: 13, color: 'var(--ink-1)', lineHeight: 1.55 }}>{c.body}</div>
              <div style={{ marginTop: 10, marginLeft: 36, display: 'flex', alignItems: 'center', gap: 10 }}>
                {c.replies > 0 ? <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="fileText" size={12} />{c.replies} {c.replies === 1 ? 'reply' : 'replies'}</span> : <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>no replies</span>}
                <span style={{ flex: 1 }} />
                {!resolved ? <><Button variant="ghost" size="sm" icon="fileText">Reply</Button><Button variant="default" size="sm" icon="check">Resolve</Button></> : <Button variant="ghost" size="sm" icon="eye">View on page</Button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------------------- Pages grid ---------------------- */
const TrPages = ({ state = 'review', density = 'M', filter = 'all', selected = [] }) => {
  const totals = state === 'running' ? TR_TOTALS_RUNNING : state === 'done' ? TR_TOTALS_DONE : TR_TOTALS_REVIEW;
  const rows = state === 'running' ? TR_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, concerns: undefined }) : TR_ROWS;
  const filtered = filter === 'pending' ? rows.filter(r => r.state === 'pending') : filter === 'discuss' ? rows.filter(r => r.state === 'discuss') : filter === 'approved' ? rows.filter(r => r.state === 'approved') : rows;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}><TrBanner state={state} totals={totals} /></div>
        <div style={{ flex: '0 0 auto' }}><Button variant="primary" size="md" iconRight="arrowR" disabled={state === 'running' || totals.discuss > 0}>Confirm and advance · {totals.total} pages</Button></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {[['all', 'All', totals.total], ['pending', 'Pending', totals.pending], ['discuss', 'In discussion', totals.discuss], ['approved', 'Approved', totals.approved]].map(([id, name, n]) => { const a = filter === id; return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, background: a ? 'var(--bg-surface)' : 'transparent', border: '1px solid ' + (a ? 'var(--border-2)' : 'transparent'), fontSize: 12, fontWeight: a ? 600 : 500, color: a ? 'var(--ink-1)' : 'var(--ink-3)', cursor: 'pointer' }}>{name}<span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{n}</span></span>; })}
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: `repeat(${TR_DENSITY[density].col}, 1fr)`, gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
        {filtered.map((r, i) => <TrCard key={r.idx} row={r} density={density} hovered={i === 3 && state !== 'running'} />)}
      </div>
    </div>
  );
};

/* ---------------------- Overview ---------------------- */
const TrOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? TR_TOTALS_RUNNING : state === 'done' ? TR_TOTALS_DONE : TR_TOTALS_REVIEW;
  const pct = Math.round(((totals.approved + totals.clean) / totals.total) * 100);
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <TrBanner state={state} totals={totals} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[{ label: 'pages', value: totals.total, tone: 'ink-1' }, { label: 'signed off', value: `${pct}%`, tone: 'exact' }, { label: 'in queue', value: totals.queue, tone: 'fuzzy', sub: 'await a human' }, { label: 'in discussion', value: totals.discuss, tone: totals.discuss > 0 ? 'mismatch' : 'ink-2' }, { label: 'open comments', value: totals.commentsOpen != null ? totals.commentsOpen : totals.comments, tone: 'accent' }, { label: 'auto-clean', value: totals.clean, tone: 'ink-2', sub: 'no review' }].map((s, i) => <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}><div className="label" style={{ color: 'var(--ink-3)' }}>{s.label}</div><div className="mono" style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: `var(--${s.tone})`, letterSpacing: '-0.01em' }}>{s.value}</div>{s.sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{s.sub}</div> : null}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Why pages are in the queue</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Object.entries(TR_REASON_COUNTS).map(([k, n]) => { const f = TR_REASONS[k]; const max = Math.max(...Object.values(TR_REASON_COUNTS)); return <div key={k} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 36px', gap: 10, alignItems: 'center' }}><TrReasonChip kind={k} size="md" /><div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} /></div><span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span></div>; })}</div>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>Reviewers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{TR_REVIEWERS.map(r => { const p = Math.round((r.done / r.assigned) * 100); return <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><TrAvatar id={r.id} size={26} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{r.name}</span><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r.done}/{r.assigned}</span></div><div style={{ marginTop: 5, height: 5, borderRadius: 99, background: 'var(--bg-sunk)', overflow: 'hidden' }}><div style={{ width: `${p}%`, height: '100%', background: r.hue }} /></div></div></div>; })}</div>
        </div>
      </div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div></div>
        {[['3 min ago', 'M. Okafor approved p0009', 'no concerns · signed off'], ['14 min ago', 'J. Lindqvist opened a comment', 'p0005 · Greek phrase handling'], ['38 min ago', 'M. Okafor opened a comment', 'p0015 · poem line breaks'], ['1 hr ago', 'Review queue assembled', '387 pages · 31 queued · 5 in discussion'], ['1 hr ago', 'Wordcheck confirmed', '387 pages · cleared text forwarded']].map((r, i) => <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 0 : '1px solid var(--border-1)', display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center' }}><span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r[0]}</span><span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{r[1]}</span><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r[2]}</span></div>)}
      </div>
    </div>
  );
};

/* ---------------------- settings primitives + Stage settings ---------------------- */
const TrRow = ({ title, sub, children, control }) => <div style={{ display: 'grid', gridTemplateColumns: control === 'toggle' ? '260px 1fr 36px' : '260px 1fr', gap: 12, padding: '14px 16px', alignItems: control === 'seg' ? 'flex-start' : 'center', borderTop: '1px solid var(--border-1)' }}><div><div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{title}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div></div>{children}</div>;
const TrSeg = ({ options, activeIdx }) => <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7, flexWrap: 'wrap' }}>{options.map((o, i) => { const a = i === activeIdx; return <div key={o} style={{ padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>{o}</div>; })}</div>;

const TrStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? { tone: 'var(--fuzzy)', icon: 'alert', label: 'Modified · 2 changes vs project default', sub: 'Save these as the project default, or revert to inherit.' } : state === 'preset' ? { tone: 'var(--ocr)', icon: 'sparkles', label: 'Using preset · Two-reviewer sign-off', sub: 'Loaded from a saved preset; not the project default.' } : { tone: 'var(--exact)', icon: 'checkCircle', label: 'Using project default · single sign-off', sub: 'Changes here can be saved back as the project default for Text review.' };
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Text review</h2><div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>Who reviews, what enters the human queue, and the rules for signing a page off.</div></div>
      <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))', background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, flex: '0 0 auto', background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))', color: banner.tone, display: 'grid', placeItems: 'center' }}><Icon name={banner.icon} size={14} /></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div><div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div></div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>{state === 'modified' ? <><Button variant="ghost" size="sm" icon="refresh">Revert</Button><Button variant="primary" size="sm" icon="check">Save as project default</Button></> : state === 'preset' ? <Button variant="default" size="sm" icon="refresh">Reset to project default</Button> : null}</div>
      </div>
      {state === 'modified' ? <div style={{ borderRadius: 8, border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)', background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>Changing the sign-off rule re-opens already-approved pages — <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>19 pages</span> would return to the queue.</span><span style={{ flex: 1 }} /><Button variant="ghost" size="sm" iconRight="arrowR">See affected pages</Button></div> : null}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <TrRow title="Sign-off rule" sub="How many reviewers must approve a page" control="seg"><TrSeg options={['Single', 'Two reviewers', 'Two if flagged']} activeIdx={state === 'preset' ? 1 : 0} /></TrRow>
        <TrRow title="What enters the queue" sub="Concern kinds that pull a page in for a human">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{['Held scannos', 'Low-score words', 'Layout', 'Markup', 'Open comments'].map((r, i) => { const on = i < (state === 'modified' ? 5 : 4); return <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: 7, background: on ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-1)'), color: 'var(--ink-1)', fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>{r}{on ? <Icon name="check" size={10} stroke={3} style={{ color: 'var(--accent)' }} /> : null}</span>; })}</div>
        </TrRow>
        <TrRow title="Low-score threshold" sub="OCR words below this are pulled in for a human check" control="seg"><TrSeg options={['80%', '85%', '90%']} activeIdx={state === 'modified' ? 2 : 1} /></TrRow>
        <TrRow title="Auto-approve clean pages" sub="Pages with no flagged concern skip the queue" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{TR_TOTALS_REVIEW.clean} pages currently auto-passed.</div><Toggle on={true} /></TrRow>
        <TrRow title="Require comments resolved" sub="Block Confirm while any comment thread is open" control="toggle"><div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Keeps unresolved discussion from reaching the proof pack.</div><Toggle on={true} /></TrRow>
        <TrRow title="Reviewers" sub="Team members assigned to this book">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{TR_REVIEWERS.map(r => <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px 0 4px', borderRadius: 99, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}><TrAvatar id={r.id} size={20} /><span style={{ fontSize: 12, color: 'var(--ink-1)' }}>{r.name}</span></span>)}<Button variant="default" size="sm" icon="plus">Add reviewer</Button></div>
        </TrRow>
      </div>
    </div>
  );
};

Object.assign(window, { trTone, TrReasonChip, TrStatusDot, TrAvatar, TrPageThumb, TrCard, TrBanner, TrReviewQueue, TrComments, TrPages, TrOverview, TrStepSettings });
