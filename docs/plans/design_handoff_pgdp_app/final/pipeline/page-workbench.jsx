// page-workbench.jsx — shared scaffold for every stage's "Page workbench" tab.
// The per-page deep-dive surface: left = stage controls drawer, right = page
// viewer (before/after, crop frame, zone/glyph overlays). Stage-specific
// bodies live in page-workbench-stages.jsx and compose these primitives.
//
// Renders as children of PipelineTemplate, which already provides the .pgd
// scope + a flex-column body — so every workbench returns a fragment of
// <WBSubhead/> + a flex:1 content grid (mirrors SourcePageWorkbench).

/* ---------------------- Subhead + standard action cluster ---------------------- */
const WBSubhead = ({ title, sub, right }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    padding: '18px 28px 0', gap: 14, flex: '0 0 auto',
  }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.005em' }}>{title}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, maxWidth: 760 }}>{sub}</div>
    </div>
    {right ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto' }}>{right}</div> : null}
  </div>
);

const WBActionsRight = ({ applyLabel = 'Apply & Continue', applyIcon = 'arrowR' }) => (
  <>
    <Button variant="ghost" size="sm" icon="chevL">Prev</Button>
    <Button variant="ghost" size="sm" iconRight="chevR">Next</Button>
    <Divider vertical style={{ height: 22 }} />
    <Button variant="primary" size="sm" iconRight={applyIcon}>{applyLabel}</Button>
  </>
);

/* The whole workbench fragment: subhead + 2-pane grid. `controlsWidth` lets
   text-heavy stages widen the right pane. */
const WBLayout = ({ title, sub, applyLabel, applyIcon, left, viewer, controlsWidth = 340 }) => (
  <>
    <WBSubhead title={title} sub={sub} right={<WBActionsRight applyLabel={applyLabel} applyIcon={applyIcon} />} />
    <div style={{
      padding: '14px 28px 28px', flex: 1, minHeight: 0,
      display: 'grid', gridTemplateColumns: controlsWidth + 'px 1fr', gap: 14,
    }}>
      {left}
      {viewer}
    </div>
  </>
);

/* ---------------------- Left drawer panel ---------------------- */
const WBPanel = ({ label, sub, badge, children, footer }) => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
    display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
  }}>
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-1)', flex: '0 0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{label}</div>
        {badge || null}
      </div>
      {sub ? <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{sub}</div> : null}
    </div>
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {children}
    </div>
    {footer ? (
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-1)', flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {footer}
      </div>
    ) : null}
  </div>
);

/* ---------------------- Field primitives ---------------------- */
const WBField = ({ label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    {label ? (
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{label}</span>
        {hint ? <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{hint}</span> : null}
      </div>
    ) : null}
    {children}
  </div>
);

const WBInput = ({ value, mono, suffix }) => (
  <div style={{
    height: 28, padding: '0 10px', background: 'var(--bg-sunk)',
    border: '1px solid var(--border-2)', borderRadius: 6,
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, color: 'var(--ink-1)', fontFamily: mono ? 'var(--mono-font)' : 'var(--ui-font)',
  }}>
    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    {suffix ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{suffix}</span> : null}
  </div>
);

const WBSelect = ({ value }) => (
  <div style={{
    height: 28, padding: '0 10px', background: 'var(--bg-sunk)',
    border: '1px solid var(--border-2)', borderRadius: 6,
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-1)',
  }}>
    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
  </div>
);

/* Segmented control. options: [{id,label,icon?,tone?}], active id. */
const WBSegment = ({ options, active, cols }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: 'repeat(' + (cols || options.length) + ', 1fr)', gap: 4,
    padding: 3, background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 7,
  }}>
    {options.map(o => {
      const a = o.id === active;
      const tone = o.tone || 'var(--accent)';
      return (
        <div key={o.id} style={{
          padding: '6px 4px', borderRadius: 5, cursor: 'pointer',
          background: a ? 'color-mix(in oklab, ' + tone + ' 14%, var(--bg-surface))' : 'transparent',
          color: a ? tone : 'var(--ink-3)', fontSize: 11, fontWeight: a ? 600 : 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          border: a ? '1px solid color-mix(in oklab, ' + tone + ' 45%, var(--border-1))' : '1px solid transparent',
        }}>
          {o.icon ? <Icon name={o.icon} size={11} /> : null}
          {o.label}
        </div>
      );
    })}
  </div>
);

/* Slider with a labelled track + value bubble. value/min/max numeric. */
const WBSlider = ({ value, min = 0, max = 100, unit = '', tone = 'var(--accent)' }) => {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', border: '1px solid var(--border-2)' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%', borderRadius: 99, background: tone }} />
        <div style={{
          position: 'absolute', top: '50%', left: pct + '%', transform: 'translate(-50%,-50%)',
          width: 13, height: 13, borderRadius: 99, background: 'var(--bg-surface)',
          border: '2px solid ' + tone, boxShadow: 'var(--shadow-floating)',
        }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-1)', fontWeight: 600, minWidth: 44, textAlign: 'right' }}>{value}{unit}</span>
    </div>
  );
};

const WBToggleRow = ({ label, sub, on }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-1)' }}>{label}</div>
      {sub ? <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>{sub}</div> : null}
    </div>
    <span style={{
      width: 30, height: 18, borderRadius: 99, cursor: 'pointer', flex: '0 0 auto', marginTop: 1,
      background: on ? 'var(--accent)' : 'var(--border-2)', position: 'relative', transition: 'background .12s',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 14, height: 14, borderRadius: 99, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.15)', transition: 'left .12s' }} />
    </span>
  </div>
);

/* Boxed note — info / warn / good tones. */
const WBNote = ({ tone = 'info', icon, title, children }) => {
  const c = { info: 'var(--ocr)', warn: 'var(--fuzzy)', good: 'var(--exact)', bad: 'var(--mismatch)' }[tone];
  return (
    <div style={{
      padding: '9px 11px', borderRadius: 7, display: 'flex', gap: 9,
      background: 'color-mix(in oklab, ' + c + ' 7%, var(--bg-surface))',
      border: '1px solid color-mix(in oklab, ' + c + ' 28%, var(--border-1))',
    }}>
      <Icon name={icon || (tone === 'warn' || tone === 'bad' ? 'alert' : tone === 'good' ? 'checkCircle' : 'info')} size={13} style={{ color: c, flex: '0 0 auto', marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        {title ? <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-1)' }}>{title}</div> : null}
        <div style={{ marginTop: title ? 2 : 0, fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
};

/* Compact stat chips, e.g. measurements that update with controls. */
const WBStatGrid = ({ items, cols = 2 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', 1fr)', gap: 8 }}>
    {items.map((it, i) => (
      <div key={i} style={{ background: 'var(--bg-sunk)', border: '1px solid var(--border-1)', borderRadius: 6, padding: '7px 9px' }}>
        <div style={{ fontSize: 9, color: 'var(--ink-3)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{it[0]}</div>
        <div className="mono" style={{ marginTop: 3, fontSize: 12.5, color: it[2] || 'var(--ink-1)', fontWeight: 600 }}>{it[1]}</div>
      </div>
    ))}
  </div>
);

/* ---------------------- Page viewer ---------------------- */
/* WBPage — FakeThumb base with absolutely-positioned overlay children +
   a corner label. `frame` draws a dashed content frame. */
const WBPage = ({ tone = 'light', hue, w = 340, h = 452, kind, cornerLabel, cornerTone, children }) => (
  <div style={{ position: 'relative', width: w, height: h, flex: '0 0 auto' }}>
    <FakeThumb tone={tone} hue={hue} width={w} height={h} kind={kind} />
    {children}
    {cornerLabel ? (
      <span style={{
        position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 4,
        background: cornerTone || 'rgba(0,0,0,0.5)', color: '#fff',
        fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600, letterSpacing: '.04em',
      }}>{cornerLabel}</span>
    ) : null}
  </div>
);

/* CropFrame overlay — content rectangle with corner ticks + dimmed margins. */
const CropFrame = ({ inset = '8% 10%', color = 'var(--accent)', label, dashed = true }) => (
  <div style={{ position: 'absolute', inset, pointerEvents: 'none' }}>
    <div style={{ position: 'absolute', inset: 0, border: (dashed ? '1.5px dashed ' : '2px solid ') + color, boxShadow: '0 0 0 9999px rgba(0,0,0,0.34)' }} />
    {['-1px -1px auto auto', '-1px auto auto -1px', 'auto -1px -1px auto', 'auto auto -1px -1px'].map((pos, i) => {
      const [t, r, b, l] = pos.split(' ');
      return <span key={i} style={{ position: 'absolute', top: t, right: r, bottom: b, left: l, width: 9, height: 9, borderRadius: 2, background: color }} />;
    })}
    {label ? (
      <span style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', padding: '1px 7px', borderRadius: 99, background: color, color: 'var(--accent-ink)', fontFamily: 'var(--mono-font)', fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
    ) : null}
  </div>
);

/* BeforeAfter — split-curtain compare. Right (after) clipped at `split` %. */
const BeforeAfter = ({ w = 340, h = 452, beforeTone = 'mid', beforeHue, afterTone = 'light', afterKind, split = 52, beforeLabel = 'BEFORE', afterLabel = 'AFTER' }) => (
  <div style={{ position: 'relative', width: w, height: h, flex: '0 0 auto' }}>
    <FakeThumb tone={beforeTone} hue={beforeHue} width={w} height={h} />
    <div style={{ position: 'absolute', inset: 0, width: split + '%', overflow: 'hidden' }}>
      <FakeThumb tone={afterTone} width={w} height={h} kind={afterKind} />
    </div>
    {/* curtain handle */}
    <div style={{ position: 'absolute', top: 0, bottom: 0, left: split + '%', width: 2, background: 'var(--accent)', transform: 'translateX(-1px)' }} />
    <div style={{
      position: 'absolute', top: '50%', left: split + '%', transform: 'translate(-50%,-50%)',
      width: 22, height: 22, borderRadius: 99, background: 'var(--bg-surface)', border: '2px solid var(--accent)',
      display: 'grid', placeItems: 'center', color: 'var(--accent)', boxShadow: 'var(--shadow-floating)',
    }}><Icon name="swap" size={11} /></div>
    <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.5)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>{afterLabel}</span>
    <span style={{ position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.32)', color: '#fff', fontFamily: 'var(--mono-font)', fontSize: 10, fontWeight: 600 }}>{beforeLabel}</span>
  </div>
);

/* WBViewer — right pane: toolbar + centered body + bottom page strip. */
const WBViewer = ({ stem = 'p0123', idx = 122, total = 387, dims = '2364 × 3568 · 600dpi', toolbarExtra, children, stripTone = 'light', stripActive = 6, footerNote }) => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
    display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
  }}>
    {/* Toolbar */}
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-1)', display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
      <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>{stem}</span>
      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>·</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{idx + 1} / {total}</span>
      <Divider vertical style={{ height: 18 }} />
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{dims}</span>
      <span style={{ flex: 1 }} />
      {toolbarExtra}
      <Button variant="ghost" size="sm" icon="search">Fit</Button>
      <Button variant="ghost" size="sm" icon="eye">Compare</Button>
    </div>
    {/* Body */}
    <div style={{ flex: 1, minHeight: 0, padding: 18, background: 'var(--bg-page)', display: 'flex', gap: 18, alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto' }}>
      {children}
    </div>
    {/* Page strip */}
    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-1)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
      <Button variant="ghost" size="sm" icon="chevL" />
      <div style={{ flex: 1, display: 'flex', gap: 5, overflow: 'hidden' }}>
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} style={{ flex: '0 0 auto', outline: i === stripActive ? '2px solid var(--accent)' : 'none', outlineOffset: 1, opacity: i > 12 ? 0.5 : 1 }}>
            <FakeThumb tone={stripTone} width={28} height={38} />
          </div>
        ))}
      </div>
      {footerNote ? <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', flex: '0 0 auto' }}>{footerNote}</span> : null}
      <Button variant="ghost" size="sm" iconRight="chevR" />
    </div>
  </div>
);

Object.assign(window, {
  WBSubhead, WBActionsRight, WBLayout, WBPanel,
  WBField, WBInput, WBSelect, WBSegment, WBSlider, WBToggleRow, WBNote, WBStatGrid,
  WBPage, CropFrame, BeforeAfter, WBViewer,
});
