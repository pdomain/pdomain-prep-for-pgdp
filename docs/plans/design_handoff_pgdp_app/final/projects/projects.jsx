// projects.jsx — Finalized Projects (load) page components.
// Locked design used by every final/projects board. Pure presentational —
// all data lives in PROJECTS / STATUS. The breadcrumb collapses to a single
// "Projects" crumb since this is the root page.

/* ---------------------- Shared sample data ---------------------- */
// Stage indices align with STAGE_DEFS in wf10/pipeline-shell.jsx (23 stages).
// Status taxonomy: queued / running / review / ready / submitted / error
const PROJECTS = [
  {
    id: 'belloc-survivals',
    title: 'Survivals & New Arrivals',
    author: 'Hilaire Belloc',
    pages: 387, totalStages: 23, currentStage: 22, // submit_check
    status: 'ready',
    updatedRel: '2h ago',
    updatedAbs: 'May 22, 14:08',
    created: 'May 15, 2026',
    size: '28.4 MB',
  },
  {
    id: 'twain-puddnhead',
    title: 'Pudd’nhead Wilson',
    author: 'Mark Twain',
    pages: 218, totalStages: 23, currentStage: 10, // ocr
    status: 'running',
    updatedRel: 'running',
    updatedAbs: 'May 22, 14:12',
    created: 'May 20, 2026',
    size: '14.1 MB',
  },
  {
    id: 'austen-emma-vol2',
    title: 'Emma · Vol. II',
    author: 'Jane Austen',
    pages: 412, totalStages: 23, currentStage: 11, // text_review
    status: 'review',
    flagged: 18,
    updatedRel: 'yesterday',
    updatedAbs: 'May 21, 18:30',
    created: 'May 18, 2026',
    size: '22.6 MB',
  },
  {
    id: 'dickens-pickwick',
    title: 'The Pickwick Papers',
    author: 'Charles Dickens',
    pages: 624, totalStages: 23, currentStage: 19, // validation
    status: 'error',
    flagged: 3,
    updatedRel: '3d ago',
    updatedAbs: 'May 19, 09:14',
    created: 'May 10, 2026',
    size: '41.2 MB',
  },
  {
    id: 'ruskin-modern-painters',
    title: 'Modern Painters',
    author: 'John Ruskin',
    pages: 156, totalStages: 23, currentStage: 22,
    status: 'submitted',
    updatedRel: 'May 10',
    updatedAbs: 'May 10, 16:02',
    created: 'May 02, 2026',
    size: '9.8 MB',
  },
  {
    id: 'stevenson-kidnapped',
    title: 'Kidnapped',
    author: 'Robert Louis Stevenson',
    pages: 248, totalStages: 23, currentStage: 22,
    status: 'submitted',
    archived: true, archivedOn: 'May 02, 2026',
    updatedRel: 'Apr 28',
    updatedAbs: 'Apr 28, 11:45',
    created: 'Apr 22, 2026',
    size: '15.2 MB',
  },
];

/* Status → visual mapping using design-system status tokens. */
const STATUS = {
  queued:    { label: 'queued',    tone: 'neutral' },
  running:   { label: 'running',   tone: 'running' },
  review:    { label: 'review',    tone: 'review'  },
  ready:     { label: 'ready',     tone: 'clean'   },
  submitted: { label: 'submitted', tone: 'neutral' },
  error:     { label: 'error',     tone: 'failed'  },
  archived:  { label: 'archived',  tone: 'neutral' },
};

/* Mini 23-dot pipeline progress strip — same dot vocabulary as wf10. */
const PipelineMini = ({ total = 23, current, status, height = 8, gap = 2 }) => {
  const color = status === 'error'   ? 'var(--mismatch)'
              : status === 'running' ? 'var(--ocr)'
              : status === 'review'  ? 'var(--fuzzy)'
              :                        'var(--exact)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap, height }}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const here = i === current;
        return (
          <span key={i} style={{
            width: here ? height : Math.max(4, height - 2),
            height: here ? height : Math.max(4, height - 2),
            borderRadius: 99,
            background: done || here ? color : 'var(--border-2)',
            opacity: done && !here ? 0.7 : 1,
            animation: here && status === 'running' ? 'pgd-pulse 1.4s ease-in-out infinite' : 'none',
          }} />
        );
      })}
    </div>
  );
};

/* Avatar/cover placeholder — uses author initials + a chroma-stable hue. */
const CoverPlaceholder = ({ author, size = 56 }) => {
  const initials = author.split(' ').map(w => w[0]).slice(0, 2).join('');
  const hue = [...author].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div style={{
      width: size, height: size * 1.35, borderRadius: 4,
      background: `linear-gradient(160deg, oklch(0.62 0.07 ${hue}), oklch(0.42 0.06 ${(hue + 30) % 360}))`,
      color: 'rgba(255,255,255,0.92)', flex: '0 0 auto',
      display: 'grid', placeItems: 'center',
      fontFamily: 'var(--mono-font)', fontWeight: 600, fontSize: size * 0.28,
      letterSpacing: '0.04em',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), inset -2px 0 0 rgba(0,0,0,0.18)',
    }}>{initials}</div>
  );
};

/* Tiny shared controls strip — sort + filter + freeform search, sits next to breadcrumb. */
const ProjectsControls = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <Button variant="ghost" size="sm" iconRight="chevD">Sort: Recent</Button>
    <Button variant="ghost" size="sm" iconRight="chevD">All status</Button>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      height: 24, padding: '0 8px', width: 240,
      background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 5,
      color: 'var(--ink-3)', fontSize: 11.5,
    }}>
      <Icon name="search" size={12} />
      <span style={{ flex: 1, fontFamily: 'var(--ui-font)' }}>Filter projects…</span>
    </div>
  </div>
);

/* ============================================================
   AttributesPanel — PGDP-level project attributes.
   Collapsible sections in a 2-column reflow grid (single column under ~760px).
   Project comments span all columns since they're long-form prose.
============================================================ */
const AttributesPanel = ({ selected }) => {
  const [open, setOpen] = React.useState({
    bib: true, pgdp: true, fmt: true, comments: true,
  });
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const groups = [
    {
      key: 'bib',
      label: 'Bibliographic',
      fields: [
        ['Title',           selected.title],
        ['Author',          selected.author],
        ['Language',        'English'],
        ['Original year',   '1815'],
        ['Edition',         'John Murray, London — 1816 stereotype'],
        ['Source archive',  'archive.org · austen-emma-vol2-1816'],
      ],
    },
    {
      key: 'pgdp',
      label: 'PGDP project',
      fields: [
        ['Project ID',      selected.id, true],
        ['Difficulty',      'B1 · Beginners welcome'],
        ['Genre',           'Fiction · Classic'],
        ['Forum category',  'Literature · 19th century'],
        ['Round',           'P1 (initial proofread)'],
        ['Format version',  'pgdp-format-2024.3'],
      ],
    },
    {
      key: 'fmt',
      label: 'Format & content',
      fields: [
        ['Page format',     'smooth-reading'],
        ['Illustrations',   '12 figures · grayscale'],
        ['Footnotes',       'numbered, per-page'],
        ['Word lists',      '+ 38 custom · derives from book'],
        ['Special chars',   '— œ æ · long-s preserved'],
        ['PG submission',   'queued · awaiting cleared P3'],
      ],
    },
  ];

  const CollapseHeader = ({ k, label, count }) => {
    const isOpen = open[k];
    return (
      <div onClick={() => toggle(k)} role="button" tabIndex={0} style={{
        width: '100%', cursor: 'pointer',
        padding: '10px 14px',
        background: 'var(--bg-page)',
        borderBottom: isOpen ? '1px solid var(--border-1)' : '0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: 'inherit',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex',
            transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform .15s',
            color: 'var(--ink-3)',
          }}>
            <Icon name="chevD" size={12} />
          </span>
          <span className="label" style={{ color: 'var(--ink-2)' }}>{label}</span>
          {count != null ? (
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{count}</span>
          ) : null}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" icon="wrench">Edit</Button>
        </span>
      </div>
    );
  };

  return (
    <div style={{
      marginTop: 12,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      gap: 12,
    }}>
      {groups.map(g => (
        <div key={g.key} style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          overflow: 'hidden', alignSelf: 'start',
        }}>
          <CollapseHeader k={g.key} label={g.label} count={`${g.fields.length} fields`} />
          {open[g.key] ? (
            <div>
              {g.fields.map(([k, v, mono], i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '170px 1fr',
                  gap: 12, padding: '10px 14px', alignItems: 'baseline',
                  borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{k}</span>
                  <span className={mono ? 'mono' : ''} style={{
                    fontSize: mono ? 11.5 : 12.5, color: 'var(--ink-1)', fontWeight: 500,
                  }}>{v}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {/* Project comments — long-form, span all columns */}
      <div style={{
        gridColumn: '1 / -1',
        background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
        overflow: 'hidden',
      }}>
        <CollapseHeader k="comments" label="Project comments (to proofreaders)" />
        {open.comments ? (
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            Preserve em-dashes; long-s is already transcribed as 's'. Footnote anchors use the form
            <span className="mono" style={{ color: 'var(--ink-1)' }}> [Note 12] </span>
            at the call site and
            <span className="mono" style={{ color: 'var(--ink-1)' }}> [Footnote 12: …] </span>
            at the bottom of the page. Italic for ship names and foreign phrases; small-caps for chapter
            openings; preserve original spelling and punctuation throughout.
          </div>
        ) : null}
      </div>
    </div>
  );
};

/* ============================================================
   V4 — Sidebar + detail preview
   Left rail of compact rows, right pane shows the selected project preview
   with a prominent "Open project" CTA. New-project lives at the top of the rail.
============================================================ */
const ProjectsPage = ({ theme = 'light', defaultTab = 'activity', selectedId = 'austen-emma-vol2', emptyState = false }) => {
  const selected = PROJECTS.find(p => p.id === selectedId) || PROJECTS[2];
  const s = selected.archived ? STATUS.archived : STATUS[selected.status];
  const [tab, setTab] = React.useState(defaultTab);
  const [railTab, setRailTab] = React.useState(selected.archived ? 'archived' : 'active');
  const activeProjects = PROJECTS.filter(p => !p.archived);
  const archivedProjects = PROJECTS.filter(p => p.archived);
  const railList = railTab === 'archived' ? archivedProjects : activeProjects;
  return (
    <AppTemplate
      theme={theme}
      trail={[{ label: 'Projects' }]}
      controls={<ProjectsControls />}
      contentPad="0">
      <div style={{
        height: '100%',
        display: 'grid', gridTemplateColumns: '320px 1fr',
      }}>
        {/* Left rail */}
        <div style={{
          borderRight: '1px solid var(--border-1)',
          background: 'var(--bg-surface)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '16px 16px 12px' }}>
            <Button variant="primary" icon="plus" full>New project</Button>
          </div>
          <div style={{ padding: '0 16px 10px' }}>
            <div className="label" style={{ color: 'var(--ink-3)' }}>All projects</div>
            <div className="mono" style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              <div>{PROJECTS.length} projects · 2,045 pages</div>
              <div style={{ color: 'var(--ink-4)' }}>131.3 MB on disk · 1.84 GB stage artifacts</div>
            </div>
          </div>
          {/* Active / Archived segmented tabs */}
          <div style={{
            padding: '0 12px 10px', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {[
              { id: 'active',   label: 'Active',   count: activeProjects.length },
              { id: 'archived', label: 'Archived', count: archivedProjects.length },
            ].map(t => {
              const on = railTab === t.id;
              return (
                <button key={t.id} onClick={() => setRailTab(t.id)} style={{
                  flex: 1, height: 28, borderRadius: 6, cursor: 'pointer',
                  background: on ? 'var(--bg-raised)' : 'transparent',
                  border: '1px solid ' + (on ? 'var(--border-2)' : 'transparent'),
                  color: on ? 'var(--ink-1)' : 'var(--ink-3)',
                  fontSize: 12, fontWeight: on ? 600 : 500,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  {t.label}
                  <span className="mono" style={{
                    fontSize: 10, padding: '1px 5px', borderRadius: 4,
                    background: on ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--bg-sunk)',
                    color: on ? 'var(--accent)' : 'var(--ink-4)',
                  }}>{t.count}</span>
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid var(--border-1)' }}>
            {railList.map(p => {
              const ps = p.archived ? STATUS.archived : STATUS[p.status];
              const isSel = p.id === selected.id;
              return (
                <div key={p.id} style={{
                  padding: '10px 16px',
                  background: isSel ? 'var(--bg-raised)' : 'transparent',
                  borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                  opacity: p.archived ? 0.9 : 1,
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{
                      fontSize: 13, fontWeight: isSel ? 600 : 500,
                      color: p.archived ? 'var(--ink-2)' : 'var(--ink-1)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{p.title}</span>
                    <Badge tone={ps.tone} mono>{ps.label}</Badge>
                  </div>
                  <div className="mono" style={{
                    fontSize: 10.5, color: 'var(--ink-4)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span>{p.id}</span>
                    <span style={{ color: 'var(--border-3)' }}>·</span>
                    <span>{p.pages}p</span>
                    <span style={{ color: 'var(--border-3)' }}>·</span>
                    <span>{p.size}</span>
                    <span style={{ flex: 1 }} />
                    <span>{p.archived ? `archived ${p.archivedOn?.split(',')[0] || ''}` : p.updatedRel}</span>
                  </div>
                </div>
              );
            })}
            {railList.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 }}>
                No {railTab} projects.
              </div>
            ) : null}
          </div>
        </div>

        {/* Right pane: selected project preview */}
        <div style={{ padding: '32px 40px', overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <CoverPlaceholder author={selected.author} size={88} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>{selected.title}</h1>
                <Badge tone={s.tone} mono>{s.label}</Badge>
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
                {selected.author} · <span className="mono">{selected.id}</span>
              </div>
            </div>
            <Button variant="primary" iconRight="arrowR">
              {selected.archived ? 'Open (read-only)' : 'Open project'}
            </Button>
          </div>

          {/* Stats grid */}
          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-1)', border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
            {[
              { label: 'pages',     value: selected.pages,                       tone: 'ink-1' },
              { label: 'on disk',   value: selected.size,                        tone: 'ink-1' },
              { label: 'flagged',   value: selected.flagged ?? '—',              tone: selected.flagged ? 'fuzzy' : 'ink-2', sub: selected.flagged ? 'awaiting review' : 'none' },
              { label: 'progress',  value: `${Math.round((selected.currentStage / selected.totalStages) * 100)}%`, tone: 'ink-1', sub: `${selected.currentStage + 1}/${selected.totalStages} stages` },
              { label: 'created',   value: selected.created.replace(', 2026', ''), tone: 'ink-2', sub: '2026' },
              { label: 'updated',   value: selected.updatedRel,                  tone: 'ink-2', sub: selected.updatedAbs.split(', ')[1] },
            ].map((stat, i) => (
              <div key={i} style={{ background: 'var(--bg-surface)', padding: '14px 14px 12px' }}>
                <div className="label" style={{ color: 'var(--ink-3)' }}>{stat.label}</div>
                <div className="mono" style={{
                  marginTop: 6, fontSize: 18, fontWeight: 600,
                  color: stat.tone === 'fuzzy' ? 'var(--fuzzy)' : `var(--${stat.tone})`,
                  letterSpacing: '-0.01em',
                }}>{stat.value}</div>
                {stat.sub ? (
                  <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-4)' }}>{stat.sub}</div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Pipeline progress */}
          <div style={{ marginTop: 24 }}>
            <div className="label" style={{ marginBottom: 8 }}>Pipeline</div>
            <div style={{
              padding: '14px 16px',
              background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
            }}>
              <PipelineMini total={selected.totalStages} current={selected.currentStage} status={selected.status} height={12} />
              <div className="mono" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', justifyContent: 'space-between' }}>
                <span>stage {selected.currentStage + 1}/{selected.totalStages}{selected.archived ? ' · final' : ' · text_review'}</span>
                <span style={{ color: selected.flagged ? 'var(--fuzzy)' : 'var(--ink-4)' }}>
                  {selected.flagged ? `${selected.flagged} pages flagged · ` : ''}
                  {selected.archived ? `archived ${selected.archivedOn}` : '11 hr 38 min processing time'}
                </span>
              </div>
            </div>
          </div>

          {/* Tabbed detail: Activity (preview) + Manage */}
          <div style={{ marginTop: 28 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              borderBottom: '1px solid var(--border-1)',
            }}>
              {[
                { id: 'activity',   label: 'Recent activity', count: 'last 3' },
                { id: 'attributes', label: 'Attributes', count: null },
                { id: 'manage',     label: 'Manage', count: null },
              ].map(t => {
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    position: 'relative', background: 'transparent', border: 0,
                    padding: '10px 14px', cursor: 'pointer',
                    color: active ? 'var(--ink-1)' : 'var(--ink-3)',
                    fontSize: 12.5, fontWeight: active ? 600 : 500,
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}>
                    {t.label}
                    {t.count ? (
                      <span className="mono" style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 4,
                        background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--bg-raised)',
                        color: active ? 'var(--accent)' : 'var(--ink-3)',
                      }}>{t.count}</span>
                    ) : null}
                    {active ? (
                      <span style={{
                        position: 'absolute', left: 10, right: 10, bottom: -1, height: 2,
                        background: 'var(--accent)', borderRadius: '2px 2px 0 0',
                      }} />
                    ) : null}
                  </button>
                );
              })}
              <span style={{ flex: 1 }} />
              {tab === 'activity' ? (
                <a style={{
                  fontSize: 11.5, color: 'var(--ink-3)',
                  textDecoration: 'none', padding: '6px 10px', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  View all activity
                  <Icon name="arrowR" size={11} />
                </a>
              ) : null}
            </div>

            {tab === 'activity' ? (
              <div style={{
                marginTop: 12,
                background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
                padding: '4px 0',
              }}>
                {[
                  ['ocr', 'completed · 412 pages · 6m 12s', 'May 21, 18:30'],
                  ['spellcheck', '4 dictionary mismatches', 'May 21, 17:08'],
                  ['text_review', 'awaiting input · 18 pages flagged', 'May 21, 16:55'],
                ].map(([stage, desc, when], i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '120px 1fr 140px',
                    gap: 12, padding: '10px 16px',
                    borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
                    alignItems: 'center',
                  }}>
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600 }}>{stage}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{desc}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right' }}>{when}</span>
                  </div>
                ))}
                <div style={{
                  padding: '10px 16px', borderTop: '1px solid var(--border-1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    + 84 earlier entries (23 stages · 14 comments)
                  </span>
                  <Button variant="ghost" size="sm" iconRight="arrowR">Open activity log</Button>
                </div>
              </div>
            ) : null}

            {tab === 'attributes' ? <AttributesPanel selected={selected} /> : null}

            {tab === 'manage' ? (
              <div style={{
                marginTop: 12,
                background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
                padding: '4px 0',
              }}>
                {(selected.archived ? [
                  {
                    icon: 'refresh',
                    title: 'Restore project',
                    desc: 'Unarchive and make the project editable again. Intermediate artifacts will be regenerated on demand.',
                    meta: 'unzip in place',
                    cta: 'Restore',
                    variant: 'default',
                  },
                  {
                    icon: 'download',
                    title: 'Save a copy…',
                    desc: 'Download the archived zip to a different location. The original archive remains here.',
                    meta: `${selected.size} · choose destination`,
                    cta: 'Save copy',
                    variant: 'default',
                  },
                  {
                    icon: 'trash',
                    title: 'Delete project',
                    desc: 'Permanently remove everything: pages, settings, package, and history. Only archived projects can be deleted.',
                    meta: 'cannot be undone',
                    cta: 'Delete permanently',
                    variant: 'danger',
                    danger: true,
                  },
                ] : [
                  {
                    icon: 'sparkles',
                    title: 'Clean intermediate artifacts',
                    desc: 'Drop stage outputs that can be re-derived automatically (crops, OCR, dewarped images). Final package is preserved.',
                    meta: 'reclaim 1.62 GB',
                    cta: 'Clean',
                    variant: 'default',
                  },
                  {
                    icon: 'archive',
                    title: 'Archive project',
                    desc: 'Zip the project in place and mark it read-only. Stays in this list under Archived.',
                    meta: '→ 24.8 MB zipped · stays here',
                    cta: 'Archive',
                    variant: 'default',
                  },
                  {
                    icon: 'download',
                    title: 'Save a copy…',
                    desc: 'Download a zip of the full project to a different location. The original remains untouched.',
                    meta: '~24.8 MB · choose destination',
                    cta: 'Save copy',
                    variant: 'default',
                  },
                  {
                    icon: 'trash',
                    title: 'Delete project',
                    desc: 'Cleans intermediate artifacts and archives the project. Run delete again from the archived state to remove it permanently.',
                    meta: 'step 1 of 2 · → archived',
                    cta: 'Delete…',
                    variant: 'default',
                    twoStep: true,
                  },
                ]).map((a, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '28px 1fr 200px 150px',
                    gap: 14, padding: '14px 16px', alignItems: 'center',
                    borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: a.danger
                        ? 'color-mix(in oklab, var(--mismatch) 10%, transparent)'
                        : a.twoStep
                          ? 'color-mix(in oklab, var(--fuzzy) 12%, transparent)'
                          : 'var(--bg-raised)',
                      color: a.danger ? 'var(--mismatch)' : a.twoStep ? 'var(--fuzzy)' : 'var(--ink-2)',
                      display: 'grid', placeItems: 'center',
                    }}>
                      <Icon name={a.icon} size={14} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{a.title}</div>
                      <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>{a.desc}</div>
                    </div>
                    <div className="mono" style={{
                      fontSize: 11,
                      color: a.danger ? 'var(--mismatch)' : a.twoStep ? 'var(--fuzzy)' : 'var(--ink-4)',
                      textAlign: 'right',
                    }}>{a.meta}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button variant={a.variant} size="sm">{a.cta}</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AppTemplate>
  );
};

/* ============================================================
   Empty state — first-time user, no projects.
   Full-width hero with primary CTA + secondary "import existing" affordance.
   Lives alongside V4 so the visual language stays consistent.
============================================================ */
const ProjectsEmpty = ({ theme = 'light' }) => (
  <AppTemplate
    theme={theme}
    trail={[{ label: 'Projects' }]}
    controls={<ProjectsControls />}
    contentPad="0">
    <div style={{
      height: '100%', display: 'grid', placeItems: 'center',
      padding: '48px 24px',
    }}>
      <div style={{
        maxWidth: 560, width: '100%', textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
      }}>
        {/* Iconographic stack of pages — placeholder, no AI-slop SVGs */}
        <div style={{ position: 'relative', width: 140, height: 100 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              position: 'absolute',
              left: 30 + i * 14, top: 14 - i * 6,
              width: 78, height: 100 - i * 4, borderRadius: 4,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-2)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              opacity: 1 - i * 0.18,
              transform: `rotate(${(i - 1) * 4}deg)`,
            }}>
              <div style={{
                position: 'absolute', inset: 12,
                backgroundImage: 'repeating-linear-gradient(to bottom, var(--border-1) 0 1px, transparent 1px 8px)',
              }} />
            </div>
          ))}
        </div>

        <div>
          <h1 style={{
            fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em',
            color: 'var(--ink-1)',
          }}>No projects yet</h1>
          <p style={{
            marginTop: 8, fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.55,
            maxWidth: 440, marginInline: 'auto',
          }}>
            A project bundles a book’s pages, settings, and pipeline state — everything needed to assemble a
            PGDP-ready package. Start by uploading a folder of scans, or paste a source URL from archive.org / Google Books.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button variant="primary" size="lg" icon="plus">Create new project</Button>
          <Button variant="default" size="lg" icon="link">Paste source URL</Button>
        </div>

        {/* Tertiary path: small print */}
        <div style={{
          marginTop: 12, paddingTop: 20, borderTop: '1px solid var(--border-1)',
          width: '100%', fontSize: 12, color: 'var(--ink-3)',
          display: 'flex', justifyContent: 'center', gap: 18,
        }}>
          <a href="#" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Import a .pgdp-prep archive</a>
          <span style={{ color: 'var(--border-2)' }}>·</span>
          <a href="#" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>Open the format style guide</a>
        </div>
      </div>
    </div>
  </AppTemplate>
);

Object.assign(window, {
  PROJECTS, STATUS, PipelineMini, CoverPlaceholder, ProjectsControls,
  AttributesPanel, ProjectsPage, ProjectsEmpty,
});
