// page-roles.jsx — "Runs" tab (Page roles & numbering) for the Page order
// stage. Three explorations of the same model (see pr-data.js):
//   RolesRibbon   (A) — whole-book scan ribbon + run bands, spatial
//   RolesList     (B) — editable run list + per-leaf reconciliation table
//   RolesOutline  (C) — book-structure outline, one section per run
//
// All three edit the same primitive: an ordered list of numbering runs, with
// per-leaf roles (text / plate / [Blank Page] / skip). Each is annotated for
// the three hard cases: [Blank Page] markers, unnumbered plate + facing
// blank, and a back-bound catalogue that renumbers.

/* ====================================================================
   Shared primitives
==================================================================== */

const PrMini = ({ kind = 'text', w = 26, h = 34, label }) => {
  // a tiny page glyph tinted by role
  const role = PR_ROLES[kind] || PR_ROLES.text;
  const isBlank = kind === 'blank', isPlate = kind === 'plate', isSkip = kind === 'skip';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
      <div style={{
        width: w, height: h, borderRadius: 2, position: 'relative', overflow: 'hidden',
        background: isSkip ? 'var(--bg-sunk)' : '#fff',
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${role.tone} 45%, rgba(40,40,40,0.18))`,
        opacity: isSkip ? 0.6 : 1,
      }}>
        {isPlate ? (
          <div style={{ position: 'absolute', inset: 4, borderRadius: 1, background: `color-mix(in oklab, ${role.tone} 30%, var(--bg-sunk))`, display: 'grid', placeItems: 'center', color: role.tone }}>
            <Icon name="image" size={Math.min(w, h) * 0.42} />
          </div>
        ) : isBlank ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--ink-4)' }} />
          </div>
        ) : !isSkip ? (
          <div style={{ position: 'absolute', inset: '18% 16%', backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.2 0 0) 0 1px, transparent 1px 4px)', opacity: 0.45 }} />
        ) : null}
      </div>
      {label != null ? <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: label === '[Blank Page]' ? 'var(--ink-4)' : 'var(--ink-2)', whiteSpace: 'nowrap' }}>{label}</span> : null}
    </div>
  );
};

const PrRoleChip = ({ role, sm }) => {
  const r = PR_ROLES[role]; if (!r) return null;
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: sm ? 16 : 18, padding: sm ? '0 6px' : '0 7px',
      borderRadius: 99, fontSize: sm ? 9.5 : 10, fontWeight: 600,
      background: `color-mix(in oklab, ${r.tone} 14%, var(--bg-surface))`, color: r.tone,
      border: `1px solid color-mix(in oklab, ${r.tone} 40%, transparent)`,
    }}>
      <span style={{ width: 4.5, height: 4.5, borderRadius: 99, background: r.tone }} />{r.short}
    </span>
  );
};

const PrStyleSelect = ({ value, tone = 'var(--ink-2)' }) => {
  const s = PR_STYLES[value] || PR_STYLES.arabic;
  return (
    <div style={{ height: 28, padding: '0 8px 0 10px', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: tone }} />
      <span style={{ fontSize: 12, color: 'var(--ink-1)', fontWeight: 500 }}>{s.label}</span>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{s.sample}</span>
      <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)', marginLeft: 2 }} />
    </div>
  );
};

const PrStat = ({ label, value, tone = 'ink-1', sub }) => (
  <div style={{ background: 'var(--bg-surface)', padding: '12px 14px 11px' }}>
    <div className="label" style={{ color: 'var(--ink-3)' }}>{label}</div>
    <div className="mono" style={{ marginTop: 5, fontSize: 17, fontWeight: 600, color: tone.startsWith('var') ? tone : `var(--${tone})`, letterSpacing: '-0.01em' }}>{value}</div>
    {sub ? <div className="mono" style={{ marginTop: 2, fontSize: 10, color: 'var(--ink-4)' }}>{sub}</div> : null}
  </div>
);

// Header strip shared by all three: title + the run legend + stats.
const PrHeader = ({ title, sub }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
    <div style={{ minWidth: 0 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>{title}</h2>
      <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', maxWidth: 720, lineHeight: 1.5 }}>{sub}</div>
    </div>
    <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
      <Button variant="default" size="sm" icon="refresh">Re-derive from OCR</Button>
      <Button variant="primary" size="sm" icon="check">Confirm plan</Button>
    </div>
  </div>
);

/* ====================================================================
   OPTION A — RolesRibbon : whole-book scan ribbon + run bands
==================================================================== */
const RolesRibbon = () => {
  const runColor = { cover: 'var(--gt)', front: 'var(--ocr)', body: 'var(--exact)', plates: 'var(--fuzzy)', cat: 'var(--accent)', null: 'var(--ink-4)' };
  // Band geometry: contiguous runs laid as proportional segments. Plates are
  // not contiguous so they render as the notches in the ribbon, not a band.
  const bandRuns = PR_RUNS.filter(r => r.span);
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <PrHeader title="Page roles & numbering" sub="The book as an ordered set of numbering runs over the scans. Drag a boundary to split or merge a run; plates and blanks sit between runs without breaking the count." />

      {/* legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--ink-3)' }}>
        {PR_RUNS.map(r => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: r.tone }} />
            <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{r.label}</span>
            <span className="mono" style={{ color: 'var(--ink-4)' }}>{r.computed}</span>
          </span>
        ))}
      </div>

      {/* ribbon */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 10, padding: '18px 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="label" style={{ color: 'var(--ink-3)' }}>Scan order · 387 leaves</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>each mark = one leaf · taller = plate · hollow = blank</div>
        </div>
        {/* ticks */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 40 }}>
          {PR_TICKS.map((t, i) => {
            const c = runColor[String(t.run)];
            const isPlate = t.kind === 'plate', isBlank = t.kind === 'blank', isSkip = t.kind === 'skip';
            return <div key={i} style={{
              flex: 1, minWidth: 0,
              height: isPlate ? '100%' : isBlank ? '46%' : isSkip ? '34%' : '68%',
              borderRadius: '1px 1px 0 0',
              background: isBlank ? 'transparent' : c,
              border: isBlank ? '1px solid var(--border-3)' : 'none',
              opacity: isSkip ? 0.5 : isPlate ? 1 : 0.85,
            }} />;
          })}
        </div>
        {/* run bands */}
        <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
          {bandRuns.map((r, i) => {
            const w = (r.count / 384) * 100;
            return (
              <div key={r.id} style={{ flex: `${r.count} 0 0`, minWidth: 0, position: 'relative' }}>
                <div style={{ height: 4, borderRadius: 99, background: r.tone }} />
                <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
                  {/* boundary grip */}
                  {i < bandRuns.length - 1 ? <span style={{ position: 'absolute', right: -7, top: -3, width: 10, height: 10, borderRadius: 99, background: 'var(--bg-surface)', border: '1.5px solid var(--border-3)', cursor: 'ew-resize', zIndex: 2 }} /> : null}
                </div>
                <div className="mono" style={{ marginTop: 1, fontSize: 10, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{r.computed}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* run cards row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {PR_RUNS.map(r => (
          <div key={r.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderLeft: `3px solid ${r.tone}`, borderRadius: 8, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
              <PrRoleChip role={r.role} sm />
            </div>
            <PrStyleSelect value={r.style} tone={r.tone} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="label" style={{ color: 'var(--ink-4)' }}>start</span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-1)', minWidth: 22, height: 22, padding: '0 7px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 5 }}>{r.start}</span>
              </div>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{r.count} leaves</span>
            </div>
            {r.note ? <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{r.note}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ====================================================================
   OPTION B — RolesList : editable run list (left) + leaf table (right)
==================================================================== */
// start control — Set (explicit value) or Continue (pick up the previous
// numbering run's last number). Unnumbered runs (style 'none') just show —.
const PrStart = ({ run }) => {
  if (run.style === 'none') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span className="label" style={{ color: 'var(--ink-4)' }}>start</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-4)', height: 26, padding: '0 9px', display: 'inline-flex', alignItems: 'center', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 6 }}>—</span>
    </div>
  );
  // runs that can be a continue source: an EARLIER numbering run with a
  // numeric last label. Default source = the nearest one (last in the list).
  const myIdx = PR_RUNS.indexOf(run);
  const sources = PR_RUNS.filter((r, i) => i < myIdx && r.style !== 'none' && typeof r.lastNum === 'number');
  const nearest = sources.length ? sources[sources.length - 1] : null;

  const [mode, setMode] = React.useState(run.startMode === 'continue' && nearest ? 'continue' : 'set');
  const [fromId, setFromId] = React.useState(nearest ? nearest.id : '');
  const fromRun = PR_RUNS.find(r => r.id === fromId) || nearest;
  const isCont = mode === 'continue' && !!fromRun;
  const display = isCont ? String(fromRun.lastNum + (run.step || 1)) : run.start;
  const canContinue = sources.length > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className="label" style={{ color: 'var(--ink-4)' }}>start</span>
      <div style={{ display: 'inline-flex', padding: 2, gap: 2, background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 6 }}>
        {[['set', 'Set'], ['continue', 'Continue']].map(([id, lbl]) => {
          const a = (id === 'continue') === isCont;
          const disabled = id === 'continue' && !canContinue;
          return <span key={id} onClick={() => !disabled && setMode(id)} title={disabled ? 'No earlier numbered run to continue from' : ''} style={{ fontSize: 10.5, fontWeight: a ? 600 : 500, padding: '3px 7px', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-4)' }}>{lbl}</span>;
        })}
      </div>
      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: isCont ? 'var(--accent)' : 'var(--ink-1)', height: 26, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bg-page)', border: `1px solid ${isCont ? 'color-mix(in oklab, var(--accent) 45%, var(--border-2))' : 'var(--border-2)'}`, borderRadius: 6 }}>
        {isCont ? <Icon name="arrowR" size={10} /> : null}{display}
      </span>
      {isCont ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>from</span>
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <select value={fromId} onChange={e => setFromId(e.target.value)} style={{ appearance: 'none', WebkitAppearance: 'none', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 600, color: 'var(--ink-1)', padding: '2px 18px 2px 7px', height: 22, background: 'var(--bg-surface)', border: '1px solid var(--border-2)', borderRadius: 5, cursor: 'pointer' }}>
              {sources.map(s => <option key={s.id} value={s.id}>{s.label}{s.id === nearest.id ? ' (nearest)' : ''}</option>)}
            </select>
            <Icon name="chevD" size={10} style={{ position: 'absolute', right: 5, color: 'var(--ink-4)', pointerEvents: 'none' }} />
          </span>
        </span>
      ) : null}
    </div>
  );
};

const PrRunRow = ({ run, active }) => (
  <div style={{
    padding: '11px 12px', borderRadius: 8, cursor: 'pointer',
    background: active ? `color-mix(in oklab, ${run.tone} 7%, var(--bg-surface))` : 'var(--bg-surface)',
    border: `1px solid ${active ? `color-mix(in oklab, ${run.tone} 45%, var(--border-1))` : 'var(--border-1)'}`,
    display: 'flex', flexDirection: 'column', gap: 9,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name="grip" size={13} style={{ color: 'var(--ink-4)', cursor: 'grab', flex: '0 0 auto' }} />
      <span style={{ width: 8, height: 8, borderRadius: 2, background: run.tone, flex: '0 0 auto' }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{run.label}</span>
      <PrRoleChip role={run.role} sm />
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <PrStyleSelect value={run.style} tone={run.tone} />
      <PrStart run={run} />
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
        {run.span ? `scans ${run.span[0]}–${run.span[1]}` : 'interleaved'} · {run.count} leaves
      </span>
      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: run.tone }}>{run.computed}</span>
    </div>
  </div>
);

const PrLeafTable = ({ rows, caption }) => (
  <div>
    {caption ? <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="label" style={{ color: 'var(--ink-3)' }}>{caption}</span>
    </div> : null}
    {rows.map((r, i) => {
      const role = PR_ROLES[r.role];
      const isBoundary = r.boundary;
      const flagTone = r.flag === 'unnumbered' ? 'var(--fuzzy)' : r.flag === 'marker' ? 'var(--ink-3)' : r.flag === 'renumber' ? 'var(--accent)' : null;
      return (
        <div key={r.scan} style={{
          display: 'grid', gridTemplateColumns: '54px 40px 1fr 96px 1fr', gap: 12, padding: '8px 14px', alignItems: 'center',
          borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
          background: isBoundary ? 'color-mix(in oklab, var(--accent) 6%, transparent)' : r.role === 'blank' ? 'color-mix(in oklab, var(--ink-3) 4%, transparent)' : 'transparent',
        }}>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>#{r.scan}</span>
          <PrMini kind={r.role} w={26} h={34} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <PrRoleChip role={r.role} />
            {r.tag ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--fuzzy)', fontWeight: 600 }}>{r.tag}</span> : null}
            {r.note ? <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{r.note}</span> : null}
          </div>
          <span className="mono" style={{ fontSize: 12, color: r.folio ? 'var(--ink-2)' : 'var(--ink-4)' }}>{r.folio || '—'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{
              fontSize: 12.5, fontWeight: 700,
              color: r.role === 'blank' ? 'var(--ink-4)' : r.role === 'plate' ? 'var(--fuzzy)' : 'var(--ink-1)',
              padding: r.label === '[Blank Page]' ? '2px 7px' : '0',
              background: r.label === '[Blank Page]' ? 'var(--bg-sunk)' : 'transparent',
              borderRadius: 4, border: r.label === '[Blank Page]' ? '1px dashed var(--border-3)' : 'none',
            }}>{r.label}</span>
            {flagTone ? <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: flagTone }}>{r.flag}</span> : null}
          </div>
        </div>
      );
    })}
  </div>
);

const RolesList = () => (
  <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
    <PrHeader title="Page roles & numbering" sub="Runs are explicit, ordered, and reorderable. Edit a run's style and start on the left; the table on the right shows every leaf's computed label reconciled against the OCR folio." />
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 14, flex: 1, minHeight: 0 }}>
      {/* left — runs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="label" style={{ color: 'var(--ink-3)' }}>Numbering runs · {PR_RUNS.length}</span>
          <Button variant="ghost" size="sm" icon="plus">Add run</Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          {PR_RUNS.map((r, i) => <PrRunRow key={r.id} run={r} active={r.id === 'body'} />)}
        </div>
      </div>
      {/* right — leaf table */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '54px 40px 1fr 96px 1fr', gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)' }}>
          {['scan', '', 'role', 'OCR folio', 'computed label'].map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)' }}>{h}</span>)}
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          <PrLeafTable rows={PR_LEAVES_PLATE} caption="Body · plate + facing blank (scans 134–139)" />
          <div style={{ height: 1, background: 'var(--border-1)' }} />
          <PrLeafTable rows={PR_LEAVES_APPENDIX} caption="Body → appendix · numbering CONTINUES (scans 324–328)" />
          <div style={{ height: 1, background: 'var(--border-1)' }} />
          <PrLeafTable rows={PR_LEAVES_CAT} caption="Body → catalogue renumber (scans 359–364)" />
        </div>
      </div>
    </div>
  </div>
);

/* ====================================================================
   OPTION C — RolesOutline : book-structure outline, one section per run
==================================================================== */
const PrOutlineSection = ({ run, leaves, defaultOpen = true }) => {
  const sampleLeaves = leaves || [];
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 10, overflow: 'hidden' }}>
      {/* section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderLeft: `3px solid ${run.tone}` }}>
        <Icon name="chevD" size={14} style={{ color: 'var(--ink-3)', transform: defaultOpen ? 'none' : 'rotate(-90deg)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{run.label}</span>
            <PrRoleChip role={run.role} sm />
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{run.count} leaves</span>
          </div>
        </div>
        {/* inline numbering control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PrStyleSelect value={run.style} tone={run.tone} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="label" style={{ color: 'var(--ink-4)' }}>from</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-1)', height: 28, padding: '0 9px', display: 'inline-flex', alignItems: 'center', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 6 }}>{run.start}</span>
          </div>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: run.tone, minWidth: 84, textAlign: 'right' }}>{run.computed}</span>
        </div>
      </div>
      {/* leaf strip */}
      {sampleLeaves.length ? (
        <div style={{ padding: '12px 16px 14px', borderTop: '1px solid var(--border-1)', background: 'var(--bg-page)' }}>
          {run.note ? <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="info" size={11} style={{ color: 'var(--ink-4)' }} />{run.note}</div> : null}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {sampleLeaves.map(l => (
              <div key={l.scan} style={{ position: 'relative' }}>
                <PrMini kind={l.role} w={36} h={48} label={l.label} />
                {l.tag ? <span className="mono" style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', fontSize: 8.5, fontWeight: 700, color: 'var(--fuzzy)', background: 'var(--bg-surface)', padding: '0 3px', borderRadius: 2, whiteSpace: 'nowrap' }}>{l.tag}</span> : null}
              </div>
            ))}
            {run.id === 'body' ? <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: 48, color: 'var(--ink-4)', fontSize: 11 }} className="mono">…340 leaves…</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const RolesOutline = () => {
  const byId = Object.fromEntries(PR_RUNS.map(r => [r.id, r]));
  // leaf samples per section
  const frontLeaves = [
    { scan: 5, role: 'text', label: 'i' }, { scan: 6, role: 'text', label: 'ii' },
    { scan: 7, role: 'blank', label: '[Blank Page]' }, { scan: 8, role: 'text', label: 'iv' },
    { scan: 9, role: 'text', label: 'v' },
  ];
  const bodyLeaves = PR_LEAVES_PLATE;
  const catLeaves = [
    { scan: 363, role: 'text', label: '1' }, { scan: 364, role: 'text', label: '2' },
    { scan: 365, role: 'text', label: '3' }, { scan: 366, role: 'text', label: '4' },
  ];
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <PrHeader title="Page roles & numbering" sub="The book's structure as an outline. Each section is one numbering run with its scheme inline; reads like the table of contents you're authoring. Append a run for anything bound to the back." />
      {/* stat band */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        <PrStat label="leaves" value={PR_TOTALS.leaves} />
        <PrStat label="runs" value={PR_TOTALS.runs} tone="ink-1" />
        <PrStat label="text" value={PR_TOTALS.text} tone="exact" />
        <PrStat label="plates" value={PR_TOTALS.plates} tone="fuzzy" sub="unnumbered" />
        <PrStat label="[blank]" value={PR_TOTALS.blanks} tone="ink-2" sub="markers" />
        <PrStat label="unresolved" value={PR_TOTALS.unresolved} tone={PR_TOTALS.unresolved ? 'mismatch' : 'ink-2'} sub="needs role" />
      </div>
      {/* outline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto', flex: 1, minHeight: 0 }}>
        <PrOutlineSection run={byId.cover} leaves={[]} defaultOpen={false} />
        <PrOutlineSection run={byId.front} leaves={frontLeaves} />
        <PrOutlineSection run={byId.body} leaves={bodyLeaves} />
        <PrOutlineSection run={byId.plates} leaves={[{ scan: 136, role: 'plate', label: '—', tag: 'Plate VIII' }, { scan: 137, role: 'blank', label: '[Blank Page]' }]} />
        <PrOutlineSection run={byId.cat} leaves={catLeaves} />
        <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: '1.5px dashed var(--border-2)', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit' }}>
          <Icon name="plus" size={14} /> Append a run — appendix, index, or bound-in catalogue
        </button>
      </div>
    </div>
  );
};

Object.assign(window, { RolesRibbon, RolesList, RolesOutline });
