// ui.jsx — shared UI primitives + app shell pieces.
// Scoped under .pgd · references design-system tokens only.
// Aesthetic: dense, terminal-adjacent. Borders > shadows. Mono for code-shaped.

const { useState } = React;

/* ---------------------- Inline icon set (Lucide-ish) ---------------------- */
const Icon = ({ name, size = 14, stroke = 1.6, className = '', style }) => {
  const c = { width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    folder: <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>,
    file:  <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
    archive: <><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    hardDrive: <><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    checkCircle: <><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    alert: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    info: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
    chevR: <polyline points="9 18 15 12 9 6"/>,
    chevL: <polyline points="15 18 9 12 15 6"/>,
    chevD: <polyline points="6 9 12 15 18 9"/>,
    arrowR: <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>,
    sun: <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>,
    grip: <><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></>,
    pause: <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    wrench: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-2.4z"/>,
    refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    loader: <path d="M21 12a9 9 0 1 1-6.219-8.56"/>,
    fileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></>,
    play: <polygon points="5 3 19 12 5 21 5 3"/>,
    package: <><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
    moreH: <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
    arrowUp: <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,
    arrowDown: <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>,
    arrowUpDown: <><polyline points="17 11 12 6 7 11"/><polyline points="17 13 12 18 7 13"/></>,
    scissors: <><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></>,
    sparkles: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.95 2.55L22.5 20.5l-2.55.95L19 24l-.95-2.55L15.5 20.5l2.55-.95z"/></>,
    swap: <><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  };
  return <svg viewBox="0 0 24 24" {...c} className={className} style={style} aria-hidden="true">{paths[name] || null}</svg>;
};

/* ---------------------- Button ----------------------
   Heights: sm=24, md=30, lg=34. Default variant uses bg-raised + border-2.
   Primary = accent. Ghost = transparent. Danger = mismatch tint.
   Old "outline" + "brand" aliases preserved for back-compat. */
const Button = ({ variant = 'default', size = 'md', icon, iconRight, full, disabled, children, style, ...rest }) => {
  const sizes = {
    sm: { h: 24, px: 9,  fs: 11,   gap: 5, r: 5 },
    md: { h: 30, px: 12, fs: 12,   gap: 6, r: 6 },
    lg: { h: 34, px: 14, fs: 13,   gap: 6, r: 6 },
  }[size];
  const variants = {
    default: { bg: 'var(--bg-raised)', color: 'var(--ink-1)', bd: '1px solid var(--border-2)' },
    outline: { bg: 'var(--bg-raised)', color: 'var(--ink-1)', bd: '1px solid var(--border-2)' }, // alias
    primary: { bg: 'var(--accent)', color: 'var(--accent-ink)', bd: '1px solid var(--accent)' },
    brand:   { bg: 'var(--accent)', color: 'var(--accent-ink)', bd: '1px solid var(--accent)' }, // alias
    ghost:   { bg: 'transparent', color: 'var(--ink-2)', bd: '1px solid transparent' },
    danger:  {
      bg: 'color-mix(in srgb, var(--mismatch) 7%, transparent)',
      color: 'var(--mismatch)',
      bd: '1px solid color-mix(in srgb, var(--mismatch) 27%, transparent)',
    },
  }[variant];
  return (
    <button {...rest} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      gap: sizes.gap, height: sizes.h, padding: `0 ${sizes.px}px`,
      width: full ? '100%' : 'auto',
      borderRadius: sizes.r, background: variants.bg, color: variants.color,
      border: variants.bd, fontSize: sizes.fs, fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      opacity: disabled ? 0.45 : 1,
      transition: 'background .12s, border-color .12s, color .12s',
      fontFamily: 'var(--ui-font)',
      ...style,
    }}>
      {icon ? <Icon name={icon} size={sizes.fs + 2} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={sizes.fs + 2} /> : null}
    </button>
  );
};

/* ---------------------- Input ---------------------- */
const Input = ({ value, placeholder, mono, suffix, autoFocus, style, onChange }) => (
  <div style={{
    display: 'flex', alignItems: 'center', height: 30, padding: '0 10px',
    background: 'var(--bg-sunk)', border: '1px solid var(--border-2)',
    borderRadius: 5, gap: 8,
    boxShadow: autoFocus ? '0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent)' : 'none',
    borderColor: autoFocus ? 'var(--accent)' : 'var(--border-2)',
    ...style,
  }}>
    <input
      defaultValue={value} placeholder={placeholder} onChange={onChange}
      style={{
        flex: 1, border: 0, outline: 0, background: 'transparent',
        fontSize: 12, color: 'var(--ink-1)',
        fontFamily: mono ? 'var(--mono-font)' : 'var(--ui-font)',
      }} />
    {suffix ? <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono-font)' }}>{suffix}</span> : null}
  </div>
);

/* ---------------------- Badge / status pip ----------------------
   Tones map to the new status semantics:
     clean/exact → --exact   (OCR==GT · done)
     dirty/fuzzy → --fuzzy   (review)
     running/ocr → --ocr     (running, in-progress)
     failed/mismatch → --mismatch  (error)
     review → --fuzzy
     brand → --accent
   Visual: 18px tall, 10% tinted bg, 33% tinted border. */
const Badge = ({ tone = 'neutral', children, dot, mono, style }) => {
  const colorFor = (t) => ({
    neutral:  null,
    brand:    'var(--accent)',
    clean:    'var(--exact)',
    exact:    'var(--exact)',
    dirty:    'var(--fuzzy)',
    fuzzy:    'var(--fuzzy)',
    review:   'var(--fuzzy)',
    running:  'var(--ocr)',
    ocr:      'var(--ocr)',
    failed:   'var(--mismatch)',
    mismatch: 'var(--mismatch)',
    error:    'var(--mismatch)',
    gt:       'var(--gt)',
  })[tone];
  const color = colorFor(tone);
  const isNeutral = !color;
  return (
    <span className={mono ? 'mono' : ''} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: 18, padding: '0 7px', borderRadius: 9,
      fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
      color: isNeutral ? 'var(--ink-2)' : color,
      background: isNeutral
        ? 'var(--bg-raised)'
        : `color-mix(in srgb, ${color} 10%, transparent)`,
      border: isNeutral
        ? '1px solid var(--border-2)'
        : `1px solid color-mix(in srgb, ${color} 33%, transparent)`,
      ...style,
    }}>
      {dot !== false && !isNeutral ? (
        <span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />
      ) : null}
      {children}
    </span>
  );
};

/* ---------------------- KeyCap ---------------------- */
const KeyCap = ({ children }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 18, height: 18, padding: '0 5px',
    background: 'var(--bg-sunk)',
    border: '1px solid var(--border-3)', borderBottomWidth: 2,
    borderRadius: 3,
    fontFamily: 'var(--mono-font)', fontSize: 9.5, fontWeight: 500,
    color: 'var(--ink-2)',
  }}>{children}</span>
);

/* ---------------------- Divider ---------------------- */
const Divider = ({ vertical, style }) => (
  <div style={{
    background: 'var(--border-1)',
    ...(vertical ? { width: 1, alignSelf: 'stretch' } : { height: 1, width: '100%' }),
    ...style,
  }} />
);

/* ---------------------- Step dots ---------------------- */
const StepDots = ({ steps, current }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    {steps.map((s, i) => {
      const active = i === current; const done = i < current;
      return (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 18, height: 18, borderRadius: 99,
              background: active ? 'var(--accent)' : done ? 'var(--exact)' : 'var(--bg-raised)',
              color: active || done ? 'var(--accent-ink)' : 'var(--ink-3)',
              border: active || done ? 'none' : '1px solid var(--border-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600, fontFamily: 'var(--mono-font)',
            }}>{done ? <Icon name="check" size={10} stroke={3}/> : (i + 1)}</div>
            <span style={{
              fontSize: 11.5, fontWeight: active ? 600 : 500,
              color: active ? 'var(--ink-1)' : done ? 'var(--ink-2)' : 'var(--ink-3)',
            }}>{s}</span>
          </div>
          {i < steps.length - 1 ? <div style={{ width: 18, height: 1, background: 'var(--border-1)' }} /> : null}
        </React.Fragment>
      );
    })}
  </div>
);

/* ---------------------- App shell ----------------------
   Top header sits at the same color as the page (`bg-page`), separated only
   by a 1-px border. No dark slate strip — depth comes from elevation steps. */
const TopNav = () => (
  <header style={{
    height: 48, background: 'var(--bg-page)', color: 'var(--ink-2)',
    display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
    padding: '0 16px', borderBottom: '1px solid var(--border-1)', flex: '0 0 auto',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{
        width: 22, height: 22, borderRadius: 5, background: 'var(--accent)',
        display: 'grid', placeItems: 'center', color: 'var(--accent-ink)',
        fontWeight: 700, fontSize: 12, fontFamily: 'var(--mono-font)',
      }}>p</div>
      <span style={{ color: 'var(--ink-1)', fontWeight: 600, fontSize: 13 }}>pgdp-prep</span>
    </div>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      width: 320, height: 28, padding: '0 10px',
      background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 5,
      color: 'var(--ink-3)', fontSize: 12,
    }}>
      <Icon name="search" size={13} />
      <span style={{ flex: 1, fontFamily: 'var(--mono-font)' }}>Search pages…</span>
      <KeyCap>⌘K</KeyCap>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
      <div style={{ position: 'relative', color: 'var(--ink-3)', padding: 2 }}>
        <Icon name="bell" size={15} />
        <span style={{
          position: 'absolute', top: -2, right: -3, minWidth: 14, height: 14, padding: '0 4px',
          background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 99,
          fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center',
          border: '2px solid var(--bg-page)', fontFamily: 'var(--mono-font)',
        }}>2</span>
      </div>
      <div style={{
        width: 26, height: 26, borderRadius: 99,
        background: 'var(--bg-raised)', border: '1px solid var(--border-2)',
        display: 'grid', placeItems: 'center', color: 'var(--ink-2)',
        fontSize: 10.5, fontWeight: 600,
      }}>JS</div>
    </div>
  </header>
);

const ServerFooter = () => (
  <footer style={{
    height: 26, background: 'var(--bg-page)', borderTop: '1px solid var(--border-1)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--mono-font)', flex: '0 0 auto',
  }}>
    <span>server:</span>
    <span style={{ color: 'var(--ink-2)' }}>127.0.0.1:58693</span>
    <Icon name="copy" size={11} style={{ color: 'var(--ink-4)' }} />
  </footer>
);

const PageHeader = ({ title, sub, action }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '32px 40px 20px',
  }}>
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ink-1)' }}>{title}</h1>
      {sub ? <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>{sub}</p> : null}
    </div>
    <div>{action}</div>
  </div>
);

const ProjectListBackdrop = () => (
  <>
    <PageHeader title="Projects" action={<Button variant="primary" icon="plus">New project</Button>} />
    <div style={{ padding: '0 40px' }}>
      <div style={{
        width: 400, background: 'var(--bg-surface)', borderRadius: 8,
        border: '1px solid var(--border-1)', padding: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>bellocsurvivials</div>
            <div className="mono" style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-3)' }}>232 pages · May 15, 2026</div>
          </div>
          <Badge tone="review">Queued</Badge>
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--ink-4)', fontSize: 14 }}>···</span>
          <Button variant="default" size="sm">Open</Button>
        </div>
      </div>
    </div>
  </>
);

/* Full app frame: shell + optional dialog overlay */
const AppFrame = ({ theme = 'dark', children, modalNode, sheetNode, dialogPos = 'center' }) => (
  <div className="pgd" data-theme={theme} style={{
    width: '100%', height: '100%', position: 'relative',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }}>
    <TopNav />
    <main style={{ flex: 1, background: 'var(--bg-page)', position: 'relative', overflow: 'hidden' }}>
      <ProjectListBackdrop />
      {children}
      {modalNode ? (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: dialogPos === 'top' ? 'flex-start' : 'center', justifyContent: 'center',
          paddingTop: dialogPos === 'top' ? 60 : 0,
          backdropFilter: 'blur(2px)',
        }}>
          {modalNode}
        </div>
      ) : null}
      {sheetNode ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'flex-end',
          background: 'rgba(0,0,0,0.40)' }}>
          {sheetNode}
        </div>
      ) : null}
    </main>
    <ServerFooter />
  </div>
);

Object.assign(window, {
  Icon, Button, Input, Badge, KeyCap, Divider, StepDots,
  TopNav, ServerFooter, PageHeader, AppFrame, ProjectListBackdrop,
});
