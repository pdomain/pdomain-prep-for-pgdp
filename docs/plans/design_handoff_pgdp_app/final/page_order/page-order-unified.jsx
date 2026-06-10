// page-order-unified.jsx — "Order & numbering" workspace: A + B + Sequence +
// Pages rolled into ONE tab. All four were views of the same object — the book
// as an ordered list of leaves grouped into numbering runs.
//
//   • Ribbon (from option A) is the persistent MAP at the top: run bands +
//     per-leaf ticks, with out-of-sequence notches overlaid (Sequence's job,
//     surfaced spatially).
//   • Run list (from option B) is the editable SPINE on the left.
//   • Leaf table (B) + folio reconciliation (Sequence) merge into one LEDGER;
//     "out of sequence" is a filter lens, not its own tab.
//   • Pages becomes a GRID view-toggle on the same panel.
//
// Reuses primitives already on window: Icon, Button, PR_RUNS, PR_ROLES,
// PrMini, PrRoleChip, PrStyleSelect, PrRunRow, PO_FLAGS, PR_TICKS.

const { useState: usePUW } = React;

/* ====================================================================
   Merged leaf model — windows that exercise every lens at once.
   Each row carries BOTH run/role/computed (from the Runs model) AND the
   OCR-folio reconciliation (from the Sequence model).
==================================================================== */
const PU_RUN_TONE = Object.fromEntries(PR_RUNS.map(r => [r.id, r.tone]));

// flag → how the status cell reads. Reuses PO_FLAGS tones where they exist.
const PU_FLAG = {
  outOfSequence: { label: 'out-of-seq', tone: 'var(--mismatch)' },
  gap:           { label: 'gap',        tone: 'var(--ocr)' },
  duplicate:     { label: 'duplicate',  tone: 'var(--mismatch)' },
  misread:       { label: 'misread',    tone: 'var(--fuzzy)' },
  missingNumber: { label: 'no-folio',   tone: 'var(--fuzzy)' },
  unnumbered:    { label: 'unnumbered', tone: 'var(--fuzzy)' },
  marker:        { label: '[blank]',    tone: 'var(--ink-3)' },
  countedBlank:  { label: 'blank · counted', tone: 'var(--ocr)' },
  renumber:      { label: 'renumber',   tone: 'var(--accent)' },
  continue:      { label: 'continues',  tone: 'var(--exact)' },
};

// lens membership for the filter chips
const PU_LENS = {
  seq:    new Set(['outOfSequence', 'gap', 'duplicate', 'misread', 'missingNumber']),
  plates: new Set(['unnumbered', 'marker', 'countedBlank']),
  renum:  new Set(['renumber']),
};

const PU_WINDOWS = [
  {
    caption: 'Front matter → body · scans 1–8', span: 'roman i–ii → arabic 1–4',
    rows: [
      { scan: 1, role: 'text',  run: 'front', folio: 'i',  computed: 'i',  ok: true },
      { scan: 2, role: 'blank', run: 'front', folio: null, computed: 'ii', flag: 'countedBlank', note: 'half-title verso — blank but counted as p. ii' },
      { scan: 3, role: 'text',  run: 'front', folio: null, computed: 'iii', flag: 'missingNumber', note: 'no printed number — title verso' },
      { scan: 4, role: 'text',  run: 'body',  folio: '1',  computed: '1',  ok: true, boundary: true },
      { scan: 5, role: 'text',  run: 'body',  folio: '2',  computed: '2',  ok: true },
    ],
  },
  {
    caption: 'Out of sequence · scans 6–11', span: 'a flipped bifolium + a gap',
    rows: [
      { scan: 6,  role: 'text', run: 'body', folio: '5', computed: '3', flag: 'outOfSequence', want: 9, note: 'folio jumps ahead of its neighbours' },
      { scan: 7,  role: 'text', run: 'body', folio: '3', computed: '4', flag: 'outOfSequence', want: 7 },
      { scan: 8,  role: 'text', run: 'body', folio: '4', computed: '5', ok: true },
      { scan: 9,  role: 'text', run: 'body', folio: '6', computed: '6', ok: true },
      { scan: 11, role: 'text', run: 'body', folio: '9', computed: '8', flag: 'gap', note: 'folio 8 absent — a leaf may be missing' },
    ],
  },
  {
    caption: 'Duplicate & misread · scans 13–16', span: 'two read “11”, one OCR slip',
    rows: [
      { scan: 13, role: 'text', run: 'body', folio: '11', computed: '10', flag: 'duplicate' },
      { scan: 14, role: 'text', run: 'body', folio: '11', computed: '11', flag: 'duplicate' },
      { scan: 15, role: 'text', run: 'body', folio: '1Z', computed: '12', flag: 'misread', suggest: '12', want: 16 },
      { scan: 16, role: 'text', run: 'body', folio: '13', computed: '13', state: 'reviewed' },
    ],
  },
  {
    caption: 'Plate + facing blank · scans 134–139', span: 'illustration held out of the count',
    rows: [
      { scan: 134, role: 'text',  run: 'body',   folio: '112', computed: '112', ok: true },
      { scan: 135, role: 'text',  run: 'body',   folio: '113', computed: '113', ok: true },
      { scan: 136, role: 'plate', run: 'plates', folio: null,  computed: '—', flag: 'unnumbered', tag: 'Plate VIII', note: 'faces p. 113 · recto' },
      { scan: 137, role: 'blank', run: null,     folio: null,  computed: '[Blank Page]', flag: 'marker', note: 'verso of plate' },
      { scan: 138, role: 'text',  run: 'body',   folio: '114', computed: '114', ok: true },
    ],
  },
  {
    caption: 'Blanks: counted vs held out · scans 140–143', span: 'a paginated blank verso, then an inserted blank',
    rows: [
      { scan: 140, role: 'text',  run: 'body', folio: '115', computed: '115', ok: true, note: 'last page of Ch. 7' },
      { scan: 141, role: 'blank', run: 'body', folio: null,  computed: '116', flag: 'countedBlank', note: 'blank verso — printer still counts it as p. 116' },
      { scan: 142, role: 'text',  run: 'body', folio: '117', computed: '117', ok: true, note: 'Ch. 8 opens on a recto' },
      { scan: 143, role: 'blank', run: null,   folio: null,  computed: '[Blank Page]', flag: 'marker', note: 'binder’s blank — inserted, not counted' },
    ],
  },
  {
    caption: 'Body → appendix · numbering continues', span: 'separate run, same arabic sequence',
    rows: [
      { scan: 325, role: 'text',  run: 'body',     folio: '310', computed: '310', ok: true },
      { scan: 326, role: 'blank', run: null,       folio: null,  computed: '[Blank Page]', flag: 'marker', note: 'end of body proper' },
      { scan: 327, role: 'text',  run: 'appendix', folio: '311', computed: '311', flag: 'continue', boundary: true, note: 'Appendix run — start set to Continue, picks up at 311' },
      { scan: 328, role: 'text',  run: 'appendix', folio: '312', computed: '312', ok: true },
    ],
  },
  {
    caption: 'Body → catalogue renumber · scans 359–364', span: 'a second arabic run, bound to the back',
    rows: [
      { scan: 360, role: 'text',  run: 'body', folio: '340', computed: '340', ok: true },
      { scan: 361, role: 'blank', run: null,   folio: null,  computed: '[Blank Page]', flag: 'marker', note: 'end of body' },
      { scan: 362, role: 'skip',  run: 'cover', folio: null, computed: '—', note: 'divider leaf — dropped' },
      { scan: 363, role: 'text',  run: 'cat',  folio: '1',   computed: '1', flag: 'renumber', boundary: true, note: "publisher's catalogue restarts at 1" },
      { scan: 364, role: 'text',  run: 'cat',  folio: '2',   computed: '2' },
    ],
  },
];

/* ====================================================================
   Header — title + live status line + stage actions
==================================================================== */
const PuHeader = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
    <div style={{ minWidth: 0 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Order &amp; numbering</h2>
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', maxWidth: 760, lineHeight: 1.5 }}>
        One workspace over the whole book: the <span style={{ color: 'var(--ink-1)' }}>map</span> shows every leaf in scan order, the <span style={{ color: 'var(--ink-1)' }}>runs</span> on the left set the numbering, and the <span style={{ color: 'var(--ink-1)' }}>ledger</span> reconciles each leaf's OCR folio against its computed label.
      </div>
      <div className="mono" style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', gap: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['358 / 387', 'numbered', 'var(--ink-1)'], ['9', 'out of sequence', 'var(--mismatch)'], ['3', 'gaps', 'var(--ocr)'], ['12', 'plates', 'var(--fuzzy)'], ['6', 'runs', 'var(--ink-1)']].map(([v, l, c], i) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i ? <span style={{ color: 'var(--border-3)', margin: '0 10px' }}>·</span> : null}
            <span style={{ color: c, fontWeight: 600 }}>{v}</span><span style={{ color: 'var(--ink-4)' }}>{l}</span>
          </span>
        ))}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
      <Button variant="default" size="sm" icon="refresh">Re-derive from OCR</Button>
      <Button variant="primary" size="sm" icon="check">Apply &amp; confirm</Button>
    </div>
  </div>
);

/* ====================================================================
   Ribbon (option A) — the map. Run bands + per-leaf ticks + out-of-seq
   notches. A handful of body ticks are flagged so the Sequence lens reads
   spatially.
==================================================================== */
const PU_OUTSEQ_TICKS = new Set([20, 21, 47, 96, 145, 260, 333]); // visual notch positions
const PuRibbon = () => {
  const runColor = { cover: 'var(--gt)', front: 'var(--ocr)', body: 'var(--exact)', plates: 'var(--fuzzy)', appendix: 'color-mix(in oklab, var(--exact) 55%, var(--accent))', cat: 'var(--accent)', null: 'var(--ink-4)' };
  const bandRuns = PR_RUNS.filter(r => r.span);
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 10, padding: '14px 18px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div className="label" style={{ color: 'var(--ink-3)' }}>Book map · scan order · 387 leaves</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 10.5, color: 'var(--ink-4)' }} className="mono">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--fuzzy)' }} />plate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, border: '1px solid var(--border-3)' }} />blank</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '6px solid var(--mismatch)' }} />out of sequence</span>
        </div>
      </div>
      {/* ticks */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 42, position: 'relative' }}>
        {PR_TICKS.map((t, i) => {
          const c = runColor[String(t.run)];
          const isPlate = t.kind === 'plate', isBlank = t.kind === 'blank', isSkip = t.kind === 'skip';
          const flagged = PU_OUTSEQ_TICKS.has(i);
          return (
            <div key={i} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative' }}>
              {flagged ? <span style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '3.5px solid transparent', borderRight: '3.5px solid transparent', borderTop: '6px solid var(--mismatch)' }} /> : null}
              <div style={{
                height: isPlate ? '78%' : isBlank ? '46%' : isSkip ? '34%' : '66%',
                borderRadius: '1px 1px 0 0',
                background: isBlank ? 'transparent' : flagged ? 'var(--mismatch)' : c,
                border: isBlank ? '1px solid var(--border-3)' : 'none',
                opacity: isSkip ? 0.5 : isPlate ? 1 : flagged ? 1 : 0.82,
              }} />
            </div>
          );
        })}
      </div>
      {/* run bands */}
      <div style={{ display: 'flex', gap: 3, marginTop: 9 }}>
        {bandRuns.map((r, i) => (
          <div key={r.id} style={{ flex: `${r.count} 0 0`, minWidth: 0, position: 'relative' }}>
            <div style={{ height: 4, borderRadius: 99, background: r.tone }} />
            <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
              {i < bandRuns.length - 1 ? <span style={{ position: 'absolute', right: -7, top: -3, width: 10, height: 10, borderRadius: 99, background: 'var(--bg-surface)', border: '1.5px solid var(--border-3)', cursor: 'ew-resize', zIndex: 2 }} /> : null}
            </div>
            <div className="mono" style={{ marginTop: 1, fontSize: 10, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{r.computed}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ====================================================================
   Spine (option B-left) — editable run list
==================================================================== */
const PuSpine = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="label" style={{ color: 'var(--ink-3)' }}>Numbering runs · {PR_RUNS.length}</span>
      <Button variant="ghost" size="sm" icon="plus">Add run</Button>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minHeight: 0 }}>
      {PR_RUNS.map(r => <PrRunRow key={r.id} run={r} active={r.id === 'body'} />)}
    </div>
    <div style={{ marginTop: 2, padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--border-2)', background: 'color-mix(in oklab, var(--exact) 4%, transparent)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name="info" size={12} style={{ color: 'var(--ink-4)', flex: '0 0 auto' }} />
      <span style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>Selecting a run scopes the map and ledger to it. Drag a run to reorder; drag a band edge on the map to split.</span>
    </div>
  </div>
);

/* ====================================================================
   Ledger toolbar — view toggle + filter lenses (+ density for grid)
==================================================================== */
const PuSeg = ({ options, active }) => (
  <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
    {options.map(o => {
      const a = o.id === active;
      return (
        <div key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>
          {o.icon ? <Icon name={o.icon} size={12} /> : null}{o.label}
          {o.count != null ? <span className="mono" style={{ fontSize: 10.5, padding: '0 5px', height: 15, borderRadius: 8, display: 'inline-flex', alignItems: 'center', background: a ? 'color-mix(in oklab, var(--mismatch) 16%, transparent)' : 'var(--bg-sunk)', color: a ? 'var(--mismatch)' : 'var(--ink-4)' }}>{o.count}</span> : null}
        </div>
      );
    })}
  </div>
);

const PuToolbar = ({ view, density }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)', flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <PuSeg active={view} options={[{ id: 'ledger', label: 'Ledger', icon: 'fileText' }, { id: 'grid', label: 'Grid', icon: 'copy' }]} />
      <span style={{ width: 1, height: 20, background: 'var(--border-2)' }} />
      <PuSeg active="all" options={[{ id: 'all', label: 'All' }, { id: 'seq', label: 'Out of sequence', count: 9 }, { id: 'plates', label: 'Plates & blanks' }, { id: 'renum', label: 'Renumbers' }]} />
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {view === 'grid' ? <PuSeg active={density} options={[{ id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }]} /> : null}
      <Button variant="ghost" size="sm" icon="search">Find leaf</Button>
    </div>
  </div>
);

/* ====================================================================
   Ledger body — the merged leaf table
==================================================================== */
const PuStatus = ({ r }) => {
  if (r.state === 'reviewed') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ocr)' }}><Icon name="check" size={10} stroke={3} />reviewed</span>;
  if (!r.flag) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--exact)' }}><Icon name="check" size={11} stroke={3} />in order</span>;
  const f = PU_FLAG[r.flag];
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 7px', borderRadius: 99, fontSize: 9.5, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 14%, var(--bg-surface))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 40%, transparent)` }}>
      <span style={{ width: 4.5, height: 4.5, borderRadius: 99, background: f.tone }} />{f.label}
    </span>
  );
};

const PuAction = ({ r }) => {
  if (r.want) return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mismatch)', fontWeight: 600 }}><Icon name="arrowUp" size={11} />→ #{String(r.want).padStart(2, '0')}</span>;
  if (r.flag === 'renumber') return <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent)', fontWeight: 600 }}>own seq</span>;
  if (r.flag === 'continue') return <span className="mono" style={{ fontSize: 10.5, color: 'var(--exact)', fontWeight: 600 }}>cont · 311</span>;
  if (r.flag === 'duplicate' || r.flag === 'gap' || r.flag === 'missingNumber') return <Button variant="ghost" size="sm">Resolve</Button>;
  if (r.flag === 'unnumbered' || r.flag === 'marker') return <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>held out</span>;
  return null;
};

const PuLedger = () => (
  <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
    {PU_WINDOWS.map((win, wi) => (
      <div key={wi}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 8px', background: wi ? 'color-mix(in oklab, var(--bg-raised) 50%, transparent)' : 'transparent', borderTop: wi ? '1px solid var(--border-1)' : 'none' }}>
          <span className="label" style={{ color: 'var(--ink-2)' }}>{win.caption}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{win.span}</span>
        </div>
        {win.rows.map((r, i) => {
          const tone = PU_RUN_TONE[r.run] || 'var(--ink-4)';
          return (
            <div key={r.scan} style={{ display: 'grid', gridTemplateColumns: '54px 38px 1.1fr 88px 1fr 1fr 96px', gap: 12, padding: '8px 14px', alignItems: 'center', borderTop: '1px solid var(--border-1)', background: r.boundary ? 'color-mix(in oklab, var(--accent) 6%, transparent)' : r.role === 'blank' ? 'color-mix(in oklab, var(--ink-3) 4%, transparent)' : r.flag && PU_LENS.seq.has(r.flag) ? `color-mix(in oklab, ${PU_FLAG[r.flag].tone} 5%, transparent)` : 'transparent' }}>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>#{r.scan}</span>
              <PrMini kind={r.role} w={26} h={34} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <PrRoleChip role={r.role} />
                {r.tag ? <span className="mono" style={{ fontSize: 10, color: 'var(--fuzzy)', fontWeight: 600 }}>{r.tag}</span> : null}
                {r.note ? <span style={{ fontSize: 10, color: 'var(--ink-4)', lineHeight: 1.35 }}>{r.note}</span> : null}
              </div>
              {/* OCR folio (+ suggest) */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="mono" style={{ fontSize: 12.5, color: r.folio ? 'var(--ink-2)' : 'var(--ink-4)' }}>{r.folio || '—'}</span>
                {r.suggest ? <><Icon name="arrowR" size={10} style={{ color: 'var(--ink-4)' }} /><span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--exact)' }}>{r.suggest}</span></> : null}
              </span>
              {/* computed label from run */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: tone, flex: '0 0 auto' }} />
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: r.role === 'blank' ? 'var(--ink-4)' : r.role === 'plate' ? 'var(--fuzzy)' : 'var(--ink-1)', padding: r.computed === '[Blank Page]' ? '2px 7px' : 0, background: r.computed === '[Blank Page]' ? 'var(--bg-sunk)' : 'transparent', borderRadius: 4, border: r.computed === '[Blank Page]' ? '1px dashed var(--border-3)' : 'none', whiteSpace: 'nowrap' }}>{r.computed}</span>
              </span>
              <PuStatus r={r} />
              <span style={{ textAlign: 'right' }}><PuAction r={r} /></span>
            </div>
          );
        })}
      </div>
    ))}
  </div>
);

/* ====================================================================
   Grid body — Pages, folded in. Same leaves, contact-sheet render,
   tinted by run; folio badge + flag dot.
==================================================================== */
const PU_GRID = (() => {
  // a contiguous contact sheet: front matter, body with a plate+blank and a
  // couple of out-of-seq leaves, then the catalogue restart.
  const out = [];
  const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
  let scan = 1;
  roman.slice(0, 8).forEach((f, i) => out.push({ scan: scan++, role: 'text', run: 'front', folio: i === 2 ? null : f, flag: i === 2 ? 'missingNumber' : null }));
  for (let n = 1; n <= 26; n++) {
    let flag = null;
    if (n === 3) flag = 'outOfSequence';
    if (n === 7) flag = 'gap';
    out.push({ scan: scan++, role: 'text', run: 'body', folio: String(n), flag });
    if (n === 9) { out.push({ scan: scan++, role: 'plate', run: 'plates', folio: null, flag: 'unnumbered', tag: 'Pl.' }); out.push({ scan: scan++, role: 'blank', run: null, folio: null, flag: 'marker' }); }
  }
  out.push({ scan: scan++, role: 'skip', run: 'cover', folio: null });
  for (let n = 1; n <= 6; n++) out.push({ scan: scan++, role: 'text', run: 'cat', folio: String(n), flag: n === 1 ? 'renumber' : null });
  return out;
})();

const PuGrid = ({ density = 'M' }) => {
  const cols = density === 'L' ? 8 : density === 'S' ? 16 : 12;
  const w = density === 'L' ? 92 : density === 'S' ? 46 : 64;
  const h = density === 'L' ? 116 : density === 'S' ? 58 : 82;
  return (
    <div style={{ overflow: 'auto', flex: 1, minHeight: 0, padding: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: density === 'S' ? 4 : 7 }}>
        {PU_GRID.map(r => {
          const tone = PU_RUN_TONE[r.run] || 'var(--ink-4)';
          const isBlank = r.role === 'blank', isPlate = r.role === 'plate', isSkip = r.role === 'skip';
          const f = r.flag ? PU_FLAG[r.flag] : null;
          return (
            <div key={r.scan} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ width: w, height: h, borderRadius: 3, position: 'relative', overflow: 'hidden', background: isSkip ? 'var(--bg-sunk)' : '#fff', boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${tone} 55%, rgba(40,40,40,0.16))`, opacity: isSkip ? 0.55 : 1 }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: tone, opacity: 0.85 }} />
                {isPlate ? <div style={{ position: 'absolute', inset: 5, top: 8, borderRadius: 1, background: `color-mix(in oklab, ${tone} 26%, var(--bg-sunk))`, display: 'grid', placeItems: 'center', color: tone }}><Icon name="image" size={w * 0.34} /></div>
                  : isBlank ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--ink-4)' }} /></div>
                  : !isSkip ? <div style={{ position: 'absolute', inset: '20% 18%', backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.18 0 0) 0 1px, transparent 1px 4px)', opacity: 0.5 }} /> : null}
                {/* folio badge */}
                {density !== 'S' || !f ? <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', minWidth: 16, height: density === 'S' ? 13 : 16, padding: '0 5px', borderRadius: 3, background: f && PU_LENS.seq.has(r.flag) ? `color-mix(in oklab, ${f.tone} 88%, black)` : 'rgba(12,12,16,0.74)', color: '#fff', fontSize: density === 'S' ? 8 : 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)', display: 'grid', placeItems: 'center' }}>{r.folio || (isBlank ? '∅' : '—')}</div> : null}
                {/* flag dot */}
                {f && r.flag !== 'marker' ? <span style={{ position: 'absolute', top: 6, right: 4, width: 7, height: 7, borderRadius: 99, background: f.tone, boxShadow: '0 0 0 1.5px var(--bg-surface)' }} /> : null}
                {r.tag ? <span className="mono" style={{ position: 'absolute', top: 5, left: 4, fontSize: 7.5, fontWeight: 700, color: tone, background: 'rgba(255,255,255,0.82)', padding: '0 2px', borderRadius: 2 }}>{r.tag}</span> : null}
              </div>
              {density !== 'S' ? <span className="mono" style={{ fontSize: 8.5, color: 'var(--ink-4)' }}>#{r.scan}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ====================================================================
   The workspace — ribbon (map) + spine (runs) + panel (ledger / grid)
==================================================================== */
const PoWorkbench = ({ view = 'ledger', density = 'M' }) => (
  <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
    <PuHeader />
    <PuRibbon />
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14, flex: 1, minHeight: 0 }}>
      <PuSpine />
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <PuToolbar view={view} density={density} />
        {view === 'grid' ? <PuGrid density={density} /> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '54px 38px 1.1fr 88px 1fr 1fr 96px', gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-page)' }}>
              {['scan', '', 'role', 'OCR folio', 'computed', 'status', 'action'].map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)', textAlign: i === 6 ? 'right' : 'left' }}>{h}</span>)}
            </div>
            <PuLedger />
          </>
        )}
      </div>
    </div>
  </div>
);

// Flat leaf list (for the leaf inspector / page-level workbench).
const PU_LEAVES_FLAT = PU_WINDOWS.flatMap(w => w.rows);

Object.assign(window, { PoWorkbench, PuHeader, PuRibbon, PuToolbar, PuSeg, PuStatus, PU_FLAG, PU_LENS, PU_RUN_TONE, PU_WINDOWS, PU_LEAVES_FLAT });
