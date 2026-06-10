// post-import.jsx — Locked Pa + Pb transitions for after the user clicks
// Start on a new project. Pulls in primitives from projects.jsx (CoverPlaceholder,
// PipelineMini, PROJECTS, STATUS, ProjectsControls) and template.jsx
// (AppTemplate, JobsDrawer). Self-contained — no draft deps.

/* ---------- Shared sample jobs (same shape as JobsPill / JobsDrawer) ---------- */
const IMPORT_JOBS = {
  thumbs: {
    id: 'job-import-belloc',
    project: 'Belloc — Survivals & New Arrivals',
    projectId: 'belloc-survivals-new',
    phase: 'thumbnails · 165 / 387 · 14.2/s',
    pct: 42, state: 'running', cancelable: true,
  },
  ingest: {
    id: 'job-import-belloc',
    project: 'Belloc — Survivals & New Arrivals',
    projectId: 'belloc-survivals-new',
    phase: 'ingest · stems + stages · 87%',
    pct: 87, state: 'running', cancelable: true,
  },
  done: {
    id: 'job-import-belloc',
    project: 'Belloc — Survivals & New Arrivals',
    projectId: 'belloc-survivals-new',
    phase: '387 pages · ready for pipeline',
    pct: 100, state: 'done',
  },
  ocrTwain: {
    id: 'job-ocr-twain',
    project: 'Pudd’nhead Wilson',
    projectId: 'twain-puddnhead',
    phase: 'ocr · 142 / 218 pages',
    pct: 65, state: 'running',
  },
};

/* ============================================================
   Pa — Auto-redirect: project's pipeline view (stage 1 = source)
   while thumbnails are being generated. Header JobsPill is hot.
============================================================ */
const PostImport_Redirect = ({ theme = 'light', jobsOpen = false }) => (
  <AppTemplate
    theme={theme}
    trail={[{ label: 'Projects' }, { label: 'belloc-survivals-new', mono: true }]}
    controls={<ProjectsControls />}
    activeJobs={[IMPORT_JOBS.thumbs]}
    jobsOpen={jobsOpen}
    contentPad="0">
    <div style={{
      height: '100%',
      display: 'grid', gridTemplateColumns: '320px 1fr',
    }}>
      <div style={{ borderRight: '1px solid var(--border-1)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
        <PostImport_Rail selectedId="belloc-survivals-new" importingJob={IMPORT_JOBS.thumbs} />
      </div>
      <div style={{ padding: '32px 40px', overflow: 'auto' }}>
        <div style={{ marginBottom: 14 }}>
          <Button variant="ghost" size="sm" icon="chevL">Projects</Button>
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <CoverPlaceholder author="Hilaire Belloc" size={88} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>
                Belloc — Survivals & New Arrivals
              </h1>
              <Badge tone="running" mono>importing</Badge>
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
              Hilaire Belloc · <span className="mono">belloc-survivals-new</span>
            </div>
          </div>
          <Button variant="primary" iconRight="arrowR" disabled>Open project</Button>
        </div>

        <div style={{ marginTop: 24 }}>
          <div className="label" style={{ marginBottom: 8 }}>Pipeline · stage 1 of 23 · source</div>
          <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
            <PipelineMini total={23} current={0} status="running" height={12} />
            <div className="mono" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-3)', display: 'flex', justifyContent: 'space-between' }}>
              <span>stage 1/23 · source · running</span>
              <span style={{ color: 'var(--ocr)' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: 'var(--ocr)', marginRight: 6, animation: 'pgd-pulse 1.4s ease-in-out infinite' }} />
                thumbnail · 165 / 387 · 14.2/s
              </span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            The folder index finished in ~1 s, so we redirected you here. <b style={{ color: 'var(--ink-1)' }}>Thumbnails</b>
            {' '}are being generated as the source stage — you can also follow progress from the header
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 2px', padding: '1px 6px', borderRadius: 4, background: 'color-mix(in oklab, var(--ocr) 12%, transparent)', color: 'var(--ink-1)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--ocr)' }} />
              Jobs
            </span>
            pill, which reflects every running job across all projects.
          </div>
        </div>
      </div>
    </div>
  </AppTemplate>
);

/* ============================================================
   Pb — Drawer over an anchored project
   The new-project flow has closed. User is back on whatever they had
   selected (Emma · Vol. II). JobsDrawer (bottom-right) keeps the import
   alive, mirrored by the header JobsPill.
============================================================ */
const PostImport_Drawer = ({
  theme = 'light',
  selectedId = 'austen-emma-vol2',
  drawerMode = 'expanded',
  scenario = 'thumbs',
  jobsOpen = false,
}) => {
  const sets = {
    thumbs:           { jobs: [IMPORT_JOBS.thumbs], toasts: [] },
    ingest:           { jobs: [IMPORT_JOBS.ingest], toasts: [] },
    done:             { jobs: [IMPORT_JOBS.done],   toasts: [] },
    'dismissed-toast': {
      jobs: [],
      toasts: [{
        id: 't1', project: 'Belloc — Survivals & New Arrivals',
        message: 'Import complete · 387 pages',
      }],
    },
    'two-jobs':       { jobs: [IMPORT_JOBS.thumbs, IMPORT_JOBS.ocrTwain], toasts: [] },
  }[scenario];

  return (
    <AppTemplate
      theme={theme}
      trail={[{ label: 'Projects' }]}
      controls={<ProjectsControls />}
      activeJobs={sets.jobs}
      jobsOpen={jobsOpen}
      contentPad="0">
      <div style={{
        height: '100%',
        display: 'grid', gridTemplateColumns: '320px 1fr',
        position: 'relative',
      }}>
        <div style={{ borderRight: '1px solid var(--border-1)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
          <PostImport_Rail
            selectedId={selectedId}
            importingJob={sets.jobs.find(j => j.projectId === 'belloc-survivals-new')} />
        </div>
        <div style={{ position: 'relative', overflow: 'hidden', minWidth: 0 }}>
          <AnchorProject selectedId={selectedId} />
          <JobsDrawer
            activeJobs={sets.jobs}
            toasts={sets.toasts}
            mode={drawerMode}
            forceHoverFirst={scenario === 'thumbs'}
          />
        </div>
      </div>
    </AppTemplate>
  );
};

/* AnchorProject — slim project preview rendered under the drawer so we can
   see the user is still anchored on a real project. Same data shape as
   the full ProjectsPage but read-only (no tab strip / Manage panel). */
const AnchorProject = ({ selectedId }) => {
  const selected = PROJECTS.find(p => p.id === selectedId) || PROJECTS[2];
  const s = STATUS[selected.status];
  return (
    <div style={{ padding: '32px 40px', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <CoverPlaceholder author={selected.author} size={88} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink-1)' }}>{selected.title}</h1>
            <Badge tone={s.tone} mono>{s.label}</Badge>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            {selected.author} · <span className="mono">{selected.id}</span>
          </div>
        </div>
        <Button variant="primary" iconRight="arrowR">Open project</Button>
      </div>
      <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8 }}>
        <PipelineMini total={selected.totalStages} current={selected.currentStage} status={selected.status} height={12} />
        <div className="mono" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ink-3)' }}>
          stage {selected.currentStage + 1}/{selected.totalStages} · text_review
        </div>
      </div>
    </div>
  );
};

/* PostImport_Rail — locked rail layout used by both Pa and Pb. Pins an
   "importing" pseudo-row at the top if there's an active import job. */
const PostImport_Rail = ({ selectedId, importingJob }) => {
  const activeCount = PROJECTS.filter(p => !p.archived).length + (importingJob ? 1 : 0);
  return (
    <>
      <div style={{ padding: '16px 16px 12px' }}>
        <Button variant="primary" icon="plus" full>New project</Button>
      </div>
      <div style={{ padding: '0 16px 10px' }}>
        <div className="label" style={{ color: 'var(--ink-3)' }}>All projects</div>
        <div className="mono" style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          <div>{PROJECTS.length + (importingJob ? 1 : 0)} projects · 2,432 pages</div>
          <div style={{ color: 'var(--ink-4)' }}>131.3 MB on disk · 1.84 GB stage artifacts</div>
        </div>
      </div>
      <div style={{ padding: '0 12px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{
          flex: 1, height: 28, borderRadius: 6,
          background: 'var(--bg-raised)', border: '1px solid var(--border-2)',
          color: 'var(--ink-1)', fontSize: 12, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>Active <span className="mono" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}>{activeCount}</span></div>
        <div style={{ flex: 1, height: 28, borderRadius: 6, color: 'var(--ink-3)', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          Archived <span className="mono" style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-sunk)', color: 'var(--ink-4)' }}>1</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', borderTop: '1px solid var(--border-1)' }}>
        {importingJob ? (
          <div style={{
            padding: '10px 16px',
            background: 'color-mix(in oklab, var(--ocr) 8%, var(--bg-raised))',
            borderLeft: selectedId === importingJob.projectId ? '2px solid var(--accent)' : '2px solid var(--ocr)',
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {importingJob.project}
              </span>
              <Badge tone="running" mono>importing</Badge>
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{importingJob.projectId}</span>
              <span style={{ color: 'var(--border-3)' }}>·</span>
              <span style={{ color: 'var(--ocr)' }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 99, background: 'var(--ocr)', marginRight: 4, animation: 'pgd-pulse 1.4s ease-in-out infinite' }} />
                {importingJob.pct}%
              </span>
              <span style={{ flex: 1 }} />
              <span>just now</span>
            </div>
            <div style={{ height: 3, borderRadius: 99, background: 'var(--bg-sunk)', marginTop: 2 }}>
              <div style={{ width: `${importingJob.pct}%`, height: '100%', background: 'var(--ocr)', borderRadius: 99 }} />
            </div>
          </div>
        ) : null}
        {PROJECTS.filter(p => !p.archived).map(p => {
          const ps = STATUS[p.status];
          const isSel = p.id === selectedId;
          return (
            <div key={p.id} style={{
              padding: '10px 16px',
              background: isSel ? 'var(--bg-raised)' : 'transparent',
              borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: isSel ? 600 : 500, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                <Badge tone={ps.tone} mono>{ps.label}</Badge>
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{p.id}</span>
                <span style={{ color: 'var(--border-3)' }}>·</span>
                <span>{p.pages}p</span>
                <span style={{ color: 'var(--border-3)' }}>·</span>
                <span>{p.size}</span>
                <span style={{ flex: 1 }} />
                <span>{p.updatedRel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

Object.assign(window, {
  IMPORT_JOBS, PostImport_Redirect, PostImport_Drawer,
  AnchorProject, PostImport_Rail,
});
