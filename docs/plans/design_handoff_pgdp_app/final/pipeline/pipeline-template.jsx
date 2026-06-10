// pipeline-template.jsx — Locked per-project Pipeline page template.
// Two slots: `tabsSlot` (the per-stage tab band) and children (the tab body
// content). All shared chrome — project info band, stage strip, project
// settings toggle — is owned by this file.

/* ---------------------- Pipeline stage definitions ---------------------- */
const STAGE_DEFS = [
  { id: 'source',            short: 'source',    group: 'Source' },
  { id: 'grayscale',         short: 'grayscale', group: 'Image' },
  { id: 'crop',              short: 'rough',     group: 'Image' },   // Rough crop
  { id: 'threshold',         short: 'threshold', group: 'Image' },
  { id: 'dewarp',            short: 'dewarp',    group: 'Image' },
  { id: 'deskew',            short: 'deskew',    group: 'Image' },
  { id: 'post_transform_crop', short: 'recrop',  group: 'Image' },  // Post-transform crop
  { id: 'denoise',           short: 'denoise',   group: 'Image' },
  { id: 'text_zones',        short: 'zones',     group: 'OCR' },     // Page layout
  { id: 'ocr',               short: 'ocr',       group: 'OCR' },
  { id: 'page_order',        short: 'order',     group: 'OCR' },
  { id: 'post_ocr_crop',     short: 'crop2',     group: 'Compose' }, // Post-OCR crop
  { id: 'canvas_map',        short: 'canvas',    group: 'Compose' }, // Canvas map (final)
  { id: 'hyphen_join',       short: 'hyphen',    group: 'Text' },    // end-of-line hyphens
  { id: 'wordcheck',         short: 'wordcheck', group: 'Text' },    // scannos + word lists
  { id: 'text_review',       short: 'review',    group: 'Text' },
  { id: 'illust',            short: 'illust',    group: 'Pack' },
  { id: 'regex',             short: 'regex',     group: 'Pack' },
  { id: 'validation',        short: 'validate',  group: 'Pack' },
  { id: 'proof_pack',        short: 'proof',     group: 'Pack' },
  { id: 'build_package',     short: 'package',   group: 'Pack' },
  { id: 'zip',               short: 'zip',       group: 'Pack' },
  { id: 'submit_check',      short: 'submit',    group: 'Pack' },
  { id: 'archive',           short: 'archive',   group: 'Pack' },
];

const STAGE_STATE = (curIdx, i) =>
  i < curIdx ? 'clean' : i === curIdx ? 'running' : 'notrun';

/* Shared sample project — pure presentational, matches final/projects/. */
const SAMPLE_PROJECT = {
  title: 'Belloc — Survivals & New Arrivals',
  author: 'Hilaire Belloc',
  id: 'belloc-survivals',
  pages: 232,
  ingested: '12 min ago',
  size: '2.1 GB',
};

/* Per-stage tab configurations. Two anchors are always present (Overview,
   Stage settings); the middle adapts per stage. The "Page workbench" tab
   is per-page deep-dive — only present where it makes sense (page-scoped
   stages). Stages that aren't page-scoped (build_package, hyphen_join)
   skip it. */
const STAGE_TABS = {
  source: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'files',     name: 'Files',          icon: 'folder',  count: '387' },
    { id: 'workbench', name: 'Page workbench', icon: 'image' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  __default: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'pages',     name: 'Pages',          icon: 'file',    count: '232' },
    { id: 'workbench', name: 'Page workbench', icon: 'image' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  ocr: [
    { id: 'overview',    name: 'Overview',       icon: 'package' },
    { id: 'pages',       name: 'Pages',          icon: 'file', count: '232' },
    { id: 'recognition', name: 'Recognition',    icon: 'sparkles' },
    { id: 'workbench',   name: 'Page workbench', icon: 'image' },
    { id: 'settings',    name: 'Stage settings', icon: 'wrench' },
  ],
  text_review: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'pages',     name: 'Pages',          icon: 'file', count: '232' },
    { id: 'queue',     name: 'Review queue',   icon: 'eye',  count: '31' },
    { id: 'comments',  name: 'Comments',       icon: 'fileText' },
    { id: 'workbench', name: 'Page workbench', icon: 'image' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  build_package: [
    { id: 'overview',  name: 'Overview',      icon: 'package' },
    { id: 'manifest',  name: 'Manifest',      icon: 'fileText' },
    { id: 'preflight', name: 'Pre-flight',    icon: 'checkCircle' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  hyphen_join: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'queue',     name: 'Undecided',      icon: 'eye',    count: '7' },
    { id: 'joined',    name: 'Auto-joined',    icon: 'check',  count: '42' },
    { id: 'mismatch',  name: 'Mismatch',       icon: 'alert',  count: '3' },
    { id: 'workbench', name: 'Page workbench', icon: 'image' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  grayscale: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'pages',     name: 'Pages',          icon: 'file', count: '232' },
    { id: 'workbench', name: 'Page workbench', icon: 'image' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  text_zones: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'pages',     name: 'Pages',          icon: 'file',     count: '387' },
    { id: 'splits',    name: 'Page splits',    icon: 'scissors', count: '7' },
    { id: 'workbench', name: 'Page workbench', icon: 'image' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  canvas_map: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'pages',     name: 'Pages',          icon: 'file', count: '387' },
    { id: 'spreads',   name: 'Facing pages',   icon: 'copy', count: '12' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  page_order: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'sequence',  name: 'Sequence',       icon: 'swap', count: '9' },
    { id: 'pages',     name: 'Pages',          icon: 'file', count: '387' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  wordcheck: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'suspects',  name: 'Suspects',       icon: 'alert', count: '146' },
    { id: 'lists',     name: 'Word lists',     icon: 'fileText', count: '10' },
    { id: 'pages',     name: 'Pages',          icon: 'file', count: '387' },
    { id: 'workbench', name: 'Page workbench', icon: 'image' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
  illust: [
    { id: 'overview',      name: 'Overview',       icon: 'package' },
    { id: 'illustrations', name: 'Illustrations',  icon: 'image', count: '54' },
    { id: 'workbench',     name: 'Page workbench', icon: 'image' },
    { id: 'settings',      name: 'Stage settings', icon: 'wrench' },
  ],
  regex: [
    { id: 'overview',  name: 'Overview',       icon: 'package' },
    { id: 'rules',     name: 'Rules',          icon: 'fileText', count: '8' },
    { id: 'pages',     name: 'Pages',          icon: 'file', count: '387' },
    { id: 'settings',  name: 'Stage settings', icon: 'wrench' },
  ],
};
const tabsForStage = (stageId) => STAGE_TABS[stageId] || STAGE_TABS.__default;

/* ---------------------- ProjectInfoBand ----------------------
   Cover + title + status + meta + Project settings toggle + Run all stale.
   `inSettings` flips the band into project-settings mode (button becomes
   primary "× Close settings", Run-all is hidden — it's stage-scoped).
*/
const ProjectInfoBand = ({ project = SAMPLE_PROJECT, inSettings = false }) => (
  <div style={{
    padding: '20px 28px',
    background: 'var(--bg-page)',
    borderBottom: '1px solid var(--border-1)',
    display: 'flex', gap: 18, alignItems: 'flex-start',
  }}>
    <CoverPlaceholder author={project.author} size={56} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h1 style={{
          fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em',
          color: 'var(--ink-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{project.title}</h1>
        <Badge tone="review" mono>review</Badge>
      </div>
      <div className="mono" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>{project.id}</span>
        <span style={{ color: 'var(--border-3)' }}>·</span>
        <span>{project.author}</span>
        <span style={{ color: 'var(--border-3)' }}>·</span>
        <span>{project.pages} pages</span>
        <span style={{ color: 'var(--border-3)' }}>·</span>
        <span>ingested {project.ingested}</span>
        <span style={{ color: 'var(--border-3)' }}>·</span>
        <span>{project.size}</span>
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8, flex: '0 0 auto', alignItems: 'center' }}>
      <Button
        variant={inSettings ? 'primary' : 'default'}
        size="md"
        icon={inSettings ? 'x' : 'wrench'}>
        {inSettings ? 'Close settings' : 'Project settings'}
      </Button>
      {!inSettings ? (
        <>
          <Divider vertical style={{ height: 22 }} />
          <Button variant="primary" size="md" iconRight="arrowR">Run all stale</Button>
        </>
      ) : null}
    </div>
  </div>
);

/* ---------------------- StageStrip ----------------------
   Single named selector on the left + dots-only progress strip + counts +
   Prev/Next. The stage label only appears once (on the chip) — the strip
   itself is dot-only by design.
*/
const StageStrip = ({ currentStage = 'threshold', flagged = 31, stale = 167 }) => {
  const idx = Math.max(0, STAGE_DEFS.findIndex(s => s.id === currentStage));
  const cur = STAGE_DEFS[idx];
  return (
    <div style={{
      padding: '10px 28px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border-1)',
      display: 'flex', alignItems: 'center', gap: 14,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
        <div className="label" style={{ color: 'var(--ink-3)' }}>Stage</div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', borderRadius: 7,
          border: '1px solid color-mix(in oklab, var(--ocr) 50%, var(--border-1))',
          background: 'color-mix(in oklab, var(--ocr) 10%, var(--bg-surface))',
          cursor: 'pointer',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--ocr)', animation: 'pgd-pulse 1.4s ease-in-out infinite' }} />
          <span className="mono" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>{cur.id}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{idx + 1}/{STAGE_DEFS.length}</span>
          <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
        </div>
        <KeyCap>⌘P</KeyCap>
      </div>
      <Divider vertical style={{ height: 22 }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, overflow: 'hidden' }}>
        {STAGE_DEFS.map((s, i) => {
          const st = STAGE_STATE(idx, i);
          const isCur = i === idx;
          return (
            <React.Fragment key={s.id}>
              <div title={`${i + 1}. ${s.id}`} style={{
                width: isCur ? 18 : 14, height: 22, borderRadius: 4, cursor: 'pointer',
                display: 'grid', placeItems: 'center',
                background: isCur ? 'color-mix(in oklab, var(--ocr) 14%, transparent)' : 'transparent',
                border: isCur ? '1px solid color-mix(in oklab, var(--ocr) 60%, var(--border-1))' : 'none',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 99,
                  background: isCur ? 'var(--ocr)' : st === 'clean' ? 'var(--exact)' : 'var(--ink-4)',
                  opacity: isCur ? 1 : st === 'clean' ? 1 : 0.55,
                  border: !isCur && st === 'clean'
                    ? '1px solid color-mix(in oklab, var(--exact) 60%, transparent)'
                    : !isCur ? '1px solid var(--border-2)' : 'none',
                  animation: isCur ? 'pgd-pulse 1.4s ease-in-out infinite' : 'none',
                }} />
              </div>
              {i < STAGE_DEFS.length - 1 ? <span style={{ width: 2, height: 1, background: 'var(--border-2)' }} /> : null}
            </React.Fragment>
          );
        })}
      </div>
      <Divider vertical style={{ height: 22 }} />
      <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', flex: '0 0 auto' }}>
        <span style={{ color: 'var(--fuzzy)', fontWeight: 600 }}>{flagged}</span> flagged
        <span style={{ color: 'var(--ink-4)' }}> · </span>
        <span style={{ color: 'var(--ink-2)' }}>{stale}</span> stale
      </div>
      <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
        <Button variant="default" size="sm" icon="chevL">Prev</Button>
        <Button variant="primary" size="sm" iconRight="chevR">Next</Button>
      </div>
    </div>
  );
};

/* ---------------------- TabsBand ----------------------
   Renders a tab row from a list of { id, name, icon, count? } items.
*/
const TabsBand = ({ items, current }) => (
  <div style={{
    padding: '0 28px',
    background: 'var(--bg-page)',
    borderBottom: '1px solid var(--border-1)',
    display: 'flex', alignItems: 'flex-end', gap: 0,
  }}>
    {items.map(t => {
      const active = current === t.id;
      return (
        <div key={t.id} style={{
          padding: '12px 14px',
          borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
          marginBottom: -1,
          display: 'flex', alignItems: 'center', gap: 8,
          color: active ? 'var(--ink-1)' : 'var(--ink-3)',
          fontSize: 13, fontWeight: active ? 600 : 500,
          cursor: 'pointer',
        }}>
          {t.icon ? <Icon name={t.icon} size={13} /> : null}
          {t.name}
          {t.count != null ? (
            <span className="mono" style={{
              padding: '0 6px', height: 18, borderRadius: 9,
              background: active ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--bg-raised)',
              color: active ? 'var(--accent)' : 'var(--ink-3)',
              fontSize: 11,
              display: 'inline-flex', alignItems: 'center',
            }}>{t.count}</span>
          ) : null}
        </div>
      );
    })}
  </div>
);

/* ---------------------- PipelineEmptySlot ----------------------
   Striped per-tab content placeholder. Mirrors the original
   final/index.html template's empty slot so the two templates
   feel related.
*/
const PipelineEmptySlot = () => (
  <div style={{ padding: 24, flex: 1, minHeight: 0, display: 'flex' }}>
    <div style={{
      flex: 1, minHeight: 480,
      border: '1px dashed var(--border-2)', borderRadius: 10,
      background: 'repeating-linear-gradient(135deg, transparent 0 14px, color-mix(in oklab, var(--border-1) 35%, transparent) 14px 15px)',
      display: 'grid', placeItems: 'center', color: 'var(--ink-3)',
    }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          content slot · per-tab
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Overview / Pages / Step settings content lands here.
        </div>
      </div>
    </div>
  </div>
);

/* ---------------------- PipelineTemplate ----------------------
   The actual template. Two slots:
     - `tabsSlot`: the per-stage tab band. Defaults to TabsBand from
       tabsForStage(stage), but callers can override entirely.
     - `children`: the per-tab content body. Defaults to PipelineEmptySlot.

   Other props let you switch stage, set the active tab, swap trail, etc.
*/
const PipelineTemplate = ({
  theme = 'light',
  trail,
  project = SAMPLE_PROJECT,
  stage = 'threshold',
  currentTab,
  tabsSlot,
  children,
  controls,
}) => {
  const tabs = tabsForStage(stage);
  const activeTab = currentTab || tabs.find(t => t.id !== 'overview')?.id || tabs[0].id;
  return (
    <AppTemplate
      theme={theme}
      trail={trail || [
        { label: 'Projects' },
        { label: project.id, mono: true },
      ]}
      controls={controls || (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" size="sm" iconRight="chevD">Sort: Recent</Button>
          <Button variant="ghost" size="sm" icon="search">Find page</Button>
        </div>
      )}
      contentPad="0">
      <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <ProjectInfoBand project={project} />
        <StageStrip currentStage={stage} />
        {tabsSlot !== undefined ? tabsSlot : <TabsBand items={tabs} current={activeTab} />}
        {children !== undefined ? children : <PipelineEmptySlot />}
      </div>
    </AppTemplate>
  );
};

/* ---------------------- ProjectSettingsTemplate ----------------------
   Project-scoped settings destination. Stage strip + step-scoped tabs are
   gone; sub-nav is a left rail of project-scoped settings groups.
   `children` is the right-pane content (defaults to the General group).
*/
const ProjectSettingsTemplate = ({
  theme = 'light',
  project = SAMPLE_PROJECT,
  currentGroup = 'general',
  children,
}) => (
  <AppTemplate
    theme={theme}
    trail={[
      { label: 'Projects' },
      { label: project.id, mono: true },
      { label: 'Settings' },
    ]}
    contentPad="0">
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <ProjectInfoBand project={project} inSettings />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 0 }}>
        <div style={{
          borderRight: '1px solid var(--border-1)',
          background: 'var(--bg-surface)',
          padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <div className="label" style={{ color: 'var(--ink-3)', padding: '4px 8px 8px' }}>Project settings</div>
          {[
            { id: 'general',   name: 'General',          icon: 'wrench' },
            { id: 'bib',       name: 'Bibliographic',    icon: 'fileText' },
            { id: 'pgdp',      name: 'PGDP submission',  icon: 'package' },
            { id: 'format',    name: 'Format & content', icon: 'file' },
            { id: 'defaults',  name: 'Stage defaults',   icon: 'sparkles' },
            { id: 'members',   name: 'Members',          icon: 'image' },
            { id: 'storage',   name: 'Storage & cleanup', icon: 'hardDrive' },
            { id: 'danger',    name: 'Danger zone',      icon: 'trash', danger: true },
          ].map(item => {
            const active = item.id === currentGroup;
            return (
              <div key={item.id} style={{
                padding: '7px 10px', borderRadius: 6,
                background: active ? 'var(--bg-raised)' : 'transparent',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                color: item.danger ? 'var(--mismatch)' : active ? 'var(--ink-1)' : 'var(--ink-2)',
                fontSize: 12.5, fontWeight: active ? 600 : 500,
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              }}>
                <Icon name={item.icon} size={13} />
                {item.name}
              </div>
            );
          })}
        </div>
        <div style={{ overflow: 'auto', padding: '20px 28px' }}>
          {children !== undefined ? children : <ProjectSettingsGeneralExample />}
        </div>
      </div>
    </div>
  </AppTemplate>
);

/* ---------------------- ProjectSettingsGeneralExample ----------------------
   Sample content for the General group — shown when the template is loaded
   with no children. Real callers pass their own content per group.
*/
const ProjectSettingsGeneralExample = () => (
  <>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>General</h2>
        <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--ink-3)' }}>
          Project name, identifier, and what the rest of the app calls this book.
        </div>
      </div>
      <Button variant="ghost" size="sm" icon="check">All changes saved</Button>
    </div>
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      overflow: 'hidden',
    }}>
      {[
        ['Project name',  'Belloc — Survivals & New Arrivals', false],
        ['Project ID',    'belloc-survivals', true],
        ['Author',        'Hilaire Belloc', false],
        ['Status',        'review', false],
        ['Ingested',      '12 minutes ago', false],
        ['Location',      '~/pgdp-prep/belloc-survivals/', true],
      ].map(([k, v, mono], i) => (
        <div key={k} style={{
          display: 'grid', gridTemplateColumns: '180px 1fr 28px',
          gap: 12, padding: '12px 14px', alignItems: 'center',
          borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{k}</span>
          <span className={mono ? 'mono' : ''} style={{
            fontSize: mono ? 11.5 : 12.5, color: 'var(--ink-1)', fontWeight: 500,
          }}>{v}</span>
          <Icon name="wrench" size={12} style={{ color: 'var(--ink-4)', cursor: 'pointer' }} />
        </div>
      ))}
    </div>

    <div style={{ marginTop: 24, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>Automation</h2>
        <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--ink-3)' }}>
          How aggressive the pipeline is about running stages on its own.
        </div>
      </div>
    </div>
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      overflow: 'hidden',
    }}>
      {[
        { label: 'Auto-run stages after ingest', sub: 'Source → Initial crop → Dewarp → Deskew → Grayscale, then stop', on: true },
        { label: 'Re-run downstream on stale bump', sub: 'When you tweak a stage, re-run everything after it automatically', on: true },
        { label: 'Notify on stage error', sub: 'Surface failed pages in the header notifications', on: true },
        { label: 'Pause pipeline on > 10% flagged', sub: 'Stop and wait for review when a stage flags more than 10% of pages', on: false },
      ].map((row, i) => (
        <div key={row.label} style={{
          display: 'grid', gridTemplateColumns: '1fr 36px',
          gap: 12, padding: '12px 14px', alignItems: 'center',
          borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
        }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{row.label}</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{row.sub}</div>
          </div>
          <span style={{
            width: 30, height: 18, borderRadius: 99, cursor: 'pointer',
            background: row.on ? 'var(--accent)' : 'var(--border-2)',
            position: 'relative',
            transition: 'background .12s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: row.on ? 14 : 2,
              width: 14, height: 14, borderRadius: 99, background: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,.15)',
              transition: 'left .12s',
            }} />
          </span>
        </div>
      ))}
    </div>
  </>
);

Object.assign(window, {
  STAGE_DEFS, STAGE_STATE, SAMPLE_PROJECT, STAGE_TABS, tabsForStage,
  ProjectInfoBand, StageStrip, TabsBand, PipelineEmptySlot,
  PipelineTemplate, ProjectSettingsTemplate, ProjectSettingsGeneralExample,
});
