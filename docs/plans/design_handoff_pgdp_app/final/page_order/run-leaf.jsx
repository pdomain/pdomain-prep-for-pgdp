// run-leaf.jsx — Run management + leaf-level editing for the Order & numbering
// workspace.
//   • + Add run        → RunAddForm
//   • Edit / remove run → RunEditCard (remove → merge up)
//   • Plates & blanks   → reframed: NOT runs. Spine separates editable
//        "Numbering runs" from read-only "Holds" (plate/blank/skip counts).
//   • Role & numbering run are edited INLINE in each ledger row (dropdowns).
//   • The leaf inspector (page-level workbench) holds the richer per-leaf
//        detail: folio override, plate tag, fold-out segments, output name,
//        read history, and "Open scan" (the full-res page image).
//
// Reuses on window: Icon, Button, PrMini, PrRoleChip, PR_RUNS, PR_ROLES,
// PR_STYLES, PuHeader, PuRibbon, PU_FLAG, PU_RUN_TONE, PU_LEAVES_FLAT.

const { useState: useRL } = React;

/* ====================================================================
   Shared bits
==================================================================== */
const RL_ROLE_OPTS = [
  { id: 'text',  label: 'Text' },
  { id: 'plate', label: 'Plate' },
  { id: 'blank', label: 'Blank' },
  { id: 'fold',  label: 'Fold-out' },
  { id: 'skip',  label: 'Skip' },
];
const RUN_LABEL = Object.fromEntries(PR_RUNS.map(r => [r.id, r.label]));
const RUN_OPTS = [...PR_RUNS.map(r => ({ id: r.id, label: r.label, tone: r.tone })), { id: '__none', label: '— between runs —', tone: 'var(--ink-4)' }];
const roleTone = id => (PR_ROLES[id] || PR_ROLES.text).tone;

// merge static leaves with in-session edits + a reorderable order
const usePageEdits = () => {
  const [edits, setEdits] = useRL({});
  const [order, setOrder] = useRL(() => PU_LEAVES_FLAT.map(l => l.scan));
  const byScan = React.useMemo(() => Object.fromEntries(PU_LEAVES_FLAT.map(l => [l.scan, l])), []);
  const leaves = order.map(s => ({ ...byScan[s], ...edits[s] }));
  const patch = (scan, p) => setEdits(e => ({ ...e, [scan]: { ...e[scan], ...p } }));
  const move = (scans, target, after) => setOrder(o => {
    const set = new Set(scans);
    const moved = o.filter(s => set.has(s));
    if (!moved.length || target == null) return o;
    const rest = o.filter(s => !set.has(s));
    const idx = rest.indexOf(target);
    if (idx === -1) return o;
    const at = after ? idx + 1 : idx;
    return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  });
  return { leaves, patch, move };
};

const RlField = ({ label, children, hint }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <span className="label" style={{ color: 'var(--ink-3)' }}>{label}</span>
    {children}
    {hint ? <span style={{ fontSize: 10.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>{hint}</span> : null}
  </div>
);

const RlInput = ({ value, onChange, placeholder, mono = true, w }) => (
  <input value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder}
    className={mono ? 'mono' : undefined}
    style={{ width: w || '100%', boxSizing: 'border-box', height: 32, padding: '0 10px', fontSize: 13, fontWeight: mono ? 600 : 500, color: 'var(--ink-1)', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 7, outline: 'none' }} />
);

const RlSeg = ({ options, value, onChange, sm }) => (
  <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 7, flexWrap: 'wrap' }}>
    {options.map(o => {
      const a = o.id === value;
      return <span key={o.id} onClick={() => onChange?.(o.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: sm ? 11 : 12, fontWeight: a ? 600 : 500, padding: sm ? '4px 9px' : '5px 11px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)' }}>{o.icon ? <Icon name={o.icon} size={12} /> : null}{o.label}</span>;
    })}
  </div>
);

const RlSelectish = ({ children, tone }) => (
  <div style={{ height: 32, padding: '0 8px 0 11px', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 7, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
    {tone ? <span style={{ width: 7, height: 7, borderRadius: 99, background: tone }} /> : null}
    <span style={{ fontSize: 12.5, color: 'var(--ink-1)', fontWeight: 500, flex: 1 }}>{children}</span>
    <Icon name="chevD" size={13} style={{ color: 'var(--ink-3)' }} />
  </div>
);

const RlToggle = ({ on, onClick, label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
    <div onClick={onClick} style={{ width: 36, height: 21, borderRadius: 99, padding: 2, background: on ? 'var(--accent)' : 'var(--border-3)', cursor: 'pointer', flex: '0 0 auto' }}>
      <div style={{ width: 17, height: 17, borderRadius: 99, background: '#fff', transform: on ? 'translateX(15px)' : 'none', transition: 'transform .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </div>
    <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{label}</span>
  </div>
);

/* ====================================================================
   Inline row dropdown (role / run)
==================================================================== */
const RowSelect = ({ tone, label, placeholder, open, onToggle }) => (
  <div onClick={e => { e.stopPropagation(); onToggle(); }} style={{ height: 27, padding: '0 6px 0 8px', background: open ? 'var(--bg-raised)' : 'var(--bg-page)', border: `1px solid ${open ? 'color-mix(in oklab, var(--accent) 45%, var(--border-2))' : 'var(--border-2)'}`, borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
    {tone ? <span style={{ width: 7, height: 7, borderRadius: 2, background: tone, flex: '0 0 auto' }} /> : null}
    <span style={{ fontSize: 11.5, color: label ? 'var(--ink-1)' : 'var(--ink-4)', fontWeight: 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label || placeholder}</span>
    <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)', flex: '0 0 auto' }} />
  </div>
);

const DDMenu = ({ options, current, onPick }) => (
  <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 31, left: 0, zIndex: 30, minWidth: 158, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, boxShadow: '0 12px 32px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08)', padding: 5, display: 'flex', flexDirection: 'column', gap: 1 }}>
    {options.map(o => {
      const a = o.id === current;
      return (
        <div key={o.id} onClick={() => onPick(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: a ? 'var(--bg-raised)' : 'transparent' }}>
          {o.tone ? <span style={{ width: 7, height: 7, borderRadius: 2, background: o.tone, flex: '0 0 auto' }} /> : <span style={{ width: 7, flex: '0 0 auto' }} />}
          <span style={{ fontSize: 12, color: 'var(--ink-1)', flex: 1 }}>{o.label}</span>
          {a ? <Icon name="check" size={12} style={{ color: 'var(--accent)', flex: '0 0 auto' }} /> : null}
        </div>
      );
    })}
  </div>
);

/* ====================================================================
   PRO LEDGER — role/run editable inline; selectable + drag-to-reorder
==================================================================== */
const GRID_BASE = '44px 26px 110px minmax(120px,1fr) 52px 78px 92px';
const GRID_REORDER = '24px 46px 24px 104px minmax(110px,1fr) 46px 70px 84px';

const RlCheck = ({ on, onClick }) => (
  <span onClick={e => { e.stopPropagation(); onClick(); }} style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-3)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: '0 0 auto' }}>
    {on ? <Icon name="check" size={11} stroke={3} style={{ color: '#fff' }} /> : null}
  </span>
);

const RlMoveTo = ({ label, onGo }) => {
  const [v, setV] = useRL('');
  const go = () => { const n = parseInt(v, 10); if (!isNaN(n)) { onGo(n); setV(''); } };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{label}</span>
      <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="#" className="mono" style={{ width: 52, height: 28, padding: '0 8px', fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', background: 'var(--bg-surface)', border: '1px solid var(--border-2)', borderRadius: 6, outline: 'none' }} />
      <Button variant="default" size="sm" onClick={go}>Go</Button>
    </div>
  );
};

const RlBulkBar = ({ count, onBefore, onAfter, onClear }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 14px', borderBottom: '1px solid var(--border-1)', background: 'color-mix(in oklab, var(--accent) 8%, var(--bg-raised))', flexWrap: 'wrap' }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}><Icon name="grip" size={13} style={{ color: 'var(--accent)' }} />{count} selected</span>
    <span style={{ width: 1, height: 18, background: 'var(--border-2)' }} />
    <RlMoveTo label="Move before #" onGo={onBefore} />
    <RlMoveTo label="or after #" onGo={onAfter} />
    <span style={{ flex: 1 }} />
    <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>…or drag the handle</span>
    <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
  </div>
);

const ProLedger = ({ leaves, selected, onSelect, onEdit, openDD, setOpenDD, reorderable, selSet, onToggleSel, onMove }) => {
  const [drag, setDrag] = useRL(null);   // { scans }
  const [over, setOver] = useRL(null);   // { scan, after }
  const cols = reorderable ? GRID_REORDER : GRID_BASE;
  const heads = reorderable ? ['', 'scan', '', 'role', 'numbering run', 'OCR', 'label', 'status'] : ['scan', '', 'role', 'numbering run', 'OCR', 'label', 'status'];
  const startDrag = scan => setDrag({ scans: (selSet && selSet.has(scan)) ? [...selSet] : [scan] });
  const doDrop = () => { if (drag && over && onMove) onMove(drag.scans, over.scan, over.after); setDrag(null); setOver(null); };
  return (
    <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }} onDragEnd={() => { setDrag(null); setOver(null); }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-page)', position: 'sticky', top: 0, zIndex: 2 }}>
        {heads.map((h, i) => <span key={i} className="label" style={{ color: 'var(--ink-4)' }}>{h}</span>)}
      </div>
      {leaves.map(r => {
        const role = r.role || 'text';
        const tone = PU_RUN_TONE[r.run] || 'var(--ink-4)';
        const sel = r.scan === selected;
        const runObj = PR_RUNS.find(x => x.id === r.run);
        const ddRole = openDD && openDD.scan === r.scan && openDD.field === 'role';
        const ddRun = openDD && openDD.scan === r.scan && openDD.field === 'run';
        const heldBlank = role === 'blank' && r.computed === '[Blank Page]';
        const dragging = drag && drag.scans.includes(r.scan);
        const isOver = over && over.scan === r.scan;
        return (
          <div key={r.scan} onClick={() => onSelect?.(r.scan)} title={`original: IMG_${String(8800 + r.scan).padStart(4, '0')}.tif`}
            draggable={reorderable || undefined}
            onDragStart={reorderable ? e => { e.dataTransfer.effectAllowed = 'move'; startDrag(r.scan); } : undefined}
            onDragOver={reorderable ? e => { e.preventDefault(); const rc = e.currentTarget.getBoundingClientRect(); const after = (e.clientY - rc.top) > rc.height / 2; setOver(o => (o && o.scan === r.scan && o.after === after) ? o : { scan: r.scan, after }); } : undefined}
            onDrop={reorderable ? e => { e.preventDefault(); doDrop(); } : undefined}
            style={{ position: 'relative', display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '7px 14px', alignItems: 'center', borderTop: '1px solid var(--border-1)', cursor: reorderable ? 'grab' : 'pointer', opacity: dragging ? 0.45 : 1, zIndex: (ddRole || ddRun) ? 5 : 'auto', background: sel ? 'color-mix(in oklab, var(--accent) 9%, var(--bg-surface))' : (selSet && selSet.has(r.scan)) ? 'color-mix(in oklab, var(--accent) 5%, transparent)' : r.boundary ? 'color-mix(in oklab, var(--accent) 5%, transparent)' : 'transparent', boxShadow: sel ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
            {isOver ? <span style={{ position: 'absolute', left: 0, right: 0, [over.after ? 'bottom' : 'top']: -1, height: 2, background: 'var(--accent)', zIndex: 6 }} /> : null}
            {reorderable ? <span style={{ display: 'flex', justifyContent: 'center' }}><RlCheck on={selSet?.has(r.scan)} onClick={() => onToggleSel?.(r.scan)} /></span> : null}
            {reorderable ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon name="grip" size={13} style={{ color: 'var(--ink-4)', cursor: 'grab', flex: '0 0 auto' }} />
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.scan}</span>
              </span>
            ) : (
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>#{r.scan}</span>
            )}
            <PrMini kind={role} w={24} h={31} />
            <div style={{ position: 'relative' }}>
              <RowSelect tone={roleTone(role)} label={(RL_ROLE_OPTS.find(o => o.id === role) || {}).label} open={ddRole} onToggle={() => setOpenDD(ddRole ? null : { scan: r.scan, field: 'role' })} />
              {ddRole ? <DDMenu options={RL_ROLE_OPTS.map(o => ({ id: o.id, label: o.label, tone: roleTone(o.id) }))} current={role} onPick={id => { onEdit?.(r.scan, { role: id }); setOpenDD(null); }} /> : null}
            </div>
            <div style={{ position: 'relative' }}>
              <RowSelect tone={runObj ? runObj.tone : null} label={runObj ? runObj.label : null} placeholder="— between runs —" open={ddRun} onToggle={() => setOpenDD(ddRun ? null : { scan: r.scan, field: 'run' })} />
              {ddRun ? <DDMenu options={RUN_OPTS} current={r.run || '__none'} onPick={id => { onEdit?.(r.scan, { run: id === '__none' ? null : id }); setOpenDD(null); }} /> : null}
            </div>
            <span className="mono" style={{ fontSize: 12, color: r.folio ? 'var(--ink-2)' : 'var(--ink-4)' }}>{r.folio || '—'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: tone, flex: '0 0 auto' }} />
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: heldBlank ? 'var(--ink-4)' : 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{heldBlank ? '[blank]' : r.computed}</span>
            </span>
            <PuStatus r={r} />
          </div>
        );
      })}
    </div>
  );
};

/* ====================================================================
   LEAF INSPECTOR — the page-level workbench (right rail)
==================================================================== */
const LeafInspector = ({ leaf, onClose, idx, total, onPrev, onNext, onPatch }) => {
  const role = leaf.role || 'text';
  const roleDef = PR_ROLES[role] || PR_ROLES.text;
  const runObj = PR_RUNS.find(x => x.id === leaf.run);
  const isText = role === 'text';
  const countedBlank = role === 'blank' && leaf.flag === 'countedBlank';
  const counts = isText || countedBlank;
  const side = role === 'blank' ? 'verso' : 'recto';
  const f = leaf.flag ? PU_FLAG[leaf.flag] : null;
  const fname = role === 'plate' ? '136p08' : role === 'blank' ? (countedBlank ? `0${leaf.scan}b${String(leaf.computed).padStart(3, '0')}` : '137p08v') : role === 'skip' ? '— dropped' : role === 'fold' ? '142d01a' : `0${leaf.scan}b${String(leaf.computed).padStart(3, '0')}`;
  const origName = leaf.orig || `IMG_${String(8800 + leaf.scan).padStart(4, '0')}.tif`;
  const facing = role === 'plate' ? 'p. 113 (recto)' : (role === 'blank' && !countedBlank) ? 'Plate VIII' : null;
  const history = [
    { tag: 'OCR', text: `read “${leaf.folio || '—'}”` },
    leaf.suggest ? { tag: 'auto', text: `normalised → ${leaf.suggest}` } : null,
    { tag: 'run', text: `${runObj ? runObj.label : 'between runs'} · ${roleDef.short || role}` },
  ].filter(Boolean);

  return (
    <div style={{ width: 320, flex: '0 0 auto', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* head */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--bg-raised)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Leaf inspector</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{idx + 1} / {total}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onPrev} title="Previous leaf" style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', cursor: 'pointer', color: 'var(--ink-2)' }}><Icon name="chevL" size={13} /></button>
          <button onClick={onNext} title="Next leaf" style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', cursor: 'pointer', color: 'var(--ink-2)' }}><Icon name="chevR" size={13} /></button>
          <button onClick={onClose} title="Close" style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', cursor: 'pointer', color: 'var(--ink-3)' }}><Icon name="x" size={13} /></button>
        </div>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', flex: 1, minHeight: 0 }}>
        {/* scan preview + identity */}
        <div style={{ display: 'flex', gap: 13 }}>
          <PrMini kind={role} w={66} h={86} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>scan #{leaf.scan}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <PrRoleChip role={role} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-2)' }}><span style={{ width: 7, height: 7, borderRadius: 2, background: runObj ? runObj.tone : 'var(--ink-4)' }} />{runObj ? runObj.label : 'between runs'}</span>
            </div>
            {f ? <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', height: 17, padding: '0 7px', borderRadius: 99, fontSize: 9.5, fontWeight: 600, background: `color-mix(in oklab, ${f.tone} 14%, var(--bg-surface))`, color: f.tone, border: `1px solid color-mix(in oklab, ${f.tone} 40%, transparent)` }}><span style={{ width: 4, height: 4, borderRadius: 99, background: f.tone }} />{f.label}</span> : null}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 7, background: 'color-mix(in oklab, var(--ink-3) 4%, transparent)', border: '1px solid var(--border-1)' }}>
          <Icon name="info" size={11} style={{ color: 'var(--ink-4)', flex: '0 0 auto' }} />
          <span style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>Role &amp; run are set from the row dropdowns. Detail below.</span>
        </div>

        {/* role-specific detail */}
        {isText ? (
          <RlField label="Page number" hint="OCR read this folio. Override only if it’s wrong — the label otherwise follows the run.">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <span className="label" style={{ color: 'var(--ink-4)' }}>OCR read</span>
                <span className="mono" style={{ fontSize: 13, color: 'var(--ink-3)', height: 32, display: 'inline-flex', alignItems: 'center', padding: '0 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 7 }}>{leaf.folio || '—'}</span>
              </div>
              <Icon name="arrowR" size={14} style={{ color: 'var(--ink-4)', marginBottom: 9 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <span className="label" style={{ color: 'var(--accent)' }}>label (override)</span>
                <RlInput value={String(leaf.computed)} onChange={v => onPatch?.(leaf.scan, { computed: v })} />
              </div>
            </div>
          </RlField>
        ) : role === 'plate' ? (
          <RlField label="Plate tag" hint="Free-text caption that travels with the image; not part of the page count.">
            <RlInput value={leaf.tag || 'Plate VIII'} onChange={v => onPatch?.(leaf.scan, { tag: v })} placeholder="e.g. Plate VIII" mono={false} />
          </RlField>
        ) : role === 'fold' ? (
          <RlField label="Fold-out" hint="Multi-segment scans get a/b/c suffixes; a tissue guard ties to this fold-out.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <RlSelectish>Segments: 3 (a · b · c)</RlSelectish>
              <RlToggle on label="Has tissue guard" onClick={() => {}} />
            </div>
          </RlField>
        ) : role === 'blank' ? (
          countedBlank ? (
            <RlField label="Page number" hint="This blank is part of the printed pagination — it consumes a page number even though nothing is printed.">
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ocr)', height: 32, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 11px', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 7 }}>p. {leaf.computed}<span style={{ fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-4)' }}>counted</span></span>
            </RlField>
          ) : (
            <RlField label="Blank anchor" hint="Held out of the count — borrows the neighbouring page’s number so the file sorts in place.">
              <RlSelectish>Verso of Plate VIII → p08v</RlSelectish>
            </RlField>
          )
        ) : (
          <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--border-2)', background: 'color-mix(in oklab, var(--ink-3) 4%, transparent)', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>Skipped — dropped from the output entirely (divider leaf, pastedown). No page number.</div>
        )}

        {/* mini facts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ padding: '8px 10px', borderRadius: 7, background: 'var(--bg-page)', border: '1px solid var(--border-1)' }}>
            <div className="label" style={{ color: 'var(--ink-4)' }}>Side</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', marginTop: 2 }}>{side}</div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 7, background: 'var(--bg-page)', border: '1px solid var(--border-1)' }}>
            <div className="label" style={{ color: 'var(--ink-4)' }}>Counts toward #</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: counts ? 'var(--exact)' : 'var(--ink-3)', marginTop: 2 }}>{counts ? 'Yes' : 'Held out'}</div>
          </div>
          {facing ? (
            <div style={{ gridColumn: '1 / -1', padding: '8px 10px', borderRadius: 7, background: 'var(--bg-page)', border: '1px solid var(--border-1)' }}>
              <div className="label" style={{ color: 'var(--ink-4)' }}>{role === 'plate' ? 'Faces' : 'Belongs to'}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', marginTop: 2 }}>{facing}</div>
            </div>
          ) : null}
        </div>

        {/* file names: original (preserved) → output */}
        <RlField label="File names" hint="The original capture name is preserved untouched in the export manifest — it’s never renamed or lost.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="label" style={{ width: 50, color: 'var(--ink-4)', flex: '0 0 auto' }}>original</span>
              <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '0 10px', background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{origName}</span>
                <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-4)', flex: '0 0 auto' }}>kept</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="label" style={{ width: 50, color: 'var(--accent)', flex: '0 0 auto' }}>output</span>
              <span className="mono" style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ink-1)', height: 30, display: 'inline-flex', alignItems: 'center', padding: '0 10px', background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 7 }}>{fname}{role !== 'skip' ? <span style={{ color: 'var(--ink-4)', fontWeight: 500 }}>.tif</span> : null}</span>
            </div>
          </div>
        </RlField>

        {/* read history */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span className="label" style={{ color: 'var(--ink-3)' }}>Read history</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 2 }}>
            {history.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-4)', width: 30, flex: '0 0 auto' }}>{h.tag}</span>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--border-3)', flex: '0 0 auto' }} />
                <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{h.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* footer actions */}
      <div style={{ padding: '11px 14px', borderTop: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-raised)' }}>
        <Button variant="ghost" size="sm" icon="eye" title="Open the full-resolution page scan to read the printed folio">Open scan</Button>
        <span style={{ flex: 1 }} />
        <Button variant="default" size="sm">Reset</Button>
        <Button variant="primary" size="sm" icon="check">Apply</Button>
      </div>
    </div>
  );
};

/* ====================================================================
   SPINE (reframed) — Numbering runs (editable) + Holds (not numbered)
==================================================================== */
const RUN_TEXT = PR_RUNS.filter(r => r.style !== 'none');
const RUN_HOLD = [
  { id: 'plates', label: 'Plates', tone: 'var(--fuzzy)', count: 12, sub: 'unnumbered illustrations' },
  { id: 'blanks', label: 'Blank pages', tone: 'var(--ink-3)', count: 19, sub: '[Blank Page] markers' },
  { id: 'skips', label: 'Skipped', tone: 'var(--gt)', count: 4, sub: 'covers · dividers · dropped' },
];

const SpineRunRow = ({ run, active, onClick }) => (
  <div onClick={onClick} style={{ padding: '10px 11px', borderRadius: 8, cursor: 'pointer', background: active ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)', border: `1px solid ${active ? 'color-mix(in oklab, var(--accent) 45%, var(--border-1))' : 'var(--border-1)'}`, display: 'flex', alignItems: 'center', gap: 9 }}>
    <Icon name="grip" size={14} style={{ color: 'var(--ink-4)', flex: '0 0 auto', cursor: 'grab' }} />
    <span style={{ width: 9, height: 9, borderRadius: 2, background: run.tone, flex: '0 0 auto' }} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{run.label}</div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{run.computed}</div>
    </div>
    <Icon name="chevR" size={13} style={{ color: active ? 'var(--accent)' : 'var(--ink-4)', flex: '0 0 auto' }} />
  </div>
);

const SpineHoldRow = ({ hold }) => (
  <div style={{ padding: '8px 11px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 9 }}>
    <span style={{ width: 9, height: 9, borderRadius: 2, background: hold.tone, flex: '0 0 auto', border: hold.id === 'blanks' ? '1px solid var(--border-3)' : 'none' }} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-1)' }}>{hold.label}</div>
      <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>{hold.sub}</div>
    </div>
    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>{hold.count}</span>
    <Icon name="chevR" size={13} style={{ color: 'var(--ink-4)', flex: '0 0 auto' }} />
  </div>
);

const RunSpine = ({ editRun, onEditRun, adding, onAdd }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, overflow: 'auto' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="label" style={{ color: 'var(--ink-3)' }}>Numbering runs · {RUN_TEXT.length}</span>
        <Button variant={adding ? 'primary' : 'ghost'} size="sm" icon="plus" onClick={onAdd}>Add run</Button>
      </div>
      {adding ? <RunAddForm onCancel={onAdd} /> : null}
      {RUN_TEXT.map(r => (
        editRun === r.id
          ? <RunEditCard key={r.id} run={r} onClose={() => onEditRun(null)} />
          : <SpineRunRow key={r.id} run={r} active={false} onClick={() => onEditRun(r.id)} />
      ))}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="label" style={{ color: 'var(--ink-3)' }}>Holds · not numbered</span>
      {RUN_HOLD.map(h => <SpineHoldRow key={h.id} hold={h} />)}
      <div style={{ padding: '9px 11px', borderRadius: 8, border: '1px dashed var(--border-2)', background: 'color-mix(in oklab, var(--fuzzy) 4%, transparent)', display: 'flex', gap: 8 }}>
        <Icon name="info" size={12} style={{ color: 'var(--ink-4)', flex: '0 0 auto', marginTop: 1 }} />
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>Plates &amp; blanks aren’t runs — they’re per-leaf roles that pause the count. Retag one from its row dropdown.</span>
      </div>
    </div>
  </div>
);

/* ====================================================================
   ADD RUN
==================================================================== */
const RunAddForm = ({ onCancel }) => (
  <div style={{ background: 'var(--bg-surface)', border: '1px solid color-mix(in oklab, var(--accent) 45%, var(--border-1))', borderRadius: 9, padding: 13, display: 'flex', flexDirection: 'column', gap: 13, boxShadow: '0 8px 24px rgba(15,23,42,.10)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <Icon name="plus" size={13} style={{ color: 'var(--accent)' }} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>New numbering run</span>
    </div>
    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>Splits the book at a chosen leaf and starts a fresh count — for a new section, an appendix, or back matter that renumbers.</div>
    <RlField label="Name"><RlInput value="Appendix" mono={false} /></RlField>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <RlField label="Starts at scan"><RlInput value="327" /></RlField>
      <RlField label="Numbering"><RlSelectish>Arabic · 1,2,3</RlSelectish></RlField>
    </div>
    <RlField label="Start value" hint="Set an explicit value, or continue the previous numbered run.">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <RlSeg options={[{ id: 'set', label: 'Set' }, { id: 'cont', label: 'Continue' }]} value="cont" sm />
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', height: 30, padding: '0 9px', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bg-page)', border: '1px solid color-mix(in oklab, var(--accent) 40%, var(--border-2))', borderRadius: 7 }}><Icon name="arrowR" size={10} />311</span>
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>from Body</span>
      </div>
    </RlField>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border-1)', paddingTop: 11 }}>
      <Button variant="default" size="sm" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" size="sm" icon="check">Add run</Button>
    </div>
  </div>
);

/* ====================================================================
   EDIT / REMOVE RUN
==================================================================== */
const RunEditCard = ({ run, onClose }) => (
  <div style={{ background: 'var(--bg-surface)', border: `1px solid color-mix(in oklab, ${run.tone} 50%, var(--border-1))`, borderRadius: 9, padding: 13, display: 'flex', flexDirection: 'column', gap: 13, boxShadow: '0 8px 24px rgba(15,23,42,.10)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: run.tone }} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)', flex: 1 }}>Edit run</span>
      <button onClick={onClose} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid var(--border-2)', background: 'var(--bg-surface)', cursor: 'pointer', color: 'var(--ink-3)' }}><Icon name="chevD" size={13} /></button>
    </div>
    <RlField label="Name"><RlInput value={run.label} mono={false} /></RlField>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <RlField label="Numbering"><RlSelectish tone={run.tone}>{(PR_STYLES[run.style] || {}).label || 'Arabic'}</RlSelectish></RlField>
      <RlField label="Step"><RlInput value="1" /></RlField>
    </div>
    <RlField label="Span" hint="The contiguous scans this run numbers.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <RlInput value={String(run.span ? run.span[0] : 17)} w={72} />
        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>through</span>
        <RlInput value={String(run.span ? run.span[1] : 326)} w={72} />
      </div>
    </RlField>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border-1)', paddingTop: 11 }}>
      <Button variant="danger" size="sm" icon="trash">Remove</Button>
      <span style={{ fontSize: 10, color: 'var(--ink-4)', flex: 1, lineHeight: 1.4 }}>Removing merges its leaves into the run above; they re-inherit that count.</span>
      <Button variant="primary" size="sm" icon="check">Save</Button>
    </div>
  </div>
);

/* ====================================================================
   ASSEMBLED VIEWS (artboards)
==================================================================== */

// 1 — workbench with leaf inspector + inline role/run dropdowns
const PoWorkbenchInspect = ({ sel0 = 134, dd0 = null, edit0 = null, adding0 = false, selScans0 = [] }) => {
  const { leaves, patch, move } = usePageEdits();
  const [sel, setSel] = useRL(sel0);
  const [openDD, setOpenDD] = useRL(dd0);
  const [editRun, setEditRun] = useRL(edit0);
  const [adding, setAdding] = useRL(adding0);
  const [selSet, setSelSet] = useRL(() => new Set(selScans0));
  const toggleSel = scan => setSelSet(s => { const n = new Set(s); n.has(scan) ? n.delete(scan) : n.add(scan); return n; });
  const idx = Math.max(0, leaves.findIndex(l => l.scan === sel));
  const leaf = leaves[idx];
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }} onClick={() => openDD && setOpenDD(null)}>
      <PuHeader />
      <PuRibbon />
      <div style={{ display: 'grid', gridTemplateColumns: '288px 1fr 320px', gap: 14, flex: 1, minHeight: 0 }}>
        <RunSpine editRun={editRun} onEditRun={id => { setEditRun(id); setAdding(false); }} adding={adding} onAdd={() => { setAdding(a => !a); setEditRun(null); }} />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {selSet.size > 0 ? <RlBulkBar count={selSet.size} onBefore={n => move([...selSet], n, false)} onAfter={n => move([...selSet], n, true)} onClear={() => setSelSet(new Set())} /> : null}
          <ProLedger leaves={leaves} selected={sel} onSelect={setSel} onEdit={patch} openDD={openDD} setOpenDD={setOpenDD} reorderable selSet={selSet} onToggleSel={toggleSel} onMove={move} />
        </div>
        <LeafInspector leaf={leaf} idx={idx} total={leaves.length} onPatch={patch} onClose={() => {}} onPrev={() => setSel(leaves[(idx - 1 + leaves.length) % leaves.length].scan)} onNext={() => setSel(leaves[(idx + 1) % leaves.length].scan)} />
      </div>
    </div>
  );
};

// 2 — run management: spine with an edit card + add form open
const RunManageView = () => {
  const { leaves, patch } = usePageEdits();
  const [edit, setEdit] = useRL('body');
  const [adding, setAdding] = useRL(true);
  const [openDD, setOpenDD] = useRL(null);
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }} onClick={() => openDD && setOpenDD(null)}>
      <PuHeader />
      <PuRibbon />
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        <RunSpine editRun={edit} onEditRun={setEdit} adding={adding} onAdd={() => setAdding(a => !a)} />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label" style={{ color: 'var(--ink-3)' }}>Preview · how the spine maps onto the book</span>
          </div>
          <ProLedger leaves={leaves} selected={363} onSelect={() => {}} onEdit={patch} openDD={openDD} setOpenDD={setOpenDD} />
        </div>
      </div>
    </div>
  );
};

// 3 — inline dropdown detail (a row's role dropdown open)
const QuickEditView = () => {
  const { leaves, patch } = usePageEdits();
  const [openDD, setOpenDD] = useRL({ scan: 136, field: 'role' });
  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <PuHeader />
      <div style={{ display: 'grid', gridTemplateColumns: '288px 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        <RunSpine editRun={null} onEditRun={() => {}} adding={false} onAdd={() => {}} />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'visible', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ProLedger leaves={leaves} selected={136} onSelect={() => {}} onEdit={patch} openDD={openDD} setOpenDD={setOpenDD} />
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PoWorkbenchInspect, RunManageView, QuickEditView, LeafInspector, RunAddForm, RunEditCard });
