// crop.jsx — Crop-stage content components.
// CropPages (Pages tab — grid + flag review + inline bbox editor),
// CropOverview, CropStepSettings, plus CroppedThumb (extends FakeThumb
// with a dashed bbox overlay) and FlagChip primitives.

const { useState: useSC, useMemo: useMC } = React;

/* ---------------------- CroppedThumb ----------------------
   A FakeThumb wrapped with bbox overlays. We render two rectangles:
   the SOURCE outline (the full scan extent, faint) and the BBOX (the
   crop the worker chose, dashed accent / red when bad). Flag tones
   recolor the bbox so the grid reads at a glance — over-crop in red,
   under-crop in blue, etc.
*/
const CroppedThumb = ({
  row, w, h, showSourceOutline = true, bboxColor, dashColor,
  dashed = true, fingerEdge,
}) => {
  const bbox = row.bbox || { t: .07, r: .10, b: .07, l: .10 };
  // Color the bbox by the dominant flag so the grid is scannable.
  const dom = row.flags ? row.flags[0] : null;
  const color = bboxColor || (dom && CROP_FLAGS[dom] ? CROP_FLAGS[dom].tone : 'var(--accent)');
  // Outer "source" rectangle = the raw scan: a darker frame around the crop.
  return (
    <div style={{
      width: w, height: h, position: 'relative',
      background: 'oklch(0.18 0.012 60)',
      border: '1px solid var(--border-2)',
      borderRadius: 3, overflow: 'hidden',
    }}>
      {/* Source-image hint: faint warm bg + scanner-shadow gradient on edges */}
      {showSourceOutline ? (
        <>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at center, oklch(0.32 0.015 60) 35%, oklch(0.14 0.012 60) 100%)',
          }} />
          {/* Scanner shadow stripes on left/right */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, oklch(0.08 0.01 60) 0%, transparent 6%, transparent 94%, oklch(0.08 0.01 60) 100%)',
          }} />
        </>
      ) : null}

      {/* The cropped page (paper-toned) — positioned per bbox */}
      <div style={{
        position: 'absolute',
        top:    (bbox.t * 100) + '%',
        right:  (bbox.r * 100) + '%',
        bottom: (bbox.b * 100) + '%',
        left:   (bbox.l * 100) + '%',
        background: 'oklch(0.94 0.012 85)',
        borderRadius: 1,
        boxShadow: '0 0 0 1px rgba(40,30,20,0.15), 0 1px 4px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        transform: row.skewDeg ? `rotate(${row.skewDeg}deg)` : 'none',
        transformOrigin: 'center',
      }}>
        {/* Faint ink lines mimicking a printed page */}
        <div style={{
          position: 'absolute', inset: '12% 14% 14% 14%',
          backgroundImage: `repeating-linear-gradient(
            to bottom,
            oklch(0.34 0.02 60) 0 1.2px,
            transparent 1.2px 6px
          )`,
          opacity: 0.65,
        }} />
        {/* Page number stripe near bottom */}
        <div style={{
          position: 'absolute', left: '42%', right: '42%', bottom: '7%',
          height: 2, background: 'oklch(0.34 0.02 60)', opacity: .55,
        }} />
      </div>

      {/* Finger / jig artifact (purely decorative — shows the flag visually) */}
      {fingerEdge || (row.flags && row.flags.includes('finger')) ? (
        <div style={{
          position: 'absolute',
          top: '34%', bottom: '34%', right: '-2%', width: '14%',
          background: 'radial-gradient(ellipse at left center, oklch(0.55 0.07 40) 0%, transparent 75%)',
          opacity: 0.65,
        }} />
      ) : null}

      {/* Dashed bbox overlay */}
      <div style={{
        position: 'absolute',
        top:    (bbox.t * 100) + '%',
        right:  (bbox.r * 100) + '%',
        bottom: (bbox.b * 100) + '%',
        left:   (bbox.l * 100) + '%',
        border: `1.5px ${dashed ? 'dashed' : 'solid'} ${dashColor || color}`,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${dashColor || color} 35%, transparent)`,
        pointerEvents: 'none',
      }} />
    </div>
  );
};

/* ---------------------- FlagChip ---------------------- */
const FlagChip = ({ kind, size = 'sm' }) => {
  const f = CROP_FLAGS[kind]; if (!f) return null;
  const dims = size === 'lg'
    ? { h: 22, px: 8, fs: 11, dot: 6 }
    : size === 'md'
    ? { h: 18, px: 7, fs: 10, dot: 5 }
    : { h: 16, px: 6, fs: 9.5, dot: 4.5 };
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: dims.h, padding: `0 ${dims.px}px`, borderRadius: 99,
      fontSize: dims.fs, fontWeight: 600,
      background: `color-mix(in oklab, ${f.tone} 16%, rgba(12,12,16,0.78))`,
      color: f.tone,
      border: `1px solid color-mix(in oklab, ${f.tone} 45%, transparent)`,
    }}>
      <span style={{ width: dims.dot, height: dims.dot, borderRadius: 99, background: f.tone }} />
      {f.label}
    </span>
  );
};

/* ---------------------- Status dot (running / clean / flagged / reviewed / failed) ---------------------- */
const StatusDot = ({ state, size = 8 }) => {
  const tone =
    state === 'clean'    ? 'var(--exact)' :
    state === 'flagged'  ? 'var(--fuzzy)' :
    state === 'reviewed' ? 'var(--ocr)'   :
    state === 'running'  ? 'var(--ocr)'   :
    state === 'failed'   ? 'var(--mismatch)' :
    'var(--ink-4)';
  return (
    <span style={{
      width: size, height: size, borderRadius: 99, background: tone,
      boxShadow: state === 'running' ? `0 0 0 2px color-mix(in oklab, ${tone} 30%, transparent)` : 'none',
      animation: state === 'running' ? 'pgd-pulse 1.2s ease-in-out infinite' : 'none',
      display: 'inline-block', flex: '0 0 auto',
    }} />
  );
};

/* ---------------------- CropCard ----------------------
   A single grid cell built around CroppedThumb. Handles checkbox, flag
   chips top-right, filename overlay, status dot. Three densities.
*/
const CROP_DENSITY = {
  S: { col: 9, w: 96,  h: 122, fs: 10,   flagMax: 1, flagSize: 'sm' },
  M: { col: 6, w: 140, h: 178, fs: 11,   flagMax: 2, flagSize: 'sm' },
  L: { col: 4, w: 200, h: 254, fs: 12.5, flagMax: 3, flagSize: 'md' },
};

const CropCard = ({ row, density = 'M', selected, hovered, expanded, onClick }) => {
  const cfg = CROP_DENSITY[density];
  const isRunning = row.state === 'running';
  const flags = (row.flags || []).slice(0, cfg.flagMax);
  const extra = (row.flags || []).length - flags.length;
  return (
    <div onClick={onClick} style={{
      position: 'relative',
      padding: 4, borderRadius: 6,
      background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' :
                  expanded  ? 'color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))' :
                  'transparent',
      border: '1.5px solid ' + (
        selected ? 'var(--accent)' :
        expanded ? 'var(--ocr)' :
        hovered  ? 'var(--border-3)' :
        'transparent'
      ),
      cursor: 'pointer',
      transition: 'border-color .12s, background .12s',
    }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isRunning ? (
          <SkeletonThumb width={cfg.w - 8} height={cfg.h - 36} />
        ) : (
          <CroppedThumb row={row} w={cfg.w - 8} h={cfg.h - 36} />
        )}

        {/* checkbox top-left */}
        {!isRunning ? (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            width: 18, height: 18, borderRadius: 4,
            background: selected ? 'var(--accent)' : 'rgba(12,12,16,0.78)',
            border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(240,240,242,0.40)'),
            display: 'grid', placeItems: 'center',
            color: selected ? 'var(--accent-ink)' : 'transparent',
          }}>
            <Icon name="check" size={11} stroke={3} />
          </div>
        ) : null}

        {/* page-number badge bottom-left */}
        {row.pageNumber != null ? (
          <div style={{
            position: 'absolute', bottom: 6, left: 6,
            height: 18, padding: '0 6px', borderRadius: 4,
            background: 'rgba(12,12,16,0.78)', color: '#fff',
            fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <StatusDot state={row.state} size={6} />
            {row.pageNumber}
          </div>
        ) : null}

        {/* flag chips top-right */}
        {flags.length > 0 ? (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end',
          }}>
            {flags.map(k => <FlagChip key={k} kind={k} size={cfg.flagSize} />)}
            {extra > 0 ? (
              <span className="mono" style={{
                fontSize: 9.5, fontWeight: 700,
                padding: '1px 5px', borderRadius: 3,
                background: 'rgba(12,12,16,0.85)', color: '#f0f0f2',
              }}>+{extra}</span>
            ) : null}
          </div>
        ) : null}

        {row.state === 'reviewed' ? (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 16, padding: '0 6px', borderRadius: 99,
            background: 'color-mix(in oklab, var(--ocr) 18%, rgba(12,12,16,0.78))',
            color: 'var(--ocr)',
            border: '1px solid color-mix(in oklab, var(--ocr) 45%, transparent)',
            fontSize: 9.5, fontWeight: 600,
          }}>
            <Icon name="check" size={9} stroke={3} />
            reviewed
          </div>
        ) : null}
      </div>

      {/* Filename */}
      <div style={{
        marginTop: 5, height: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
      }}>
        <span className="mono" style={{
          fontSize: cfg.fs, color: 'var(--ink-3)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.prefix}</span>
        {!isRunning && density !== 'S' ? (
          <span className="mono" style={{ fontSize: cfg.fs - 1, color: 'var(--ink-4)' }}>
            {row.state === 'clean' ? 'ok' :
             row.state === 'flagged' ? `${row.flags.length} flag${row.flags.length>1?'s':''}` :
             row.state === 'reviewed' ? 'ok·rv' :
             row.state}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- CropBanner ----------------------
   Three flavors: running (worker progress), review (X flagged) and done.
*/
const CropBanner = ({ state, totals, stale = false }) => {
  if (state === 'running') {
    const pct = Math.round((totals.cropped / totals.total) * 100);
    return (
      <div style={{
        borderRadius: 10,
        border: '1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))',
        background: 'color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))',
          color: 'var(--ocr)', display: 'grid', placeItems: 'center', flex: '0 0 auto',
        }}>
          <span style={{
            width: 14, height: 14, borderRadius: 99,
            border: '2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)',
            borderTopColor: 'var(--ocr)',
            animation: 'pgd-spin 1.1s linear infinite',
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
            Cropping pages…
            <span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500 }}>
              {totals.cropped} / {totals.total} · {totals.rateHz}/s · {totals.flagged} flagged so far
            </span>
          </div>
          <div style={{
            marginTop: 8, height: 4, borderRadius: 99,
            background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))',
            overflow: 'hidden',
          }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} />
          </div>
        </div>
        <Button variant="default" size="sm" icon="pause">Pause</Button>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ocr)', flex: '0 0 auto' }}>
          {pct}%
        </span>
      </div>
    );
  }

  // review / done
  const flagged = totals.flagged;
  const tone = flagged > 0 ? 'var(--fuzzy)' : 'var(--exact)';
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid color-mix(in oklab, ' + tone + ' 40%, var(--border-1))',
      background: 'color-mix(in oklab, ' + tone + ' 7%, var(--bg-surface))',
      display: 'flex', alignItems: 'stretch', overflow: 'hidden',
    }}>
      <div style={{ width: 4, background: tone }} />
      <div style={{
        flex: 1, padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: 'color-mix(in oklab, ' + tone + ' 18%, var(--bg-surface))',
            color: tone, display: 'grid', placeItems: 'center', flex: '0 0 auto',
          }}>
            <Icon name={flagged > 0 ? 'alert' : 'checkCircle'} size={15} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
              {totals.cropped} pages cropped
              {flagged > 0 ? <> · <span style={{ color: tone }}>{flagged} flagged</span> · {totals.reviewed} reviewed</>
                          : <> · all clean</>}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
              {flagged > 0
                ? 'Click any flagged page to inspect; bulk-select to re-run with a different strategy.'
                : 'All pages passed auto-crop checks. Confirm to advance.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['clean',     totals.clean,    'var(--exact)'],
                ['flagged',   totals.flagged,  'var(--fuzzy)'],
                ['reviewed',  totals.reviewed, 'var(--ocr)'],
                ['errors',    totals.errors,   'var(--mismatch)'],
              ].filter(([_, n]) => n > 0).map(([k, n, color]) => (
                <span key={k} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  height: 20, padding: '0 8px', borderRadius: 99,
                  fontSize: 11, fontWeight: 500,
                  background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
                  color: 'var(--ink-2)',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />
                  {k} <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        {stale ? (
          <div style={{
            padding: '6px 10px', borderRadius: 6,
            background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)',
            border: '1px solid color-mix(in oklab, var(--fuzzy) 35%, transparent)',
            color: 'var(--fuzzy)', fontSize: 11.5, fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="alert" size={12} />
            Settings changed — 22 downstream stages now stale
          </div>
        ) : null}
      </div>
    </div>
  );
};

/* ---------------------- Filter chips + density + actions ---------------------- */
const CropToolbar = ({ filter, density, totals, selectedCount = 0 }) => {
  const chips = [
    { id: 'all',      name: 'All',      count: totals.total },
    { id: 'flagged',  name: 'Flagged',  count: totals.flagged, dot: 'var(--fuzzy)' },
    { id: 'clean',    name: 'Clean',    count: totals.clean,   dot: 'var(--exact)' },
    { id: 'reviewed', name: 'Reviewed', count: totals.reviewed, dot: 'var(--ocr)' },
    { id: 'errors',   name: 'Errors',   count: totals.errors,  dot: 'var(--mismatch)' },
    ...(selectedCount > 0 ? [{ id: 'selected', name: 'Selected', count: selectedCount, dot: 'var(--accent)' }] : []),
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{
        display: 'flex', gap: 4, padding: 4,
        background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)',
      }}>
        {chips.map(f => {
          const active = filter === f.id;
          return (
            <div key={f.id} style={{
              padding: '5px 10px', borderRadius: 6,
              background: active ? 'var(--bg-surface)' : 'transparent',
              boxShadow: active ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 7,
              color: active ? 'var(--ink-1)' : 'var(--ink-3)',
              fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: 'pointer',
            }}>
              {f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}
              {f.name}
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span>
            </div>
          );
        })}
      </div>

      <Divider vertical style={{ height: 22 }} />

      {/* Per-flag drill-down (only when filter is flagged) */}
      {filter === 'flagged' ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(CROP_FLAG_COUNTS).slice(0, 4).map(([k, n]) => {
            const f = CROP_FLAGS[k];
            return (
              <span key={k} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                height: 22, padding: '0 8px', borderRadius: 99,
                background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
                color: 'var(--ink-2)', fontSize: 11, cursor: 'pointer',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: f.tone }} />
                {f.label}
                <span className="mono" style={{ color: 'var(--ink-4)' }}>{n}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-3)' }}>
          <Icon name="search" size={13} />
          <span>Search pages…</span>
          <KeyCap>/</KeyCap>
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="default" size="sm" icon="refresh">Re-run with new strategy</Button>
        <Divider vertical style={{ height: 22 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
          Density
          <div style={{
            display: 'inline-flex', padding: 3, background: 'var(--bg-raised)',
            border: '1px solid var(--border-1)', borderRadius: 7,
          }}>
            {['S', 'M', 'L'].map(d => {
              const a = density === d;
              return (
                <div key={d} style={{
                  padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                  background: a ? 'var(--bg-surface)' : 'transparent',
                  boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
                  color: a ? 'var(--ink-1)' : 'var(--ink-3)',
                  fontSize: 11, fontWeight: a ? 600 : 500, fontFamily: 'var(--mono-font)',
                }}>{d}</div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- CropBulkBar ---------------------- */
const CropBulkBar = ({ count, flagSummary }) => (
  <div style={{
    position: 'sticky', bottom: 12, marginTop: 12, zIndex: 5,
    padding: '10px 14px', borderRadius: 10,
    background: 'var(--ink-1)', color: 'var(--bg-page)',
    boxShadow: '0 12px 28px rgba(15,23,42,.22), 0 2px 6px rgba(15,23,42,.10)',
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  }}>
    <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
      {count} selected
    </span>
    {flagSummary ? (
      <>
        <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
        <span style={{ fontSize: 11.5, color: 'color-mix(in oklab, var(--bg-page) 70%, transparent)' }}>
          {flagSummary}
        </span>
      </>
    ) : null}
    <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    {[
      { id: 'redeskew', name: 'Re-deskew only', icon: 'refresh' },
      { id: 'recrop',   name: 'Re-run from crop', icon: 'scissors' },
      { id: 'accept',   name: 'Accept as-is',  icon: 'check' },
      { id: 'restore',  name: 'Restore default bbox', icon: 'swap' },
    ].map(b => (
      <button key={b.id} style={{
        height: 26, padding: '0 10px', borderRadius: 6,
        background: 'color-mix(in oklab, var(--bg-page) 12%, transparent)',
        border: '1px solid color-mix(in oklab, var(--bg-page) 22%, transparent)',
        color: 'var(--bg-page)', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
      }}>
        <Icon name={b.icon} size={11} />
        {b.name}
      </button>
    ))}
    <span style={{ flex: 1 }} />
    <span className="mono" style={{ fontSize: 10.5, color: 'color-mix(in oklab, var(--bg-page) 55%, transparent)' }}>
      <KeyCap>esc</KeyCap> clear · <KeyCap>⇧</KeyCap>+click range
    </span>
  </div>
);

/* ---------------------- BboxEditor ----------------------
   Inline expanded editor that opens when clicking a flagged thumb. Two
   columns: magnified page on the left with bbox overlays, controls on the
   right (margin inputs + apply-to scope + actions).
*/
const MarginField = ({ label, value, unit = 'px', proposed }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '20px 1fr 60px',
    gap: 8, alignItems: 'center',
  }}>
    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>{label}</span>
    <div style={{
      height: 28, padding: '0 10px',
      background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span className="mono" style={{ flex: 1, fontSize: 12, color: 'var(--ink-1)', fontWeight: 500 }}>{value}</span>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{unit}</span>
    </div>
    <span className="mono" style={{
      fontSize: 10.5, color: proposed > value ? 'var(--exact)' : 'var(--mismatch)',
      textAlign: 'right',
    }}>
      {proposed > value ? '+' : ''}{proposed - value}
    </span>
  </div>
);

const BboxEditor = ({ row }) => {
  return (
    <div style={{
      marginTop: 14,
      borderRadius: 10,
      border: '1.5px solid var(--ocr)',
      background: 'color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))',
      overflow: 'hidden',
      animation: 'pgd-slide-up .18s ease-out',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid color-mix(in oklab, var(--ocr) 22%, var(--border-1))',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))',
      }}>
        <Icon name="scissors" size={14} style={{ color: 'var(--ocr)' }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
          Edit bbox · {row.prefix}.jp2
        </span>
        {(row.flags || []).map(k => <FlagChip key={k} kind={k} size="md" />)}
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          source 2480 × 3508 · current bbox 2008 × 3018
        </span>
        <button style={{
          width: 24, height: 24, border: 0, background: 'transparent',
          color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center',
        }}>
          <Icon name="x" size={13} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* Magnified page */}
        <div style={{
          padding: 16, background: 'var(--bg-sunk)',
          borderRight: '1px solid var(--border-1)',
          position: 'relative', minHeight: 420,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
        }}>
          <div style={{ position: 'relative' }}>
            {/* Source image */}
            <div style={{
              width: 320, height: 452,
              background: 'oklch(0.18 0.012 60)',
              borderRadius: 4, overflow: 'hidden', position: 'relative',
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: 'radial-gradient(ellipse at center, oklch(0.32 0.015 60) 35%, oklch(0.14 0.012 60) 100%)',
              }} />
              {/* the page */}
              <div style={{
                position: 'absolute',
                top: (row.bbox.t * 100) + '%',
                right: (row.bbox.r * 100) + '%',
                bottom: (row.bbox.b * 100) + '%',
                left: (row.bbox.l * 100) + '%',
                background: 'oklch(0.94 0.012 85)',
                boxShadow: '0 0 0 1px rgba(40,30,20,0.15), 0 2px 10px rgba(0,0,0,0.45)',
                overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', inset: '12% 14%',
                  backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.34 0.02 60) 0 1.4px, transparent 1.4px 7px)',
                  opacity: 0.65,
                }} />
              </div>
              {/* Current bbox (red, dashed) */}
              <div style={{
                position: 'absolute',
                top: (row.bbox.t * 100) + '%',
                right: (row.bbox.r * 100) + '%',
                bottom: (row.bbox.b * 100) + '%',
                left: (row.bbox.l * 100) + '%',
                border: '1.5px dashed var(--mismatch)',
                pointerEvents: 'none',
              }} />
              {/* Proposed bbox (accent, solid) — slightly different from current */}
              {(() => {
                const p = { t: 0.08, r: 0.09, b: 0.08, l: 0.09 };
                return (
                  <div style={{
                    position: 'absolute',
                    top: (p.t * 100) + '%',
                    right: (p.r * 100) + '%',
                    bottom: (p.b * 100) + '%',
                    left: (p.l * 100) + '%',
                    border: '2px solid var(--accent)',
                    boxShadow: '0 0 0 1px color-mix(in oklab, var(--accent) 40%, transparent)',
                    pointerEvents: 'none',
                  }}>
                    {/* draggable handles */}
                    {[
                      { top: -5, left: -5 }, { top: -5, right: -5 },
                      { bottom: -5, left: -5 }, { bottom: -5, right: -5 },
                      { top: -5, left: '50%', transform: 'translateX(-50%)' },
                      { bottom: -5, left: '50%', transform: 'translateX(-50%)' },
                      { top: '50%', left: -5, transform: 'translateY(-50%)' },
                      { top: '50%', right: -5, transform: 'translateY(-50%)' },
                    ].map((pos, i) => (
                      <span key={i} style={{
                        position: 'absolute', width: 10, height: 10, borderRadius: 2,
                        background: 'var(--accent)', border: '1.5px solid #fff',
                        boxShadow: '0 1px 2px rgba(0,0,0,.30)',
                        ...pos,
                      }} />
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Legend below */}
            <div style={{
              marginTop: 10, display: 'flex', justifyContent: 'center', gap: 14,
              fontSize: 11, color: 'var(--ink-3)',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 0, borderTop: '1.5px dashed var(--mismatch)' }} />
                current bbox
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 0, borderTop: '2px solid var(--accent)' }} />
                proposed bbox
              </span>
            </div>
          </div>
        </div>

        {/* Side panel — inputs + scope */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Margins</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MarginField label="↑T"   value={56}  unit="px" proposed={198} />
              <MarginField label="→R"   value={172} unit="px" proposed={223} />
              <MarginField label="↓B"   value={56}  unit="px" proposed={198} />
              <MarginField label="←L"   value={545} unit="px" proposed={223} />
            </div>
            <div style={{
              marginTop: 8, display: 'inline-flex', padding: 3,
              background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 6,
            }}>
              {['px', '%'].map((u, i) => {
                const a = i === 0;
                return (
                  <div key={u} style={{
                    padding: '3px 12px', borderRadius: 4,
                    background: a ? 'var(--bg-surface)' : 'transparent',
                    boxShadow: a ? '0 0 0 1px var(--border-1)' : 'none',
                    color: a ? 'var(--ink-1)' : 'var(--ink-3)',
                    fontSize: 11, fontWeight: a ? 600 : 500, cursor: 'pointer',
                    fontFamily: 'var(--mono-font)',
                  }}>{u}</div>
                );
              })}
            </div>
          </div>

          <Divider />

          <div>
            <div className="label" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Apply to</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { id: 'this',     name: 'This page only',                  count: 1,  active: true },
                { id: 'selected', name: 'Selected pages',                 count: 3 },
                { id: 'same',     name: 'All flagged with same issue',    count: 9 },
              ].map(opt => (
                <label key={opt.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  background: opt.active ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)',
                  border: '1px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-1)'),
                }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 99,
                    background: opt.active ? 'var(--accent)' : 'transparent',
                    border: '1.5px solid ' + (opt.active ? 'var(--accent)' : 'var(--border-2)'),
                    display: 'grid', placeItems: 'center', flex: '0 0 auto',
                  }}>
                    {opt.active ? <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--accent-ink)' }} /> : null}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-1)' }}>{opt.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{opt.count}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm">Cancel</Button>
            <Button variant="default" size="sm" icon="check">Accept as-is</Button>
            <Button variant="primary" size="sm" icon="scissors">Re-crop</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------- CropPages (the Pages tab body) ----------------------
   States:
     state='running'   — worker still going; grid mixes done + skeleton
     state='review'    — review the flagged pages
     state='done'      — all reviewed/clean (kept for parity)
   density: 'S' | 'M' | 'L'
   filter:  'all' | 'flagged' | 'clean' | 'reviewed' | 'errors' | 'selected'
   selected: array of row.idx values
   editing:  row.idx of the expanded inline editor (or null)
*/
const CropPages = ({
  state = 'review', density = 'M', filter = 'all',
  selected = [], editing = null, stale = false,
}) => {
  const totals = state === 'running' ? CROP_TOTALS_RUNNING
              : state === 'done'    ? CROP_TOTALS_DONE
              :                       CROP_TOTALS_REVIEW;

  const rows = state === 'running'
    ? CROP_ROWS.map((r, i) => i < 13 ? r : { ...r, state: 'running', pageNumber: undefined, flags: undefined, bbox: undefined })
    : CROP_ROWS;

  const filtered =
    filter === 'flagged'  ? rows.filter(r => r.state === 'flagged') :
    filter === 'clean'    ? rows.filter(r => r.state === 'clean') :
    filter === 'reviewed' ? rows.filter(r => r.state === 'reviewed') :
    filter === 'errors'   ? rows.filter(r => r.state === 'failed') :
    filter === 'selected' ? rows.filter(r => selected.includes(r.idx)) :
                            rows;

  const editingRow = editing != null ? CROP_ROWS.find(r => r.idx === editing) : null;
  const hasSelection = selected.length > 0;
  const canAdvance = totals.flagged === 0 || totals.flagged === totals.reviewed;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, marginBottom: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CropBanner state={state} totals={totals} stale={stale} />
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <Button
            variant="primary" size="md" iconRight="arrowR"
            disabled={state === 'running' || !canAdvance}>
            Confirm and advance · {totals.total} pages
          </Button>
          {state !== 'running' && !canAdvance ? (
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
              {totals.flagged - totals.reviewed} flagged pages still need review
            </span>
          ) : null}
        </div>
      </div>

      <CropToolbar filter={filter} density={density} totals={totals} selectedCount={selected.length} />

      {/* Grid */}
      <div style={{
        marginTop: 14,
        display: 'grid',
        gridTemplateColumns: `repeat(${CROP_DENSITY[density].col}, 1fr)`,
        gap: 6,
        padding: 12, borderRadius: 10,
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
      }}>
        {filtered.map((r, i) => (
          <CropCard
            key={r.idx}
            row={r}
            density={density}
            selected={selected.includes(r.idx)}
            hovered={i === 2 && state !== 'running' && !hasSelection && editing == null}
            expanded={editing === r.idx}
          />
        ))}
      </div>

      {editingRow ? <BboxEditor row={editingRow} /> : null}

      {hasSelection ? (
        <CropBulkBar
          count={selected.length}
          flagSummary="3 over-crop · 2 asymmetric · 1 finger"
        />
      ) : null}
    </div>
  );
};

/* ---------------------- CropOverview ---------------------- */
const CropOverview = ({ state = 'review' }) => {
  const totals = state === 'running' ? CROP_TOTALS_RUNNING
              : state === 'done'    ? CROP_TOTALS_DONE
              :                       CROP_TOTALS_REVIEW;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CropBanner state={state} totals={totals} />

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1,
        background: 'var(--border-1)', border: '1px solid var(--border-1)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        {[
          { label: 'pages',     value: totals.total,       tone: 'ink-1' },
          { label: 'cropped',   value: `${totals.cropped}/${totals.total}`, tone: state === 'running' ? 'ocr' : 'exact' },
          { label: 'clean',     value: totals.clean,       tone: 'exact' },
          { label: 'flagged',   value: totals.flagged,     tone: totals.flagged > 0 ? 'fuzzy' : 'ink-2', sub: totals.flagged > 0 ? 'needs review' : 'all reviewed' },
          { label: 'errors',    value: totals.errors,      tone: totals.errors > 0 ? 'mismatch' : 'ink-2' },
          { label: 'avg margin', value: totals.avgMargin,  tone: 'ink-1', sub: 'of source' },
        ].map((stat, i) => (
          <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}>
            <div className="label" style={{ color: 'var(--ink-3)' }}>{stat.label}</div>
            <div className="mono" style={{
              marginTop: 6, fontSize: 18, fontWeight: 600,
              color: `var(--${stat.tone})`,
              letterSpacing: '-0.01em',
            }}>{stat.value}</div>
            {stat.sub ? (
              <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{stat.sub}</div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Flag distribution */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
        padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Flag distribution</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>
              Issues found across {totals.cropped} cropped pages
            </div>
          </div>
          <Button variant="ghost" size="sm" icon="eye">Open Pages</Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(CROP_FLAG_COUNTS).map(([k, n]) => {
            const f = CROP_FLAGS[k];
            const max = Math.max(...Object.values(CROP_FLAG_COUNTS));
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 40px', gap: 12, alignItems: 'center' }}>
                <FlagChip kind={k} size="md" />
                <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: f.tone, opacity: .85 }} />
                </div>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', textAlign: 'right' }}>{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent activity */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-1)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</div>
        </div>
        {[
          ['8 min ago',  'Auto-crop run completed',    '387 pages · 31 flagged'],
          ['8 min ago',  'Stage started',              'edge-detect · margin slack 8px'],
          ['11 min ago', 'Settings changed',           'symmetry guard: off → on'],
          ['12 min ago', 'Grayscale stage confirmed',  '387 pages forwarded'],
        ].map((row, i) => (
          <div key={i} style={{
            padding: '10px 16px',
            borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
            display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 12, alignItems: 'center',
          }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{row[0]}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>{row[1]}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{row[2]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---------------------- CropStepSettings ----------------------
   Preset-aware. Same shape as SourceStepSettings: inheritance banner +
   preset row + setting cards. Adds a stale-bump warning when state='modified'.
*/
const CropStepSettings = ({ state = 'default' }) => {
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert',
    label: 'Modified · 3 changes vs project default',
    sub: 'Save these as the project default, or revert to inherit.',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles',
    label: 'Using preset · Aggressive trim (newsprint)',
    sub: 'Loaded from a saved preset; not the project default.',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle',
    label: 'Using project default · Standard edge-detect',
    sub: 'Changes here can be saved back as the project default for Crop.',
  };

  // Pick strategy by state.
  const strategyIdx = state === 'preset' ? 1 : state === 'modified' ? 2 : 0;
  // Pick slack value by state.
  const slack = state === 'modified' ? 16 : state === 'preset' ? 4 : 8;
  const minArea = state === 'modified' ? 65 : 70;

  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Rough crop</h2>
        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
          Auto-crop strategy, margin guards, and how the worker decides what to flag for review.
        </div>
      </div>

      {/* Inheritance banner */}
      <div style={{
        borderRadius: 8,
        border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))',
        background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))',
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6,
          background: 'color-mix(in oklab, ' + banner.tone + ' 18%, var(--bg-surface))',
          color: banner.tone, display: 'grid', placeItems: 'center', flex: '0 0 auto',
        }}>
          <Icon name={banner.icon} size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{banner.label}</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{banner.sub}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {state === 'modified' ? (
            <>
              <Button variant="ghost" size="sm" icon="refresh">Revert</Button>
              <Button variant="primary" size="sm" icon="check">Save as project default</Button>
            </>
          ) : state === 'preset' ? (
            <Button variant="default" size="sm" icon="refresh">Reset to project default</Button>
          ) : null}
        </div>
      </div>

      {/* Stale-bump warning (modified state) */}
      {state === 'modified' ? (
        <div style={{
          borderRadius: 8,
          border: '1px dashed color-mix(in oklab, var(--fuzzy) 50%, transparent)',
          background: 'color-mix(in oklab, var(--fuzzy) 5%, var(--bg-surface))',
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Icon name="alert" size={14} style={{ color: 'var(--fuzzy)' }} />
          <span style={{ fontSize: 12, color: 'var(--ink-1)' }}>
            Saving will mark Crop and <span className="mono" style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>22 downstream stages</span> as stale.
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" iconRight="arrowR">See affected stages</Button>
        </div>
      ) : null}

      {/* Preset row */}
      <div style={{
        padding: '10px 14px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Icon name="sparkles" size={14} style={{ color: 'var(--ink-3)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500 }}>Preset</span>
        <div style={{
          flex: 1, maxWidth: 320, height: 28, padding: '0 10px',
          background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>
            {state === 'preset' ? 'Aggressive trim (newsprint)' :
             state === 'modified' ? 'Edge-detect (modified)' :
             'Standard edge-detect (built-in)'}
          </span>
          <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
        </div>
        <Button variant="default" size="sm" icon="plus">Save as preset…</Button>
        <span style={{ flex: 1 }} />
        <a style={{
          fontSize: 11.5, color: 'var(--ink-3)', textDecoration: 'none', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          Manage presets <Icon name="arrowR" size={11} />
        </a>
      </div>

      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
        overflow: 'hidden',
      }}>
        {/* Strategy */}
        <div style={{
          display: 'grid', gridTemplateColumns: '240px 1fr',
          gap: 12, padding: '14px 16px', alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Auto-crop strategy</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>
              How the worker picks the bbox per page
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'edge',   name: 'Edge-detect',     sub: 'Sobel + RANSAC fit' },
              { id: 'ml',     name: 'ML model',        sub: 'page-segment v3' },
              { id: 'manual', name: 'Manual margins',  sub: 'Fixed t/r/b/l' },
              { id: 'source', name: 'From source bbox', sub: 'Reuse Source stage crop' },
            ].map((opt, i) => {
              const a = i === strategyIdx;
              return (
                <div key={opt.id} style={{
                  minWidth: 150, flex: 1,
                  padding: '8px 12px', borderRadius: 7,
                  background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)',
                  border: '1px solid ' + (a ? 'var(--accent)' : 'var(--border-1)'),
                  cursor: 'pointer',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{opt.name}</div>
                  <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)' }}>{opt.sub}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Margin slack */}
        <div style={{
          display: 'grid', gridTemplateColumns: '240px 1fr',
          gap: 12, padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--border-1)',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Margin slack</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Extra padding the worker keeps around detected page edges</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 360 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>0</span>
            <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}>
              <div style={{ width: `${(slack / 40) * 100}%`, height: '100%', borderRadius: 99, background: 'var(--accent)' }} />
              <div style={{
                position: 'absolute', left: `calc(${(slack / 40) * 100}% - 7px)`, top: -5,
                width: 14, height: 14, borderRadius: 99,
                background: 'var(--bg-surface)', border: '2px solid var(--accent)',
              }} />
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>40</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 36, textAlign: 'right' }}>{slack}px</span>
          </div>
        </div>

        {/* Symmetry guard */}
        <div style={{
          display: 'grid', gridTemplateColumns: '240px 1fr 36px',
          gap: 12, padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--border-1)',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Symmetry guard</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Flag pages where opposing margins differ by &gt; 12%</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            Useful for spreads where the gutter eats one side.
          </div>
          <Toggle on={state === 'preset' || state === 'modified'} />
        </div>

        {/* Min page area */}
        <div style={{
          display: 'grid', gridTemplateColumns: '240px 1fr',
          gap: 12, padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--border-1)',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Min page area</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Pages below this trigger an overflow flag</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 360 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>50%</span>
            <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}>
              <div style={{ width: `${((minArea - 50) / 45) * 100}%`, height: '100%', borderRadius: 99, background: 'var(--accent)' }} />
              <div style={{
                position: 'absolute', left: `calc(${((minArea - 50) / 45) * 100}% - 7px)`, top: -5,
                width: 14, height: 14, borderRadius: 99,
                background: 'var(--bg-surface)', border: '2px solid var(--accent)',
              }} />
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>95%</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 36, textAlign: 'right' }}>{minArea}%</span>
          </div>
        </div>

        {/* Auto-accept on green */}
        <div style={{
          display: 'grid', gridTemplateColumns: '240px 1fr 36px',
          gap: 12, padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--border-1)',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Auto-accept on green</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Pages that clear every check skip the review step</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            Flagged pages still wait for you.
          </div>
          <Toggle on={state !== 'modified'} />
        </div>

        {/* Re-deskew after crop */}
        <div style={{
          display: 'grid', gridTemplateColumns: '240px 1fr 36px',
          gap: 12, padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--border-1)',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Re-deskew after crop</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Tiny rotation pass so downstream stages get true rectangles</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            Adds ~0.2s per page.
          </div>
          <Toggle on={true} />
        </div>

        {/* Re-run all */}
        <div style={{
          display: 'grid', gridTemplateColumns: '240px 1fr',
          gap: 12, padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--border-1)',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Re-run crop</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Clears current bboxes and re-runs with the settings above</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="default" size="sm" icon="refresh">Re-crop all 387</Button>
            <Button variant="ghost" size="sm" icon="refresh">Re-crop flagged only · 31</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  CroppedThumb, FlagChip, StatusDot, CropCard,
  CropBanner, CropToolbar, CropBulkBar, BboxEditor,
  CropPages, CropOverview, CropStepSettings,
});
