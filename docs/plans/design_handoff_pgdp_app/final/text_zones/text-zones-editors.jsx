// text-zones-editors.jsx — inline editors for the Page-layout stage.
// SplitEditor   — resolve a layout-driven column / row page split.
// ZoneEditor    — manual layout annotator: draw a box or lasso a region the
//                 detector missed (illustrations especially), assign a type,
//                 fix mis-typed zones, re-order reading. Loaded AFTER
//                 text-zones.jsx (uses ZonePageRender / ZONE_TYPES globals).

const { useState: useSTE } = React;

/* ---------- small tool icons (simple shapes — select / box / lasso) ---------- */
const ToolIcon = ({ kind, size = 13 }) => {
  const c = { width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'select') return <svg viewBox="0 0 24 24" {...c}><path d="M5 3l6 14 2.2-5.2L18 9.6 5 3z" /></svg>;
  if (kind === 'box') return <svg viewBox="0 0 24 24" {...c}><rect x="4" y="5" width="16" height="14" rx="1" strokeDasharray="3 2.5" /></svg>;
  return <svg viewBox="0 0 24 24" {...c}><path d="M4 9c0-3 4-5 8-5s8 2 8 5-3 6-7 6c-2 0-2 2 0 3 1.5.8 0 2-2 1.5" strokeDasharray="3 2.5" /></svg>;
};

/* ====================================================================
   SplitEditor — confirm / tune a column or row page split.
==================================================================== */
const SplitEditor = ({ row }) => {
  const split = row.split || { axis: 'col', conf: 0.8, into: 2, gutter: 0.5 };
  const tone = split.conf < 0.7 ? 'var(--fuzzy)' : 'var(--ocr)';
  const childA = `${row.prefix}a`, childB = `${row.prefix}b`;
  const isCol = split.axis === 'col';

  // child preview: render half the source page by clipping the parent.
  const ChildPreview = ({ half, w, h, label }) => (
    <div style={{ width: w, height: h, position: 'relative', borderRadius: 3, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.25)', background: '#fff' }}>
      <div style={{ position: 'absolute', inset: 0,
        clipPath: isCol
          ? (half === 0 ? `inset(0 50% 0 0)` : `inset(0 0 0 50%)`)
          : (half === 0 ? `inset(0 0 50% 0)` : `inset(50% 0 0 0)`),
      }}>
        <div style={{ position: 'absolute', inset: 0, transform: isCol ? (half === 1 ? 'translateX(-0%)' : 'none') : 'none' }}>
          <ZonePageRender row={{ ...row, split: null }} w={w} h={h} lod="s" showSplit={false} />
        </div>
      </div>
      <span style={{ position: 'absolute', bottom: 4, left: 4, padding: '1px 6px', borderRadius: 3, background: 'rgba(12,12,16,0.8)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 9, fontWeight: 600 }}>{label}</span>
    </div>
  );

  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)', background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden', animation: 'pgd-slide-up .18s ease-out' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))' }}>
        <Icon name="scissors" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Split page · {row.prefix}.tif</span>
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 18, padding: '0 7px', borderRadius: 99, background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: tone, border: `1px solid color-mix(in oklab, ${tone} 45%, transparent)`, fontSize: 10, fontWeight: 600 }}>
          {isCol ? 'column' : 'row'} split · {Math.round(split.conf * 100)}%
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>layout detection · {row.zones} zones · {row.words} words</span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={13} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* source + result */}
        <div style={{ padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)', minHeight: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          {/* source page with the split line */}
          <div style={{ textAlign: 'center' }}>
            <ZonePageRender row={row} w={236} h={334} lod="m" />
            <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-3)' }}>source · {row.prefix}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'var(--ink-4)' }}>
            <Icon name="arrowR" size={18} />
            <span className="mono" style={{ fontSize: 9.5 }}>split</span>
          </div>
          {/* result: two child pages */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', flexDirection: isCol ? 'row' : 'column', gap: 8, justifyContent: 'center' }}>
              {isCol ? (
                <>
                  <ChildPreview half={0} w={114} h={334} label={childA} />
                  <ChildPreview half={1} w={114} h={334} label={childB} />
                </>
              ) : (
                <>
                  <ChildPreview half={0} w={236} h={162} label={childA} />
                  <ChildPreview half={1} w={236} h={162} label={childB} />
                </>
              )}
            </div>
            <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ocr)', fontWeight: 600 }}>2 pages · {childA} · {childB}</div>
          </div>
        </div>

        {/* controls */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 7 }}>Split axis</div>
            <ZnSegmented options={['Column', 'Row']} activeIdx={isCol ? 0 : 1} />
          </div>
          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>{isCol ? 'Gutter X' : 'Divider Y'}</div>
            <ZnSettingSlider value={Math.round(split.gutter * 100)} min={20} max={80} unit="%" />
          </div>

          <div style={{ padding: '10px 12px', borderRadius: 7, background: `color-mix(in oklab, ${tone} 6%, var(--bg-surface))`, border: `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`, fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Detected {isCol ? 'two text columns with a clear gutter' : 'two stacked blocks with a horizontal break'} ·
            <span style={{ color: tone, fontWeight: 600 }}> {Math.round(split.conf * 100)}% score</span>.
            Children inherit this page's stage history and re-flow through OCR independently.
          </div>

          <ZnSettingRow title="" sub="" />
          <div style={{ marginTop: -14 }}>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Apply to</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'this', name: 'This page only', count: 1, active: true },
                { id: 'same', name: `All ${isCol ? 'column' : 'row'} splits`, count: 7 },
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
            <Button variant="default" size="sm" icon="x">Keep as one</Button>
            <Button variant="primary" size="sm" icon="scissors">Apply split → 2 pages</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ====================================================================
   ZoneEditor — manual layout annotator.
   Draw a box or lasso a region the detector missed, assign a type
   (illustrations especially), re-type or delete zones, fix reading order.
==================================================================== */
const ZoneEditor = ({ row }) => {
  const zones = ZONE_TEMPLATES[row.layoutKind] || ZONE_TEMPLATES.single;
  const [tool, setTool] = useSTE('box');           // select | box | lasso
  const [activeType, setActiveType] = useSTE('illustration');
  const t = ZONE_TYPES[activeType];

  // demo "new region" — a box being drawn around an illustration the
  // detector missed (lower-right). For the lasso tool, an in-progress
  // freeform path is shown instead.
  const newBox = { x: 0.50, y: 0.55, w: 0.34, h: 0.28 };

  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: '1.5px solid var(--ocr)', background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))', overflow: 'hidden', animation: 'pgd-slide-up .18s ease-out' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))', display: 'flex', alignItems: 'center', gap: 10, background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))' }}>
        <Icon name="image" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Edit layout · {row.prefix}.tif</span>
        {(row.flags || []).map(k => <ZnFlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.zones} zones · drag to draw · click a zone to re-type</span>
        <button style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={13} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* canvas */}
        <div style={{ padding: 16, background: 'var(--bg-sunk)', borderRight: '1px solid var(--border-1)', minHeight: 470, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          {/* tool toolbar */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
              {[['select', 'Select'], ['box', 'Draw box'], ['lasso', 'Lasso']].map(([k, label]) => {
                const a = tool === k;
                return (
                  <button key={k} onClick={() => setTool(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: 0, cursor: 'pointer', fontFamily: 'inherit', background: a ? 'var(--bg-surface)' : 'transparent', boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none', color: a ? 'var(--ocr)' : 'var(--ink-3)', fontSize: 12, fontWeight: a ? 600 : 500 }}>
                    <ToolIcon kind={k} size={13} />{label}
                  </button>
                );
              })}
            </div>
            <Divider vertical style={{ height: 22 }} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>as</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: 7, background: `color-mix(in oklab, ${t.tone} 12%, var(--bg-surface))`, border: `1px solid ${t.tone}`, color: 'var(--ink-1)', fontSize: 12, fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: t.tone }} />{t.label}
            </span>
          </div>

          {/* page with annotation surface */}
          <div style={{ position: 'relative', width: 300, height: 424, cursor: tool === 'select' ? 'default' : 'crosshair' }}>
            <ZonePageRender row={row} w={300} h={424} lod="l" showSplit={false} />

            {/* in-progress new region */}
            {tool === 'box' ? (
              <div style={{ position: 'absolute', left: `${newBox.x * 100}%`, top: `${newBox.y * 100}%`, width: `${newBox.w * 100}%`, height: `${newBox.h * 100}%`, border: `2px dashed ${t.tone}`, background: `color-mix(in oklab, ${t.tone} 12%, transparent)`, borderRadius: 2 }}>
                {[['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]].map(([k, x, y]) => (
                  <span key={k} style={{ position: 'absolute', left: `calc(${x * 100}% - 5px)`, top: `calc(${y * 100}% - 5px)`, width: 10, height: 10, borderRadius: 2, background: '#fff', border: `1.5px solid ${t.tone}` }} />
                ))}
                <span className="mono" style={{ position: 'absolute', top: -20, left: 0, height: 17, padding: '0 6px', borderRadius: 3, background: t.tone, color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="image" size={10} />new {t.label}
                </span>
              </div>
            ) : tool === 'lasso' ? (
              <svg width={300} height={424} viewBox="0 0 300 424" style={{ position: 'absolute', inset: 0 }}>
                <polygon points="156,236 250,232 262,300 230,360 168,352 150,300" fill={`color-mix(in oklab, ${t.tone} 14%, transparent)`} stroke={t.tone} strokeWidth="2" strokeDasharray="4 3" />
                {[[156,236],[250,232],[262,300],[230,360],[168,352],[150,300]].map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r="3.5" fill="#fff" stroke={t.tone} strokeWidth="1.5" />
                ))}
              </svg>
            ) : null}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
            {tool === 'select' ? 'Click any zone to select, re-type, or re-order' : tool === 'box' ? 'Drag a rectangle · release to add the region' : 'Click points around the region · close the loop to add'}
          </div>
        </div>

        {/* side panel */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* region-type palette */}
          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Region type</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(ZONE_TYPES).map(([k, zt]) => {
                const a = activeType === k;
                return (
                  <button key={k} onClick={() => setActiveType(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', background: a ? `color-mix(in oklab, ${zt.tone} 12%, var(--bg-surface))` : 'var(--bg-surface)', border: '1px solid ' + (a ? zt.tone : 'var(--border-1)'), color: a ? 'var(--ink-1)' : 'var(--ink-2)', fontSize: 11.5, fontWeight: a ? 600 : 500 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: `color-mix(in oklab, ${zt.tone} 35%, transparent)`, border: `1px solid ${zt.tone}` }} />{zt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ padding: '9px 11px', borderRadius: 7, background: 'color-mix(in oklab, var(--exact) 6%, var(--bg-surface))', border: '1px solid color-mix(in oklab, var(--exact) 30%, var(--border-1))', fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>Capture an illustration the detector missed:</span> draw a box or lasso it, leave the type on <span className="mono" style={{ color: 'var(--exact)' }}>illustration</span>. Illustration regions forward to <span className="mono">stage 13 · Illustrations</span> for extraction.
          </div>

          <Divider />

          {/* zone list */}
          <div style={{ minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="label" style={{ color: 'var(--ink-3)' }}>Zones on this page</div>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{zones.length} + 1 new</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 188, overflow: 'auto' }}>
              {[...zones.map((z, i) => ({ ...z, i, isNew: false })), { type: activeType, order: zones.length + 1, i: 'new', isNew: true }].map(z => {
                const zt = ZONE_TYPES[z.type];
                return (
                  <div key={z.i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: z.isNew ? `color-mix(in oklab, ${zt.tone} 8%, var(--bg-surface))` : 'var(--bg-surface)', border: '1px solid ' + (z.isNew ? zt.tone : 'var(--border-1)') }}>
                    <span className="mono" style={{ width: 16, height: 16, borderRadius: 3, background: zt.tone, color: '#fff', fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>{z.order < 90 ? z.order : '·'}</span>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: `color-mix(in oklab, ${zt.tone} 35%, transparent)`, border: `1px solid ${zt.tone}`, flex: '0 0 auto' }} />
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-1)' }}>{zt.label}{z.col ? ` · ${z.col}` : ''}{z.row ? ` · ${z.row}` : ''}</span>
                    {z.isNew ? <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: zt.tone }}>NEW</span> : <Icon name="chevD" size={11} style={{ color: 'var(--ink-4)' }} />}
                    <button style={{ width: 20, height: 20, border: 0, background: 'transparent', color: 'var(--ink-4)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="trash" size={11} /></button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm">Cancel</Button>
            <Button variant="default" size="sm" icon="refresh">Re-detect</Button>
            <Button variant="primary" size="sm" icon="check">Save layout</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { SplitEditor, ZoneEditor, ToolIcon });
