// naming.jsx — "Output file naming" setup for the Page order stage.
// Interactive: filename = ‹seq›‹type›‹folio›, each part optional per scheme.
//
// Leaves that have no number of their own BORROW an anchor from context:
//   • blank beside a plate  → plate-tied   (p08v = verso of plate 08)
//   • blank inside any run   → page-tied    (x156 = blank after p.156) — covers
//                               front matter, back matter, Book dividers.
//   • fold-out / oversize    → own code + part suffix; multi-segment scans and
//                               tissue guards cluster on the fold-out's id
//                               (142d01a/b/c, 141d01t).
//
// Scan-index padding defaults to the digit-width of the book's page count.

const { useState: useNm } = React;

const pad = (n, w) => String(n).padStart(w, '0');
// original capture filename — preserved verbatim, never renamed (matches the
// leaf inspector's provenance).
const origNm = scan => `IMG_${pad(8800 + scan, 4)}.tif`;

// book size → drives the default scan-index padding (387 scans → 3 digits).
const NM_TOTAL = 387;
const NM_DEF_DIGITS = String(NM_TOTAL).length;

// representative numbered leaves — one per run, plus a plate.
const NM_LEAVES = [
  { run: 'front',    label: 'Front matter', tone: 'var(--ocr)',   scan: 5,   folioPos: 1,   folioLabel: 'p. i',       role: 'text'  },
  { run: 'body',     label: 'Body',         tone: 'var(--exact)', scan: 25,  folioPos: 23,  folioLabel: 'p. 23',      role: 'text'  },
  { run: 'plates',   label: 'Plate',        tone: 'var(--fuzzy)', scan: 136, plateIdx: 8,   folioLabel: 'Plate VIII', role: 'plate' },
  { run: 'plates',   label: 'Plate',        tone: 'var(--fuzzy)', scan: 139, plateIdx: 9,   folioLabel: 'Plate IX',   role: 'plate' },
  { run: 'appendix', label: 'Appendix',     tone: 'color-mix(in oklab, var(--exact) 55%, var(--accent))', scan: 327, folioPos: 311, folioLabel: 'p. 311', role: 'text' },
  { run: 'cat',      label: 'Catalogue',    tone: 'var(--accent)', scan: 363, folioPos: 1,  folioLabel: 'p. 1',       role: 'text'  },
  { run: 'index',    label: 'Index',        tone: 'color-mix(in oklab, var(--accent) 55%, var(--ink-3))', scan: 381, folioPos: 1, folioLabel: 'p. 1', role: 'text' },
];

// blanks across every context they actually occur in.
const NM_BLANKS = [
  { id: 'fm', ctx: 'Front matter',      detail: 'verso of half-title',  scan: 4,   anchor: { kind: 'page',  run: 'front',    pos: 2,   label: 'after p. ii' } },
  { id: 'pl', ctx: 'Facing a plate',    detail: 'blank verso · image on recto', scan: 137, requiresPlate: true, anchor: { kind: 'plate', plateIdx: 8, side: 'v', label: 'verso of Plate VIII' } },
  { id: 'pr', ctx: 'Facing a plate',    detail: 'blank recto · precedes image on verso', scan: 138, requiresPlate: true, anchor: { kind: 'plate', plateIdx: 9, side: 'r', label: 'recto of Plate IX' } },
  { id: 'bk', ctx: 'Between Book I & II', detail: 'section divider verso', scan: 201, anchor: { kind: 'page',  run: 'body',     pos: 156, label: 'after p. 156 · end Bk I' } },
  { id: 'ba', ctx: 'Back matter',       detail: 'after the appendix',   scan: 361, anchor: { kind: 'page',  run: 'appendix', pos: 340, label: 'after p. 340' } },
];

// fold-outs / oversize leaves — unnumbered, own counter, may be multi-segment.
const NM_FOLDS = [
  { id: 'fg', kind: 'guard',   title: 'Tissue guard', sub: 'protects the fold-out', scan: 141, foldIdx: 1, page: 'guards fold-out 01' },
  { id: 'fo', kind: 'foldout', title: 'Fold-out map', sub: '3 stitched segments',   scan: 142, foldIdx: 1, segments: 3, page: 'fold-out 01 · a–c' },
];
const NM_FOLD_TONE = 'color-mix(in oklab, var(--fuzzy) 50%, var(--mismatch))';

// per-run folio / index width
const NM_WIDTH = { front: 2, body: 3, plates: 2, appendix: 3, cat: 2, fold: 2, index: 2 };

const NM_SCHEMES = [
  { id: 'full',      label: 'Scan · Type · Folio', hint: 'Every part. Unambiguous even with plates, blanks, fold-outs and reused folios.', parts: ['seq', 'type', 'folio'] },
  { id: 'typeFolio', label: 'Type · Folio',         hint: 'Drops the scan index — sorts by section then printed page. Relies on anchored blanks & fold-out suffixes to stay unique.', parts: ['type', 'folio'] },
  { id: 'seqOnly',   label: 'Scan only',            hint: 'Just the running scan number (plus a letter for fold-out segments). Simplest — fine when the book is one clean sequence.', parts: ['seq'] },
];

const NM_BLANK_MODES = [
  { id: 'contextual', label: 'Contextual anchor', hint: 'Plate-tied beside a plate (p08v), else tied to the preceding page (x156). Unique in every scheme — handles front, back & Book dividers.' },
  { id: 'counter',    label: 'Running counter',    hint: 'A flat blank sequence: x001, x002… Unique, but the name says nothing about where the blank sits.' },
  { id: 'marker',     label: 'Marker only (x)',    hint: 'Just x, no number. Only safe when the scan index is in the name — collides under Type · Folio.' },
];

const NM_DEFAULT_CODES = { front: 'f', body: 'b', plates: 'p', blank: 'x', appendix: 'a', cat: 'c', fold: 'd', index: 'i' };

const NM_SEG_COLOR = { seq: 'var(--ink-1)', ins: 'var(--mismatch)', type: 'var(--accent)', folio: 'var(--exact)', side: 'var(--ink-3)' };

// numbered leaf → segments
function nmParts({ leaf, scheme, seqDigits, codes, widths, insertSuffix }) {
  const parts = NM_SCHEMES.find(s => s.id === scheme).parts;
  const out = [];
  if (parts.includes('seq')) {
    out.push({ k: 'seq', v: pad(leaf.scan, seqDigits) });
    if (insertSuffix) out.push({ k: 'ins', v: insertSuffix });
  }
  if (parts.includes('type')) {
    const t = codes[leaf.run];
    if (t) out.push({ k: 'type', v: t });
  }
  if (parts.includes('folio')) {
    if (leaf.role === 'plate') out.push({ k: 'folio', v: pad(leaf.plateIdx, widths.plates) });
    else out.push({ k: 'folio', v: pad(leaf.folioPos, widths[leaf.run]) });
  }
  return out;
}

// blank leaf → segments (anchored)
function nmBlankParts({ blank, mode, scheme, seqDigits, codes, widths, counter }) {
  const parts = NM_SCHEMES.find(s => s.id === scheme).parts;
  const wantSeq = parts.includes('seq'), wantType = parts.includes('type'), wantFolio = parts.includes('folio');
  const out = [];
  if (wantSeq) out.push({ k: 'seq', v: pad(blank.scan, seqDigits) });
  if (mode === 'marker') {
    if (wantType) out.push({ k: 'type', v: codes.blank });
  } else if (mode === 'counter') {
    if (wantType) out.push({ k: 'type', v: codes.blank });
    if (wantFolio) out.push({ k: 'folio', v: pad(counter, 3) });
  } else { // contextual
    const a = blank.anchor;
    if (a.kind === 'plate') {
      if (wantType) out.push({ k: 'type', v: codes.plates });
      if (wantFolio) { out.push({ k: 'folio', v: pad(a.plateIdx, widths.plates) }); out.push({ k: 'side', v: a.side }); }
    } else {
      if (wantType) out.push({ k: 'type', v: codes.blank });
      if (wantFolio) out.push({ k: 'folio', v: pad(a.pos, widths[a.run]) });
    }
  }
  return out;
}

// fold-out leaf / segment / guard → segments. `part` is the trailing letter
// (a/b/c for a stitched segment, t for a tissue guard). It rides along in
// EVERY scheme so segments never collide — even under Scan only.
function nmFoldParts({ leaf, part, scheme, seqDigits, codes, widths }) {
  const parts = NM_SCHEMES.find(s => s.id === scheme).parts;
  const out = [];
  if (parts.includes('seq')) out.push({ k: 'seq', v: pad(leaf.scan, seqDigits) });
  if (parts.includes('type')) out.push({ k: 'type', v: codes.fold });
  if (parts.includes('folio')) out.push({ k: 'folio', v: pad(leaf.foldIdx, widths.fold) });
  if (part) out.push({ k: 'side', v: part });
  return out;
}

const NameChip = ({ parts, big, collide }) => (
  <span className="mono" style={{ display: 'inline-flex', alignItems: 'baseline', fontSize: big ? 18 : 13, fontWeight: 700, letterSpacing: '0.01em', padding: big ? '7px 12px' : '3px 9px', background: collide ? 'color-mix(in oklab, var(--mismatch) 10%, var(--bg-page))' : 'var(--bg-page)', border: `1px solid ${collide ? 'color-mix(in oklab, var(--mismatch) 45%, var(--border-2))' : 'var(--border-2)'}`, borderRadius: 7 }}>
    {parts.map((p, i) => <span key={i} style={{ color: NM_SEG_COLOR[p.k] }}>{p.v}</span>)}
    <span style={{ color: 'var(--ink-4)', fontWeight: 500 }}>.tif</span>
  </span>
);

/* ---- small controls ---- */
const NmSeg = ({ options, value, onChange }) => (
  <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 7 }}>
    {options.map(o => {
      const a = o.id === value;
      return <span key={o.id} onClick={() => onChange(o.id)} style={{ position: 'relative', fontSize: 12, fontWeight: a ? 600 : 500, padding: '5px 12px', borderRadius: 5, cursor: 'pointer', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ink-1)' : 'var(--ink-3)' }}>{o.label}{o.rec ? <span style={{ position: 'absolute', top: 3, right: 3, width: 4, height: 4, borderRadius: 99, background: 'var(--accent)' }} /> : null}</span>;
    })}
  </div>
);

const NmRadioList = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {options.map(o => {
      const a = o.id === value;
      return (
        <div key={o.id} onClick={() => onChange(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 7, cursor: 'pointer', background: a ? 'color-mix(in oklab, var(--accent) 7%, var(--bg-surface))' : 'var(--bg-surface)', border: `1px solid ${a ? 'color-mix(in oklab, var(--accent) 45%, var(--border-1))' : 'var(--border-1)'}` }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, border: `1.5px solid ${a ? 'var(--accent)' : 'var(--border-3)'}`, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>{a ? <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--accent)' }} /> : null}</span>
          <span style={{ fontSize: 12.5, fontWeight: a ? 600 : 500, color: 'var(--ink-1)' }}>{o.label}</span>
        </div>
      );
    })}
  </div>
);

const NmToggle = ({ on, set, onLabel, offLabel }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <div onClick={() => set(v => !v)} style={{ width: 40, height: 23, borderRadius: 99, padding: 2, background: on ? 'var(--accent)' : 'var(--border-3)', cursor: 'pointer', transition: 'background .15s', flex: '0 0 auto' }}>
      <div style={{ width: 19, height: 19, borderRadius: 99, background: '#fff', transform: on ? 'translateX(17px)' : 'none', transition: 'transform .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </div>
    <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{on ? onLabel : offLabel}</span>
  </div>
);

const NmField = ({ label, children, hint }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
    <span className="label" style={{ color: 'var(--ink-3)' }}>{label}</span>
    {children}
    {hint ? <span style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45, maxWidth: 360 }}>{hint}</span> : null}
  </div>
);

/* ====================================================================
   The naming workspace
==================================================================== */
const PoNaming = () => {
  const [scheme, setScheme] = useNm('full');
  const [seqDigits, setSeqDigits] = useNm(NM_DEF_DIGITS);
  const [hasPlates, setHasPlates] = useNm(true);
  const [hasFolds, setHasFolds] = useNm(true);
  const [blankMode, setBlankMode] = useNm('contextual');
  const [codes, setCodes] = useNm(NM_DEFAULT_CODES);

  const widths = NM_WIDTH;
  const schemeObj = NM_SCHEMES.find(s => s.id === scheme);
  const showsType = schemeObj.parts.includes('type');
  const setCode = (k, v) => setCodes(c => ({ ...c, [k]: v.replace(/[^a-z0-9]/gi, '').slice(0, 2).toLowerCase() }));

  // build the example rows: numbered leaves + blanks + fold-outs, in scan order.
  const textRows = (hasPlates ? NM_LEAVES : NM_LEAVES.filter(l => l.role !== 'plate')).map(l => ({
    key: l.run + '-' + l.scan, tone: l.tone, title: l.label, scan: l.scan, page: l.folioLabel,
    chips: [nmParts({ leaf: l, scheme, seqDigits, codes, widths })],
  }));
  const blankRows = NM_BLANKS.filter(b => hasPlates || !b.requiresPlate).map((b, i) => ({
    key: b.id, tone: 'var(--ink-3)', title: 'Blank', sub: b.ctx, scan: b.scan, page: b.anchor.label, ring: true,
    chips: [nmBlankParts({ blank: b, mode: blankMode, scheme, seqDigits, codes, widths, counter: i + 1 })],
    collide: blankMode === 'marker' && scheme === 'typeFolio',
  }));
  const foldRows = (hasFolds ? NM_FOLDS : []).map(f => {
    let chips;
    if (f.kind === 'guard') chips = [nmFoldParts({ leaf: f, part: 't', scheme, seqDigits, codes, widths })];
    else if (f.segments > 1) chips = Array.from({ length: f.segments }, (_, j) => nmFoldParts({ leaf: f, part: String.fromCharCode(97 + j), scheme, seqDigits, codes, widths }));
    else chips = [nmFoldParts({ leaf: f, part: null, scheme, seqDigits, codes, widths })];
    return { key: f.id, tone: NM_FOLD_TONE, title: f.title, sub: f.sub, scan: f.scan, page: f.page, chips };
  });
  const rows = [...textRows, ...blankRows, ...foldRows].sort((a, b) => a.scan - b.scan);

  // inserted found page: body folio 24, slotted after #025
  const insertParts = nmParts({ leaf: { run: 'body', role: 'text', scan: 25, folioPos: 24 }, scheme, seqDigits, codes, widths, insertSuffix: 'A' });
  const blanksCollide = blankMode === 'marker' && scheme === 'typeFolio';

  return (
    <div style={{ padding: '18px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Output file naming</h2>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', maxWidth: 740, lineHeight: 1.5 }}>
            How each page image is named on export. A name is up to three parts — <span style={{ color: NM_SEG_COLOR.seq }}>scan&nbsp;index</span>, a <span style={{ color: NM_SEG_COLOR.type, fontWeight: 600 }}>type code</span>, and the <span style={{ color: NM_SEG_COLOR.folio, fontWeight: 600 }}>printed page</span>. Unnumbered leaves — blanks, plates, fold-outs — <em>borrow an anchor</em> from context.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
          <Button variant="default" size="sm" icon="copy">Copy manifest</Button>
          <Button variant="primary" size="sm" icon="check">Apply scheme</Button>
        </div>
      </div>

      {/* big live pattern */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 10, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <span className="label" style={{ color: 'var(--ink-3)' }}>Pattern</span>
        <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {schemeObj.parts.map((p, i) => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i ? <span style={{ color: 'var(--border-3)' }}>+</span> : null}
              <span style={{ color: NM_SEG_COLOR[p], background: `color-mix(in oklab, ${NM_SEG_COLOR[p]} 12%, var(--bg-page))`, padding: '2px 8px', borderRadius: 5, fontWeight: 600 }}>
                {p === 'seq' ? `scan·${seqDigits}` : p === 'type' ? 'type' : 'folio'}
              </span>
            </span>
          ))}
        </span>
        <span style={{ color: 'var(--border-3)' }}>→</span>
        <NameChip big parts={nmParts({ leaf: NM_LEAVES[1], scheme, seqDigits, codes, widths })} />
        <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>e.g. body, scan&nbsp;25, p.&nbsp;23</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '330px 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        {/* left — controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', paddingRight: 2 }}>
          <NmField label="Scheme" hint={schemeObj.hint}>
            <NmRadioList options={NM_SCHEMES} value={scheme} onChange={setScheme} />
          </NmField>

          <NmField label="Scan index padding" hint={`Defaulted to ${NM_DEF_DIGITS} digits — fits this book's ${NM_TOTAL} scans (001–${NM_TOTAL}). Bump up for headroom if more scans may be added.`}>
            <NmSeg value={seqDigits} onChange={setSeqDigits} options={[2, 3, 4, 5].map(n => ({ id: n, label: `${n}`, rec: n === NM_DEF_DIGITS }))} />
          </NmField>

          <NmField label="Blank pages" hint={NM_BLANK_MODES.find(m => m.id === blankMode).hint}>
            <NmRadioList options={NM_BLANK_MODES} value={blankMode} onChange={setBlankMode} />
          </NmField>

          <NmField label="Special leaves">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <NmToggle on={hasPlates} set={setHasPlates} onLabel="Has plates — code + plate-tied blanks" offLabel="No plates" />
              <NmToggle on={hasFolds} set={setHasFolds} onLabel="Has fold-outs / oversize — segments + guards" offLabel="No fold-outs" />
            </div>
          </NmField>

          {showsType ? (
            <NmField label="Type codes" hint="One short code per run. These print in the “type” slot.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[['front', 'Front matter'], ['body', 'Body'], hasPlates && ['plates', 'Plate'], hasFolds && ['fold', 'Fold-out'], ['blank', 'Blank'], ['appendix', 'Appendix'], ['cat', 'Catalogue'], ['index', 'Index']].filter(Boolean).map(([k, lbl]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px 6px 10px', borderRadius: 6, background: 'var(--bg-surface)', border: '1px solid var(--border-1)' }}>
                    <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{lbl}</span>
                    <input value={codes[k]} onChange={e => setCode(k, e.target.value)} className="mono" style={{ width: 46, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--accent)', height: 26, background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 5, outline: 'none' }} />
                  </div>
                ))}
              </div>
            </NmField>
          ) : (
            <div style={{ padding: '11px 12px', borderRadius: 8, border: '1px dashed var(--border-2)', background: 'color-mix(in oklab, var(--ink-3) 4%, transparent)', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              This scheme prints no type code, so there's nothing to edit here. Switch to <strong>Scan · Type · Folio</strong> to label sections.
            </div>
          )}
        </div>

        {/* right — live examples + insert */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 116px 140px 1fr', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--border-1)', background: 'var(--bg-raised)' }}>
              {['leaf', 'page / anchor', 'original file', 'output filename'].map(h => <span key={h} className="label" style={{ color: 'var(--ink-4)' }}>{h}</span>)}
            </div>
            <div style={{ overflow: 'auto' }}>
              {rows.map((r, i) => (
                <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '1.1fr 116px 140px 1fr', gap: 12, padding: '10px 16px', alignItems: 'center', borderTop: i ? '1px solid var(--border-1)' : 'none', background: r.ring ? 'color-mix(in oklab, var(--ink-3) 3%, transparent)' : 'transparent' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: r.tone, flex: '0 0 auto', border: r.ring ? '1px solid var(--border-3)' : 'none' }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-1)', fontWeight: 500 }}>{r.title}</span>
                      {r.sub ? <span style={{ fontSize: 10.5, color: 'var(--ink-4)', marginLeft: 7 }}>{r.sub}</span> : null}
                    </span>
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>#{r.scan}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: r.ring ? 'var(--ink-4)' : 'var(--ink-3)' }}>{r.page}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }} title="Original capture name — preserved in the manifest">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{origNm(r.scan)}</span>
                    <Icon name="arrowR" size={10} style={{ color: 'var(--border-3)', flex: '0 0 auto' }} />
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {r.chips.map((c, j) => <NameChip key={j} parts={c} collide={r.collide} />)}
                    {r.collide ? <span style={{ fontSize: 10, color: 'var(--mismatch)', fontWeight: 600 }}>collides</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {blanksCollide ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', borderRadius: 8, background: 'color-mix(in oklab, var(--mismatch) 7%, var(--bg-surface))', border: '1px solid color-mix(in oklab, var(--mismatch) 35%, var(--border-1))' }}>
              <Icon name="alert" size={13} style={{ color: 'var(--mismatch)', flex: '0 0 auto' }} />
              <span style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>Every blank becomes just <span className="mono" style={{ fontWeight: 700, color: 'var(--mismatch)' }}>x</span> — they collide. Switch blanks to <strong>Contextual anchor</strong>, or add the scan index back.</span>
            </div>
          ) : null}

          {/* insert-a-found-page — two states, gated on whether proofreading has begun */}
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="plus" size={13} style={{ color: 'var(--ink-2)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Insert a found page</span>
              </span>
              <Button variant="default" size="sm" icon="plus">Insert page…</Button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              What happens to the names depends on whether proofreading has started.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* before build → renumber */}
              <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, var(--exact) 32%, var(--border-1))', background: 'color-mix(in oklab, var(--exact) 5%, var(--bg-surface))', padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--exact)' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>Before build · renumber</span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>Nothing references the names yet — the found page slots in and everything after it shifts up. Clean sequence, no suffix.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 'auto' }}>
                  <NameChip parts={nmParts({ leaf: { run: 'body', role: 'text', scan: 26, folioPos: 24 }, scheme, seqDigits, codes, widths })} />
                  <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>then #026→#027…</span>
                </div>
                <span style={{ fontSize: 10, color: 'var(--exact)', fontWeight: 600 }}>found p.&nbsp;24 → its own #026, all shift</span>
              </div>
              {/* after proofreading → suffix */}
              <div style={{ borderRadius: 8, border: '1px solid color-mix(in oklab, var(--mismatch) 32%, var(--border-1))', background: 'color-mix(in oklab, var(--mismatch) 5%, var(--bg-surface))', padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--mismatch)' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>Proofreading started · suffix</span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>Proofreaders already cite the names — renumbering would break their references. The page wedges in on a letter suffix instead; nothing else moves.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 'auto' }}>
                  <NameChip parts={nmParts({ leaf: NM_LEAVES[1], scheme, seqDigits, codes, widths })} />
                  <Icon name="arrowR" size={12} style={{ color: 'var(--mismatch)' }} />
                  <NameChip parts={insertParts} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--mismatch)', fontWeight: 600 }}>found p.&nbsp;24 → wedged after #025 as <span className="mono">A</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PoNaming });
