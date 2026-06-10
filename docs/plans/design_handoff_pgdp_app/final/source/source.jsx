// source.jsx — Source-stage content components.
// SourceFiles (states A and B), SourceMetadata, SourceOverview,
// SourceStepSettings, plus shared thumb-card / filter-chip / bulk-action /
// insert-dialog primitives.

const { useState: useS, useMemo: useM } = React;

/* ---------------------- FakeThumb ----------------------
   Stand-in for a real page scan: a paper-toned rectangle with a few
   horizontal "ink" lines so it reads as a printed page. tone controls
   paper color; hue adds a faint cover-accent.
*/
const FakeThumb = ({ tone = 'light', hue, width = 120, height = 156, kind }) => {
  const paper =
    tone === 'dark'  ? 'oklch(0.72 0.02 80)'
    : tone === 'mid' ? 'oklch(0.86 0.02 80)'
    :                  'oklch(0.95 0.012 85)';
  const ink = 'oklch(0.34 0.02 60)';
  return (
    <div style={{
      width, height, borderRadius: 3,
      background: paper,
      boxShadow: 'inset 0 0 0 1px rgba(40,30,20,0.15)',
      position: 'relative', overflow: 'hidden',
      backgroundImage: hue != null
        ? `linear-gradient(160deg, oklch(0.55 0.10 ${hue}) 0%, ${paper} 80%)`
        : 'none',
    }}>
      {/* Faint ink lines mimicking a printed page */}
      {!hue && kind !== 'blank' ? (
        <div style={{
          position: 'absolute', inset: '14% 12% 14% 12%',
          backgroundImage: `repeating-linear-gradient(
            to bottom,
            ${ink} 0 1.5px,
            transparent 1.5px 7px
          )`,
          opacity: 0.7,
        }} />
      ) : null}
      {kind === 'blank' ? (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: 'var(--ink-4)', fontSize: 10, fontFamily: 'var(--mono-font)',
          letterSpacing: '.08em', textTransform: 'uppercase',
        }}>blank</div>
      ) : null}
    </div>
  );
};

const SkeletonThumb = ({ width = 120, height = 156 }) => (
  <div style={{
    width, height, borderRadius: 3,
    background: 'var(--bg-raised)',
    border: '1px solid var(--border-1)',
    position: 'relative', overflow: 'hidden',
  }}>
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--ink-4) 18%, transparent) 50%, transparent 100%)',
      backgroundSize: '200% 100%',
      animation: 'pgd-shimmer 1.6s linear infinite',
    }} />
    <div style={{
      position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
      width: 16, height: 16, borderRadius: 99,
      border: '2px solid var(--border-2)', borderTopColor: 'var(--ocr)',
      animation: 'pgd-spin 1.1s linear infinite',
    }} />
  </div>
);

const InsertedThumb = ({ width = 120, height = 156 }) => (
  <div style={{
    width, height, borderRadius: 3,
    background: 'color-mix(in oklab, var(--accent) 6%, var(--bg-surface))',
    border: '1.5px dashed color-mix(in oklab, var(--accent) 55%, var(--border-2))',
    display: 'grid', placeItems: 'center',
    color: 'var(--accent)',
  }}>
    <Icon name="plus" size={20} stroke={1.6} />
  </div>
);

/* ---------------------- Tag chip + kind copy ---------------------- */
const STATE_LABEL = {
  page:      { label: 'page',      tone: 'var(--exact)'    },
  cover:     { label: 'cover',     tone: 'var(--gt)'       },
  back:      { label: 'back',      tone: 'var(--gt)'       },
  blank:     { label: 'blank',     tone: 'var(--ink-3)'    },
  duplicate: { label: 'dup',       tone: 'var(--mismatch)' },
  inserted:  { label: 'insert',    tone: 'var(--accent)'   },
};

const KIND_LABEL = {
  missing: 'Missing',
  blank:   'Blank',
  errata:  'Errata',
  manual:  'Manual',
};

const TagChip = ({ state, large }) => {
  const def = STATE_LABEL[state];
  if (!def) return null;
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: large ? 20 : 17, padding: large ? '0 7px' : '0 6px',
      borderRadius: 99, fontSize: large ? 10.5 : 9.5, fontWeight: 600,
      background: `color-mix(in oklab, ${def.tone} 14%, var(--bg-surface))`,
      color: def.tone,
      border: `1px solid color-mix(in oklab, ${def.tone} 40%, transparent)`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: def.tone }} />
      {def.label}
    </span>
  );
};

/* ---------------------- Thumb card ----------------------
   Single grid cell. Different chrome per state. Hover shows checkbox top-left,
   kebab top-right; selected adds an accent border. inserted dashed-border
   variant uses the "+" placeholder.
*/
const ThumbCard = ({ file, density = 'M', selected, hovered, onInsertBetween, isLast }) => {
  const dims = density === 'S' ? { w: 90, h: 118, fs: 10 }
            : density === 'L' ? { w: 160, h: 208, fs: 12 }
            :                   { w: 124, h: 162, fs: 11 };
  const isInserted = file.state === 'inserted';
  const isPending  = file.state === 'pending';
  const showTag    = !isPending && file.state !== 'ready';
  return (
    <div style={{
      position: 'relative',
      width: dims.w,
      padding: 4, borderRadius: 6,
      background: selected ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'transparent',
      border: '1.5px solid ' + (
        selected      ? 'var(--accent)'
      : isInserted    ? 'transparent'
      : hovered       ? 'var(--border-3)'
      :                 'transparent'),
      transition: 'border-color .12s, background .12s',
    }}>
      {/* Thumb */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {isPending  ? <SkeletonThumb width={dims.w - 8} height={dims.h - 36} /> :
         isInserted ? <InsertedThumb width={dims.w - 8} height={dims.h - 36} /> :
         <FakeThumb width={dims.w - 8} height={dims.h - 36} tone={file.tone} hue={file.hue} kind={file.state === 'blank' ? 'blank' : null} />}
        {/* checkbox top-left */}
        {!isPending ? (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            width: 18, height: 18, borderRadius: 4,
            background: selected ? 'var(--accent)' : 'rgba(245,240,230,0.92)',
            border: '1.5px solid ' + (selected ? 'var(--accent)' : 'rgba(40,30,20,0.35)'),
            display: 'grid', placeItems: 'center',
            color: selected ? 'var(--accent-ink)' : 'transparent',
          }}>
            <Icon name="check" size={11} stroke={3} />
          </div>
        ) : null}
        {/* page-number badge bottom-left for body pages, "+" for inserted */}
        {file.pageNumber != null ? (
          <div style={{
            position: 'absolute', bottom: 6, left: 6,
            height: 18, padding: '0 6px', borderRadius: 4,
            background: 'rgba(40,30,20,0.78)', color: '#fff',
            fontSize: 10, fontFamily: 'var(--mono-font)', fontWeight: 600,
            display: 'inline-flex', alignItems: 'center',
          }}>{file.pageNumber}</div>
        ) : null}
        {isInserted ? (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            width: 18, height: 18, borderRadius: 99,
            background: 'var(--accent)', color: 'var(--accent-ink)',
            display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700,
          }}>+</div>
        ) : null}
        {/* tag chip top-right */}
        {showTag ? (
          <div style={{ position: 'absolute', top: 6, right: 6 }}>
            <TagChip state={file.state} />
          </div>
        ) : null}
      </div>

      {/* Filename / kind label */}
      <div style={{ marginTop: 5, height: 18, display: 'flex', alignItems: 'center', gap: 4 }}>
        {isInserted ? (
          <span className="mono" style={{
            fontSize: dims.fs - 0.5, color: 'var(--accent)', fontWeight: 600,
            letterSpacing: '.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {KIND_LABEL[file.kind] || 'Insert'} · inserted
          </span>
        ) : (
          <span className="mono" style={{
            fontSize: dims.fs, color: 'var(--ink-3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{file.stem}</span>
        )}
      </div>
    </div>
  );
};

/* ---------------------- Insert divider ----------------------
   Thin "+ Insert page here" affordance between two thumb cards. Static for
   the canvas — appears between every pair so the design is visible.
*/
const InsertDivider = ({ visible = false }) => (
  <div style={{
    width: 18, alignSelf: 'stretch',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', position: 'relative',
    opacity: visible ? 1 : 0,
    transition: 'opacity .12s',
  }}>
    <div style={{
      width: 2, height: '70%', borderRadius: 99,
      background: 'color-mix(in oklab, var(--accent) 60%, transparent)',
    }} />
    <div style={{
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 18, height: 18, borderRadius: 99,
      background: 'var(--accent)', color: 'var(--accent-ink)',
      display: 'grid', placeItems: 'center',
    }}>
      <Icon name="plus" size={11} stroke={2.5} />
    </div>
  </div>
);

/* ---------------------- Banner ---------------------- */
const SourceBanner = ({ state, totals }) => {
  if (state === 'generating') {
    const pct = Math.round((totals.thumbed / totals.files) * 100);
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
            Generating thumbnails…
          </div>
          <div className="mono" style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>
            {totals.thumbed} / {totals.files} · {totals.rateHz}/s · ~{Math.ceil(totals.remaining / totals.rateHz)}s remaining
          </div>
          <div style={{
            marginTop: 8, height: 4, borderRadius: 99,
            background: 'color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))',
            overflow: 'hidden',
          }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ocr)' }} />
          </div>
        </div>
        <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ocr)', flex: '0 0 auto' }}>
          {pct}%
        </span>
      </div>
    );
  }
  // selection state
  const m = totals.marked;
  const tone = totals.unmarked > 0 ? 'var(--fuzzy)' : 'var(--exact)';
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
            <Icon name={totals.unmarked > 0 ? 'alert' : 'checkCircle'} size={15} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
              {totals.files} files · {m.page} marked as pages
              {totals.unmarked > 0 ? <> · <span style={{ color: tone }}>{totals.unmarked} unmarked</span></> : null}
            </div>
            <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
              {totals.unmarked > 0
                ? 'Mark every file as page / cover / back / blank / duplicate before confirming.'
                : 'All files reviewed. Confirm to advance the pipeline.'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                ['page',  m.page,  'var(--exact)'],
                ['cover', m.cover, 'var(--gt)'],
                ['back',  m.back,  'var(--gt)'],
                ['blank', m.blank, 'var(--ink-3)'],
                ['dup',   m.duplicate, 'var(--mismatch)'],
                ['insert', m.inserted, 'var(--accent)'],
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
      </div>
    </div>
  );
};

/* ---------------------- Filter + density toolbar ---------------------- */
const FileToolbar = ({ filter = 'all', density = 'M', totals }) => {
  const m = totals.marked;
  const chips = [
    { id: 'all',     name: 'All',          count: totals.files },
    { id: 'page',    name: 'Marked as page', count: m.page,        dot: 'var(--exact)' },
    { id: 'skipped', name: 'Skipped',     count: m.cover + m.back + m.blank + m.duplicate, dot: 'var(--gt)' },
    { id: 'unmarked', name: 'Unmarked',     count: totals.unmarked, dot: 'var(--fuzzy)' },
    { id: 'inserts', name: 'Inserts',      count: m.inserted,    dot: 'var(--accent)' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised)', borderRadius: 8, border: '1px solid var(--border-1)' }}>
        {chips.map(f => {
          const active = filter === f.id;
          return (
            <div key={f.id} style={{
              padding: '5px 10px', borderRadius: 6,
              background: active ? 'var(--bg-surface)' : 'transparent',
              boxShadow: active ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 7,
              color: active ? 'var(--ink-1)' : 'var(--ink-3)', fontSize: 12.5, fontWeight: active ? 600 : 500,
              cursor: 'pointer',
            }}>
              {f.dot ? <span style={{ width: 6, height: 6, borderRadius: 99, background: f.dot }} /> : null}
              {f.name}
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span>
            </div>
          );
        })}
      </div>
      <Divider vertical style={{ height: 22 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-3)' }}>
        <Icon name="search" size={13} />
        <span>Search files…</span>
        <KeyCap>/</KeyCap>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="default" size="sm" icon="plus">Insert page</Button>
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

/* ---------------------- Bulk-action sticky bar ---------------------- */
const BulkBar = ({ count }) => (
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
    <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    <span style={{ fontSize: 12, color: 'color-mix(in oklab, var(--bg-page) 65%, transparent)' }}>Mark as</span>
    {[
      { id: 'page',  name: 'Page',  dot: 'var(--exact)' },
      { id: 'cover', name: 'Cover', dot: 'var(--gt)' },
      { id: 'back',  name: 'Back',  dot: 'var(--gt)' },
      { id: 'blank', name: 'Blank', dot: 'var(--ink-3)' },
      { id: 'dup',   name: 'Duplicate', dot: 'var(--mismatch)' },
    ].map(b => (
      <button key={b.id} style={{
        height: 26, padding: '0 9px', borderRadius: 6,
        background: 'color-mix(in oklab, var(--bg-page) 12%, transparent)',
        border: '1px solid color-mix(in oklab, var(--bg-page) 22%, transparent)',
        color: 'var(--bg-page)', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: b.dot }} />
        {b.name}
      </button>
    ))}
    <div style={{ width: 1, height: 18, background: 'color-mix(in oklab, var(--bg-page) 25%, transparent)' }} />
    <button style={{
      height: 26, padding: '0 10px', borderRadius: 6,
      background: 'transparent',
      border: '1px solid color-mix(in oklab, var(--mismatch) 75%, transparent)',
      color: 'color-mix(in oklab, var(--mismatch) 70%, var(--bg-page))',
      cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <Icon name="trash" size={11} />
      Remove from project
    </button>
    <span style={{ flex: 1 }} />
    <span className="mono" style={{ fontSize: 10.5, color: 'color-mix(in oklab, var(--bg-page) 55%, transparent)' }}>
      <KeyCap>esc</KeyCap> clear · <KeyCap>⇧</KeyCap>+click range
    </span>
  </div>
);

/* ---------------------- Insert dialog ---------------------- */
const InsertDialog = ({ anchor = 'belloc_0006.jp2' }) => (
  <div style={{
    position: 'absolute', inset: 0, zIndex: 20,
    background: 'rgba(20,14,8,0.40)', backdropFilter: 'blur(2px)',
    display: 'grid', placeItems: 'center',
  }}>
    <div style={{
      width: 480, background: 'var(--bg-surface)',
      border: '1px solid var(--border-1)', borderRadius: 10,
      boxShadow: '0 24px 64px rgba(15,23,42,.30), 0 2px 8px rgba(15,23,42,.12)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid var(--border-1)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>Insert page</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>
            Synthetic page that participates in numbering and downstream stages.
          </div>
        </div>
        <button style={{ width: 24, height: 24, background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--ink-3)', display: 'grid', placeItems: 'center' }}>
          <Icon name="x" size={13} />
        </button>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Position */}
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>Position</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              display: 'inline-flex', padding: 3, background: 'var(--bg-raised)',
              border: '1px solid var(--border-1)', borderRadius: 7,
            }}>
              {['Before', 'After'].map((v, i) => {
                const a = i === 1;
                return (
                  <div key={v} style={{
                    padding: '4px 10px', borderRadius: 5,
                    background: a ? 'var(--bg-surface)' : 'transparent',
                    boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
                    color: a ? 'var(--ink-1)' : 'var(--ink-3)',
                    fontSize: 12, fontWeight: a ? 600 : 500, cursor: 'pointer',
                  }}>{v}</div>
                );
              })}
            </div>
            <div style={{
              flex: 1, height: 30, padding: '0 10px',
              background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Icon name="file" size={12} style={{ color: 'var(--ink-4)' }} />
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)' }}>{anchor}</span>
              <span style={{ flex: 1 }} />
              <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
            </div>
          </div>
        </div>
        {/* Kind */}
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>Kind</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'missing', name: 'Missing',  desc: 'Page absent from scan' },
              { id: 'blank',   name: 'Blank',    desc: 'Intentional blank' },
              { id: 'errata',  name: 'Errata',   desc: 'Correction sheet' },
              { id: 'manual',  name: 'Manual',   desc: 'Typed transcription' },
            ].map((k, i) => {
              const a = i === 0;
              return (
                <div key={k.id} style={{
                  flex: 1, minWidth: 100,
                  padding: '8px 10px', borderRadius: 7,
                  background: a ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-surface)',
                  border: '1px solid ' + (a ? 'var(--accent)' : 'var(--border-1)'),
                  cursor: 'pointer',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: a ? 'var(--accent)' : 'var(--ink-1)' }}>{k.name}</div>
                  <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)' }}>{k.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Note */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>Note <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>· optional</span></div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)', fontFamily: 'var(--mono-font)' }}>0 / 280</div>
          </div>
          <div style={{
            background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6,
            padding: 10, fontSize: 12, color: 'var(--ink-4)', minHeight: 56,
          }}>
            Missing page 3 from scan — sourced from another copy.
          </div>
        </div>
        {/* Replacement image */}
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
            Replacement image <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>· optional</span>
          </div>
          <div style={{
            padding: 12, borderRadius: 7,
            border: '1.5px dashed var(--border-2)',
            background: 'var(--bg-sunk)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 7,
              background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
              display: 'grid', placeItems: 'center', color: 'var(--ink-3)', flex: '0 0 auto',
            }}>
              <Icon name="image" size={14} />
            </div>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-3)' }}>
              Drop a JP2 / PNG / JPG here, or <span style={{ color: 'var(--ink-1)', textDecoration: 'underline', cursor: 'pointer' }}>browse</span>.
              <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-4)' }}>Skip to use the dashed placeholder thumb.</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{
        padding: '12px 18px', borderTop: '1px solid var(--border-1)',
        background: 'var(--bg-page)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
      }}>
        <Button variant="ghost" size="md">Cancel</Button>
        <Button variant="primary" size="md" icon="plus">Insert page</Button>
      </div>
    </div>
  </div>
);

/* ---------------------- SourceFiles ----------------------
   Tab content. state="generating" shows skeleton-heavy grid + progress
   banner. state="selection" shows the marking UX with filter + density +
   bulk bar. dialog=true overlays the insert dialog.
*/
const SourceFiles = ({
  state = 'selection',
  density = 'M',
  selected = [],
  filter = 'all',
  dialog = false,
  showInsertDivider = false,
}) => {
  const totals = state === 'generating' ? SOURCE_TOTALS : SOURCE_TOTALS_DONE;
  // For the generating state, force most files to pending.
  const files = state === 'generating'
    ? SOURCE_FILES.map((f, i) => i < 4 ? f : { ...f, state: 'pending', pageNumber: undefined, kind: undefined })
    : SOURCE_FILES;
  // For 'skipped' filter, show only marked-as-skipped (not body pages).
  // For 'inserts', only inserted. For 'unmarked', the `ready` state. Otherwise all.
  const filtered = filter === 'skipped' ? files.filter(f => ['cover','back','blank','duplicate'].includes(f.state))
                : filter === 'page'    ? files.filter(f => f.state === 'page')
                : filter === 'inserts' ? files.filter(f => f.state === 'inserted')
                : filter === 'unmarked' ? files.filter(f => f.state === 'ready')
                : files;
  const hasSelection = selected.length > 0;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, padding: '20px 28px 28px' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, marginBottom: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SourceBanner state={state} totals={totals} />
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <Button
            variant="primary" size="md" iconRight="arrowR"
            disabled={state === 'generating' || totals.unmarked > 0}>
            Confirm selection · {totals.marked.page} pages
          </Button>
          {totals.unmarked > 0 ? (
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
              {totals.unmarked} unmarked
            </span>
          ) : null}
        </div>
      </div>

      <FileToolbar filter={filter} density={density} totals={totals} />

      {/* Grid */}
      <div style={{
        marginTop: 14,
        display: 'flex', flexWrap: 'wrap', gap: 4,
        padding: 12, borderRadius: 10,
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
      }}>
        {filtered.map((f, i) => (
          <React.Fragment key={f.stem + i}>
            <ThumbCard
              file={f}
              density={density}
              selected={selected.includes(f.idx)}
              hovered={i === 4 && state === 'selection' && !hasSelection}
            />
            {i < filtered.length - 1 ? <InsertDivider visible={showInsertDivider && i === 5} /> : null}
          </React.Fragment>
        ))}
      </div>

      {hasSelection ? <BulkBar count={selected.length} /> : null}

      {dialog ? <InsertDialog /> : null}
    </div>
  );
};

/* ---------------------- SourceOverview ---------------------- */
const SourceOverview = ({ state = 'selection' }) => {
  const totals = state === 'generating' ? SOURCE_TOTALS : SOURCE_TOTALS_DONE;
  return (
    <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SourceBanner state={state} totals={totals} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { label: 'files',      value: totals.files,                tone: 'ink-1' },
          { label: 'thumbnails', value: `${totals.thumbed}/${totals.files}`, tone: state === 'generating' ? 'ocr' : 'exact' },
          { label: 'pages',      value: totals.marked.page,          tone: 'exact', sub: 'in this project' },
          { label: 'skipped',    value: totals.marked.cover + totals.marked.back + totals.marked.blank + totals.marked.duplicate, tone: 'gt', sub: 'not in proofing' },
          { label: 'inserts',    value: totals.marked.inserted,      tone: 'accent' },
          { label: 'unmarked',   value: totals.unmarked,             tone: totals.unmarked > 0 ? 'fuzzy' : 'ink-2', sub: totals.unmarked > 0 ? 'needs review' : 'all reviewed' },
        ].map((stat, i) => (
          <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}>
            <div className="label" style={{ color: 'var(--ink-3)' }}>{stat.label}</div>
            <div className="mono" style={{
              marginTop: 6, fontSize: 18, fontWeight: 600,
              color: `var(--${stat.tone === 'accent' ? 'accent' : stat.tone})`,
              letterSpacing: '-0.01em',
            }}>{stat.value}</div>
            {stat.sub ? (
              <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{stat.sub}</div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{
        padding: '14px 16px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
            {state === 'generating' ? 'Waiting for thumbnails…' : 'Review page selection'}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
            Open the Files tab to mark covers and inserts. Confirm to advance.
          </div>
        </div>
        <Button variant="default" size="md" icon="file" iconRight="arrowR">Open Files</Button>
      </div>
    </div>
  );
};

/* ---------------------- SourceMetadata ---------------------- */
const SourceMetadata = () => {
  // Reuse the AttributesPanel from final/projects/projects.jsx — same data
  // shape (it takes a `selected` project).
  const fake = {
    title: 'Survivals and New Arrivals',
    author: 'Hilaire Belloc',
    id: 'belloc-survivals',
  };
  return (
    <div style={{ padding: '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Metadata</h2>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
            Pre-filled from Internet Archive · <span className="mono">bellocsurvivials00bell</span>. Editing here flows into the PGDP submission.
          </div>
        </div>
        <Badge tone="clean" mono>matched · ia</Badge>
      </div>
      <AttributesPanel selected={fake} />
    </div>
  );
};

/* ---------------------- SourceStepSettings ---------------------- */
const SourceStepSettings = ({ state = 'default' }) => {
  // state: 'default' (clean, inheriting project default)
  //        'modified' (user has unsaved changes vs project default)
  //        'preset' (using a saved preset, not project default)
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert',
    label: 'Modified · 2 changes vs project default',
    sub: 'Save these as the project default, or revert to inherit.',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles',
    label: 'Using preset · IA / JP2 archive scans',
    sub: 'Loaded from a saved preset; not the project default.',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle',
    label: 'Using project default · Standard quality preset',
    sub: 'Changes here can be saved back as the project default for Source.',
  };
  return (
  <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.01em' }}>Stage settings · Source</h2>
      <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
        Thumbnail quality, worker concurrency, and auto-confirm behaviour for this stage.
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

    {/* Presets row */}
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
          {state === 'preset' ? 'IA / JP2 archive scans' : 'Standard quality (built-in)'}
        </span>
        <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
      </div>
      <Button variant="default" size="sm" icon="plus">Save as preset…</Button>
      <span style={{ flex: 1 }} />
      <a style={{ fontSize: 11.5, color: 'var(--ink-3)', textDecoration: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Manage presets <Icon name="arrowR" size={11} />
      </a>
    </div>

    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Thumbnail quality */}
      <div style={{
        display: 'grid', gridTemplateColumns: '220px 1fr',
        gap: 12, padding: '14px 16px', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Thumbnail quality</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>
            Higher quality → larger cache + slower generation
          </div>
        </div>
        <div style={{
          display: 'inline-flex', padding: 3, background: 'var(--bg-raised)',
          border: '1px solid var(--border-1)', borderRadius: 7, alignSelf: 'flex-start',
        }}>
          {['Fast', 'Standard', 'High'].map((v, i) => {
            const a = state === 'modified' ? i === 2 : i === 1;
            return (
              <div key={v} style={{
                padding: '4px 12px', borderRadius: 5,
                background: a ? 'var(--bg-surface)' : 'transparent',
                boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
                color: a ? 'var(--ink-1)' : 'var(--ink-3)',
                fontSize: 12, fontWeight: a ? 600 : 500, cursor: 'pointer',
              }}>{v}</div>
            );
          })}
        </div>
      </div>
      {/* Workers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '220px 1fr',
        gap: 12, padding: '14px 16px', alignItems: 'center',
        borderTop: '1px solid var(--border-1)',
      }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Concurrent workers</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>How many thumbnails to generate at once</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 320 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>1</span>
          <div style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg-sunk)', position: 'relative' }}>
            <div style={{ width: '42%', height: '100%', borderRadius: 99, background: 'var(--accent)' }} />
            <div style={{
              position: 'absolute', left: 'calc(42% - 7px)', top: -5,
              width: 14, height: 14, borderRadius: 99,
              background: 'var(--bg-surface)', border: '2px solid var(--accent)',
            }} />
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>8</span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', minWidth: 24, textAlign: 'right' }}>4</span>
        </div>
      </div>
      {/* Re-generate */}
      <div style={{
        display: 'grid', gridTemplateColumns: '220px 1fr',
        gap: 12, padding: '14px 16px', alignItems: 'center',
        borderTop: '1px solid var(--border-1)',
      }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Re-generate thumbnails</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Clears the cache and runs again at current quality</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Button variant="default" size="sm" icon="refresh">Re-generate all 387</Button>
        </div>
      </div>
      {/* Auto-confirm */}
      <div style={{
        display: 'grid', gridTemplateColumns: '220px 1fr 36px',
        gap: 12, padding: '14px 16px', alignItems: 'center',
        borderTop: '1px solid var(--border-1)',
      }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>Auto-confirm selection</div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>Skip manual confirmation once selection is mostly done</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
          When fewer than <span className="mono" style={{ color: 'var(--ink-1)', fontWeight: 600 }}>5%</span> of files remain unmarked
        </div>
        <span style={{
          width: 30, height: 18, borderRadius: 99,
          background: 'var(--border-2)', position: 'relative', cursor: 'pointer',
        }}>
          <span style={{
            position: 'absolute', top: 2, left: 2,
            width: 14, height: 14, borderRadius: 99, background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,.15)',
          }} />
        </span>
      </div>
    </div>
  </div>
  );
};

Object.assign(window, {
  SourceFiles, SourceMetadata, SourceOverview, SourceStepSettings,
  ThumbCard, FakeThumb, InsertedThumb, SkeletonThumb,
  TagChip, BulkBar, FileToolbar, SourceBanner, InsertDialog, InsertDivider,
});

/* ====================================================================
   SourcePageWorkbench — per-page deep dive for the Source stage.
   Tabs: workbench (this) vs settings (the project-wide SourceStepSettings).
   Two-pane layout: stage controls drawer (left) + page viewer (right).
==================================================================== */

const SOURCE_ROLES = [
  { id: 'cover',    label: 'Cover',    tone: 'var(--ocr)',    icon: 'image' },
  { id: 'page',     label: 'Body',     tone: 'var(--exact)',  icon: 'file' },
  { id: 'blank',    label: 'Blank',    tone: 'var(--ink-3)',  icon: 'file' },
  { id: 'inserted', label: 'Insert',   tone: 'var(--fuzzy)',  icon: 'plus' },
  { id: 'skip',     label: 'Skip',     tone: 'var(--mismatch)', icon: 'x' },
];

const SourceWBSubhead = ({ title, sub, right }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    padding: '18px 28px 0', gap: 14,
  }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.005em' }}>{title}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{sub}</div>
    </div>
    {right ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto' }}>{right}</div> : null}
  </div>
);

const SrcRoleSegment = ({ active = 'page', onChange }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4,
    padding: 3, background: 'var(--bg-page)',
    border: '1px solid var(--border-1)', borderRadius: 7,
  }}>
    {SOURCE_ROLES.map(r => {
      const a = r.id === active;
      return (
        <button key={r.id} style={{
          border: 0, cursor: 'pointer',
          padding: '6px 4px', borderRadius: 5,
          background: a ? 'color-mix(in oklab, ' + r.tone + ' 14%, var(--bg-surface))' : 'transparent',
          color: a ? r.tone : 'var(--ink-3)',
          fontSize: 11, fontWeight: a ? 600 : 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          fontFamily: 'inherit',
          border: a ? '1px solid color-mix(in oklab, ' + r.tone + ' 45%, var(--border-1))' : '1px solid transparent',
        }}>
          <Icon name={r.icon} size={11} />
          {r.label}
        </button>
      );
    })}
  </div>
);

const SrcWBField = ({ label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
        textTransform: 'uppercase', color: 'var(--ink-4)',
      }}>{label}</span>
      {hint ? <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{hint}</span> : null}
    </div>
    {children}
  </div>
);

const SrcWBInput = ({ value, mono, suffix }) => (
  <div style={{
    height: 28, padding: '0 10px',
    background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 6,
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, color: 'var(--ink-1)', fontFamily: mono ? 'var(--mono-font, monospace)' : 'inherit',
  }}>
    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    {suffix ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{suffix}</span> : null}
  </div>
);

const SrcWBSelect = ({ value }) => (
  <div style={{
    height: 28, padding: '0 10px',
    background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 6,
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 12, color: 'var(--ink-1)',
  }}>
    <span style={{ flex: 1 }}>{value}</span>
    <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
  </div>
);

const SourceStageControlsLeft = ({ file = SOURCE_FILES[5], role = 'page' }) => {
  const isInserted = file.state === 'inserted';
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border-1)',
      }}>
        <div style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--ink-4)',
        }}>Page metadata</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>source</span>
          {isInserted ? (
            <Badge tone="dirty">inserted</Badge>
          ) : (
            <Badge tone="clean">ingested</Badge>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        padding: '14px', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <SrcWBField label="Original file" hint="read-only">
          <SrcWBInput value={file.stem} mono suffix={isInserted ? null : '2.4 MB'} />
        </SrcWBField>

        <SrcWBField label="Role" hint="how the rest of the pipeline treats this page">
          <SrcRoleSegment active={role} />
        </SrcWBField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <SrcWBField label="Page number">
            <SrcWBInput value={file.pageNumber || (isInserted ? '—' : '12')} mono />
          </SrcWBField>
          <SrcWBField label="Section">
            <SrcWBSelect value="Body" />
          </SrcWBField>
        </div>

        <SrcWBField label="Rotation" hint="degrees · cw">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {['0°', '90°', '180°', '270°'].map((r, i) => (
              <button key={r} style={{
                border: i === 0
                  ? '1px solid color-mix(in oklab, var(--accent) 45%, var(--border-1))'
                  : '1px solid var(--border-1)',
                background: i === 0
                  ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-surface))'
                  : 'var(--bg-page)',
                color: i === 0 ? 'var(--accent)' : 'var(--ink-2)',
                fontSize: 11.5, fontWeight: i === 0 ? 600 : 500,
                padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
                fontFamily: 'inherit',
              }}>{r}</button>
            ))}
          </div>
        </SrcWBField>

        <SrcWBField label="Tone hint" hint="affects downstream grayscale auto-detect">
          <SrcWBSelect value={file.tone === 'mid' ? 'Mid · faded paper' : 'Light · clean modern'} />
        </SrcWBField>

        {isInserted ? (
          <SrcWBField label="Insert note" hint="why this page is here">
            <div style={{
              padding: '8px 10px',
              background: 'var(--bg-page)', border: '1px solid var(--border-2)', borderRadius: 6,
              fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5,
            }}>{file.note || 'No note.'}</div>
          </SrcWBField>
        ) : null}

        {/* Quick actions */}
        <div style={{
          marginTop: 4, padding: '10px 12px', borderRadius: 7,
          background: 'var(--bg-page)', border: '1px solid var(--border-1)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--ink-4)',
          }}>Actions</span>
          <Button variant="default" size="sm" icon="upload" full>Replace scan…</Button>
          <Button variant="default" size="sm" icon="plus" full>Insert page after this…</Button>
          <Button variant="ghost"   size="sm" icon="trash" full>
            <span style={{ color: 'var(--mismatch)' }}>Remove from project</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

const SrcPagePreview = ({ file = SOURCE_FILES[5] }) => {
  const big = { tone: file.tone || 'light', hue: file.hue, kind: file.state === 'blank' ? 'blank' : undefined };
  const W = 320, H = 420;
  return (
    <div style={{ position: 'relative' }}>
      <FakeThumb {...big} width={W} height={H} />
      <span style={{
        position: 'absolute', top: 8, left: 8,
        padding: '2px 8px', borderRadius: 4,
        background: 'rgba(0,0,0,0.45)', color: '#fff',
        fontFamily: 'var(--mono-font, monospace)', fontSize: 10, fontWeight: 600,
        letterSpacing: '.04em',
      }}>RAW · {file.stem}</span>
    </div>
  );
};

const SourceViewer = ({ file = SOURCE_FILES[5] }) => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
    display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
  }}>
    {/* Toolbar */}
    <div style={{
      padding: '8px 14px', borderBottom: '1px solid var(--border-1)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>
          {file.stem}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>·</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {file.idx + 1} / 387
        </span>
      </div>
      <Divider vertical style={{ height: 18 }} />
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
        2364 × 3568 · JP2 · 2.4 MB
      </span>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" icon="eye">Compare neighbours</Button>
      <Divider vertical style={{ height: 18 }} />
      <Button variant="ghost" size="sm" icon="image">Open externally</Button>
    </div>

    {/* Viewer body */}
    <div style={{
      flex: 1, minHeight: 0, padding: 18,
      background: 'var(--bg-page)',
      display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'flex-start',
      overflow: 'auto',
    }}>
      <SrcPagePreview file={file} />
      {/* File metadata strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
        width: '100%', maxWidth: 720,
      }}>
        {[
          ['Original name', file.stem, true],
          ['Dimensions',    '2364 × 3568 px'],
          ['DPI',           '600 · uniform'],
          ['Ingested',      '12 min ago'],
          ['Checksum',      'sha256:b3f1…',  true],
          ['Bytes',         '2,447,304',     true],
          ['Color profile', 'sRGB · 24-bit'],
          ['Source',        'Internet Archive · ark:/3-23'],
        ].map(([k, v, mono], i) => (
          <div key={k} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 6,
            padding: '8px 10px',
          }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{k}</div>
            <div className={mono ? 'mono' : ''} style={{ marginTop: 3, fontSize: mono ? 11 : 12, color: 'var(--ink-1)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
          </div>
        ))}
      </div>
    </div>

    {/* Page strip */}
    <div style={{
      padding: '10px 14px', borderTop: '1px solid var(--border-1)',
      background: 'var(--bg-surface)',
      display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden',
    }}>
      <Button variant="ghost" size="sm" icon="chevL" />
      <div style={{ flex: 1, display: 'flex', gap: 5, overflow: 'hidden' }}>
        {SOURCE_FILES.slice(0, 14).map((f, i) => {
          const active = f.idx === file.idx;
          const dim = f.state === 'pending';
          return (
            <div key={f.idx} title={f.stem} style={{
              flex: '0 0 auto', position: 'relative',
              outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: 1,
              opacity: dim ? 0.5 : 1, cursor: 'pointer',
            }}>
              <FakeThumb
                tone={f.tone || 'light'}
                hue={f.hue}
                width={28} height={38}
                kind={f.state === 'blank' ? 'blank' : undefined}
              />
            </div>
          );
        })}
      </div>
      <Button variant="ghost" size="sm" iconRight="chevR" />
    </div>
  </div>
);

const SourcePageWorkbench = ({ pageIdx = 5 }) => {
  const file = SOURCE_FILES[pageIdx] || SOURCE_FILES[5];
  return (
    <>
      <SourceWBSubhead
        title="Page workbench · Source"
        sub={<>Per-page metadata for the raw ingested scan. Set the role (cover / body / blank / insert / skip), assigned page number, rotation, and tone hint. Changes save when you <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>Apply &amp; Continue</span>.</>}
        right={
          <>
            <Button variant="ghost" size="sm" icon="chevL">Prev</Button>
            <Button variant="ghost" size="sm" iconRight="chevR">Next</Button>
            <Divider vertical style={{ height: 22 }} />
            <Button variant="primary" size="sm" iconRight="arrowR">Apply &amp; Continue</Button>
          </>
        }
      />
      <div style={{
        padding: '14px 28px 28px', flex: 1, minHeight: 0,
        display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14,
      }}>
        <SourceStageControlsLeft file={file} role={file.state === 'cover' ? 'cover' : file.state === 'blank' ? 'blank' : file.state === 'inserted' ? 'inserted' : 'page'} />
        <SourceViewer file={file} />
      </div>
    </>
  );
};

Object.assign(window, { SourcePageWorkbench });
