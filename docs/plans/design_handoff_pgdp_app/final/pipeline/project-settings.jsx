// project-settings.jsx — Page layouts for every group in the
// ProjectSettingsTemplate's left rail. Each component is just the right-pane
// content; ProjectSettingsTemplate handles the chrome.

const SettingsHeader = ({ title, sub, action }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.015em' }}>{title}</h2>
      <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--ink-3)' }}>{sub}</div>
    </div>
    {action || null}
  </div>
);

const SettingsCard = ({ children }) => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
    overflow: 'hidden',
  }}>
    {children}
  </div>
);

const SettingsRow = ({ label, sub, children, first }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '220px 1fr',
    gap: 12, padding: '14px 16px', alignItems: 'center',
    borderTop: first ? 0 : '1px solid var(--border-1)',
  }}>
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{label}</div>
      {sub ? <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{sub}</div> : null}
    </div>
    <div>{children}</div>
  </div>
);

const Toggle = ({ on }) => (
  <span style={{
    width: 30, height: 18, borderRadius: 99,
    background: on ? 'var(--accent)' : 'var(--border-2)',
    position: 'relative', cursor: 'pointer', display: 'inline-block',
  }}>
    <span style={{
      position: 'absolute', top: 2, left: on ? 14 : 2,
      width: 14, height: 14, borderRadius: 99, background: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,.15)',
    }} />
  </span>
);

const FieldRow = ({ label, value, mono, first, editable = true }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '180px 1fr 28px',
    gap: 12, padding: '12px 14px', alignItems: 'center',
    borderTop: first ? 0 : '1px solid var(--border-1)',
  }}>
    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
    <span className={mono ? 'mono' : ''} style={{
      fontSize: mono ? 11.5 : 12.5, color: 'var(--ink-1)', fontWeight: 500,
    }}>{value}</span>
    {editable ? <Icon name="wrench" size={12} style={{ color: 'var(--ink-4)', cursor: 'pointer' }} /> : <span />}
  </div>
);

/* ============================================================
   Bibliographic — book-level metadata (was in Source/Metadata)
============================================================ */
const ProjectSettings_Bibliographic = () => (
  <>
    <SettingsHeader
      title="Bibliographic"
      sub="Book-level metadata. Pre-filled from the import source when possible."
      action={<Button variant="ghost" size="sm" icon="check">All changes saved</Button>}
    />
    <SettingsCard>
      <FieldRow first label="Title"          value="Survivals and New Arrivals" />
      <FieldRow       label="Author"         value="Hilaire Belloc" />
      <FieldRow       label="Language"       value="English" />
      <FieldRow       label="Original year"  value="1929" />
      <FieldRow       label="Edition"        value="Sheed and Ward, London — first edition" />
      <FieldRow       label="Source archive" value="archive.org · bellocsurvivials00bell" mono />
      <FieldRow       label="ISBN / LCCN"    value="—" />
      <FieldRow       label="Volume"         value="single" />
    </SettingsCard>

    <div style={{ marginTop: 24 }}>
      <SettingsHeader
        title="Cataloging"
        sub="How the book is classified in PG / PGDP catalogs."
      />
      <SettingsCard>
        <FieldRow first label="LoC class"   value="PR 6003 .E45 S87" mono />
        <FieldRow       label="Genre"       value="Essays · Non-fiction" />
        <FieldRow       label="Subjects"    value="Literature · Social commentary" />
        <FieldRow       label="Forum tags"  value="early-20th-century · english-essayists" mono />
      </SettingsCard>
    </div>
  </>
);

/* ============================================================
   PGDP submission — how this project will be submitted
============================================================ */
const ProjectSettings_PGDP = () => (
  <>
    <SettingsHeader
      title="PGDP submission"
      sub="How this project will be submitted to Distributed Proofreaders."
      action={<Badge tone="review" mono>queued · awaiting cleared P3</Badge>}
    />
    <SettingsCard>
      <FieldRow first label="Project ID"     value="belloc-survivals" mono />
      <FieldRow       label="Difficulty"     value="B1 · Beginners welcome" />
      <FieldRow       label="Genre"          value="Essays · Non-fiction" />
      <FieldRow       label="Forum category" value="Literature · 20th century" />
      <FieldRow       label="Round"          value="P1 (initial proofread)" />
      <FieldRow       label="Format version" value="pgdp-format-2024.3" mono />
      <FieldRow       label="Smoothread"     value="on" />
      <FieldRow       label="Project credit" value="default" />
    </SettingsCard>

    <div style={{ marginTop: 24 }}>
      <SettingsHeader
        title="Project comments (to proofreaders)"
        sub="Shown in the PGDP project page header. Stylistic notes, footnote conventions, special-character handling."
      />
      <SettingsCard>
        <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          Preserve em-dashes; long-s is already transcribed as 's'. Footnote anchors use the form
          <span className="mono" style={{ color: 'var(--ink-1)' }}> [Note 12] </span>
          at the call site and
          <span className="mono" style={{ color: 'var(--ink-1)' }}> [Footnote 12: …] </span>
          at the bottom of the page. Italic for ship names and foreign phrases; small-caps for chapter
          openings; preserve original spelling and punctuation throughout.
        </div>
      </SettingsCard>
    </div>
  </>
);

/* ============================================================
   Format & content — page format, illustrations, footnotes, etc.
============================================================ */
const ProjectSettings_Format = () => (
  <>
    <SettingsHeader title="Format & content" sub="How the book is structured. Drives downstream stage behaviour." />
    <SettingsCard>
      <FieldRow first label="Page format"   value="smooth-reading" />
      <FieldRow       label="Illustrations" value="12 figures · grayscale" />
      <FieldRow       label="Footnotes"     value="numbered, per-page" />
      <FieldRow       label="Word lists"    value="+ 38 custom · derives from book" />
      <FieldRow       label="Special chars" value="— œ æ · long-s preserved" />
      <FieldRow       label="PG submission" value="queued · awaiting cleared P3" />
    </SettingsCard>

    <div style={{ marginTop: 24 }}>
      <SettingsHeader title="Page composition" sub="Defaults for how each page is treated by downstream stages. Can be overridden per page in the page workbench." />
      <SettingsCard>
        <SettingsRow first label="Running headers & folio" sub="Headers, running titles, and page numbers at the top/bottom of each page">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
              {[
                { id: 'strip-ocr', name: 'Strip from OCR',  tone: 'default' },
                { id: 'fully',     name: 'Fully strip',      tone: 'warn' },
                { id: 'keep',      name: 'Keep',             tone: 'plain' },
                { id: 'per-page',  name: 'Per page',         tone: 'plain' },
              ].map((v, i) => {
                const a = i === 0;
                return (
                  <div key={v.id} style={{
                    padding: '4px 12px', borderRadius: 5,
                    background: a ? 'var(--bg-surface)' : 'transparent',
                    boxShadow: a ? '0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)' : 'none',
                    color: a ? 'var(--ink-1)' : 'var(--ink-3)',
                    fontSize: 12, fontWeight: a ? 600 : 500, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    {v.tone === 'warn' ? (
                      <Icon name="alert" size={11} style={{ color: a ? 'var(--mismatch)' : 'var(--fuzzy)' }} />
                    ) : null}
                    {v.name}
                    {v.tone === 'default' && a ? (
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--exact)', textTransform: 'uppercase', letterSpacing: '.06em' }}>recommended</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {/* Explainer for the current choice */}
            <div style={{
              fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5,
              maxWidth: 520, paddingLeft: 2,
            }}>
              <b style={{ color: 'var(--ink-2)' }}>Strip from OCR</b> hides headers and folios from OCR so they don't pollute the text,
              but keeps them on the source page so proofreaders can still see every printed word.
              {' '}<a style={{ color: 'var(--ink-3)', textDecoration: 'underline', cursor: 'pointer' }}>Per-page override</a> in the page workbench.
            </div>
            {/* Warning block — visible when 'Fully strip' is the choice. Static
                in this canvas; would only render when that option is active. */}
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              border: '1px solid color-mix(in oklab, var(--mismatch) 40%, var(--border-1))',
              background: 'color-mix(in oklab, var(--mismatch) 6%, var(--bg-surface))',
              display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: 520,
            }}>
              <Icon name="alert" size={13} style={{ color: 'var(--mismatch)', marginTop: 2, flex: '0 0 auto' }} />
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                <b style={{ color: 'var(--mismatch)' }}>Fully strip</b> removes headers and folios from the rendered page too.
                <b style={{ color: 'var(--ink-1)' }}> Not PGDP-compliant</b> — every printed word should appear in the source image
                the proofreader sees. Use only for non-PGDP exports.
              </div>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow label="Column layout" sub="Single column · expected for body text">
          <Badge tone="neutral" mono>single column</Badge>
        </SettingsRow>
        <SettingsRow label="Sidenotes" sub="Marginal notes alongside body text">
          <Toggle on={false} />
        </SettingsRow>
      </SettingsCard>
    </div>
  </>
);

/* ============================================================
   Stage defaults — per-stage defaults + preset library
============================================================ */
const ProjectSettings_StageDefaults = ({ selectedStage = 'source' }) => {
  const stageList = [
    { id: 'source',        name: 'Source',        modified: true,  preset: 'IA / JP2 archive scans' },
    { id: 'grayscale',     name: 'Grayscale',     modified: true,  preset: 'Perceptual · auto-detect' },
    { id: 'initial_crop',  name: 'Initial crop',  modified: false, preset: 'Standard' },
    { id: 'dewarp',        name: 'Dewarp',        modified: false, preset: 'Standard' },
    { id: 'deskew',        name: 'Deskew',        modified: false, preset: 'Standard' },
    { id: 'threshold',     name: 'Threshold',     modified: false, preset: 'Otsu · low cutoff' },
    { id: 'denoise',       name: 'Denoise',       modified: false, preset: 'Built-in default' },
    { id: 'ocr',           name: 'OCR',           modified: true,  preset: 'Tesseract · LSTM · eng' },
    { id: 'spellcheck',    name: 'Spellcheck',    modified: false, preset: 'Standard + project dict' },
    { id: 'text_review',   name: 'Text review',   modified: false, preset: 'Standard' },
    { id: 'hyphen_join',   name: 'Hyphen join',   modified: false, preset: 'Standard + global library' },
    { id: 'regex',         name: 'Regex',         modified: false, preset: 'PGDP / 19c-essays' },
    { id: 'build_package', name: 'Build package', modified: false, preset: 'PGDP 2024.3' },
  ];

  return (
    <>
      <SettingsHeader
        title="Stage defaults"
        sub="Per-stage defaults for this project. Each stage starts from the built-in default; presets let you swap in a saved config quickly."
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="default" size="sm" icon="download">Import preset…</Button>
            <Button variant="default" size="sm" icon="refresh">Reset all to built-in</Button>
          </div>
        }
      />

      <div style={{
        display: 'grid', gridTemplateColumns: '260px 1fr',
        gap: 14, minHeight: 500,
      }}>
        {/* Stage list */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          overflow: 'hidden', alignSelf: 'start',
        }}>
          <div style={{
            padding: '8px 12px', background: 'var(--bg-page)',
            borderBottom: '1px solid var(--border-1)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span className="label" style={{ color: 'var(--ink-3)' }}>Stages</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
              {stageList.filter(s => s.modified).length} modified
            </span>
          </div>
          {stageList.map(s => {
            const a = s.id === selectedStage;
            return (
              <div key={s.id} style={{
                padding: '9px 12px',
                background: a ? 'var(--bg-raised)' : 'transparent',
                borderLeft: a ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.modified ? (
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--fuzzy)' }} />
                  ) : null}
                  <span style={{ fontSize: 12.5, fontWeight: a ? 600 : 500, color: 'var(--ink-1)' }}>{s.name}</span>
                  {s.modified ? (
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--fuzzy)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      modified
                    </span>
                  ) : null}
                </div>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{s.preset}</span>
              </div>
            );
          })}
        </div>

        {/* Right pane — selected stage editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Preset chooser */}
          <SettingsCard>
            <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Icon name="sparkles" size={14} style={{ color: 'var(--ink-3)' }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>Source — preset</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--fuzzy)', textTransform: 'uppercase', letterSpacing: '.06em' }}>modified</span>
              <div style={{
                flex: 1, minWidth: 240, height: 28, padding: '0 10px',
                background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>
                  IA / JP2 archive scans
                </span>
                <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
              </div>
              <Button variant="default" size="sm" icon="plus">Save as preset…</Button>
              <Button variant="default" size="sm" icon="refresh">Reset to built-in</Button>
            </div>
          </SettingsCard>

          {/* Settings (same shape as the per-stage Step settings panel) */}
          <SettingsCard>
            <SettingsRow first label="Thumbnail quality" sub="Higher quality → larger cache + slower generation">
              <div style={{ display: 'inline-flex', padding: 3, background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7 }}>
                {['Fast', 'Standard', 'High'].map((v, i) => {
                  const a = i === 1;
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
            </SettingsRow>
            <SettingsRow label="Concurrent workers" sub="How many thumbnails to generate at once">
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
            </SettingsRow>
            <SettingsRow label="Auto-confirm selection" sub="Skip manual confirmation once selection is mostly done">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle on={false} />
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  When fewer than <span className="mono" style={{ color: 'var(--ink-1)', fontWeight: 600 }}>5%</span> unmarked
                </span>
              </div>
            </SettingsRow>
          </SettingsCard>

          {/* Preset library */}
          <SettingsCard>
            <div style={{
              padding: '10px 14px', background: 'var(--bg-page)',
              borderBottom: '1px solid var(--border-1)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span className="label" style={{ color: 'var(--ink-2)' }}>Source · preset library</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>2 built-in · 3 saved</span>
            </div>
            {[
              { name: 'Standard',                 sub: 'built-in default',           date: '—',           current: false },
              { name: 'High quality archive',     sub: 'built-in · 4× workers · High', date: '—',         current: false },
              { name: 'IA / JP2 archive scans',   sub: 'saved · jsmith',             date: 'Apr 22 2026', current: true },
              { name: 'HathiTrust folder dumps',  sub: 'saved · jsmith',             date: 'Mar 14 2026', current: false },
              { name: 'Google Books PDF strip',   sub: 'saved · team-leads',         date: 'Feb 28 2026', current: false },
            ].map((p, i) => (
              <div key={p.name} style={{
                display: 'grid', gridTemplateColumns: '1fr 160px 100px 28px',
                gap: 12, padding: '10px 14px', alignItems: 'center',
                borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
              }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {p.name}
                    {p.current ? <Badge tone="brand" mono>current</Badge> : null}
                  </div>
                  <div className="mono" style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)' }}>{p.sub}</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{p.date}</span>
                <Button variant={p.current ? 'ghost' : 'default'} size="sm" disabled={p.current}>
                  {p.current ? 'Applied' : 'Apply'}
                </Button>
                <Icon name="moreH" size={14} style={{ color: 'var(--ink-4)', cursor: 'pointer' }} />
              </div>
            ))}
          </SettingsCard>
        </div>
      </div>
    </>
  );
};

/* ============================================================
   Members — single-user v1 with a hint at multi-user
============================================================ */
const ProjectSettings_Members = () => (
  <>
    <SettingsHeader
      title="Members"
      sub="People with access to this project. Sharing is single-user in this release; multi-user collaboration is planned."
      action={<Button variant="default" size="sm" icon="plus" disabled>Invite member</Button>}
    />
    <SettingsCard>
      <div style={{
        display: 'grid', gridTemplateColumns: '32px 1fr 100px 100px 28px',
        gap: 12, padding: '12px 14px', alignItems: 'center',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 99,
          background: 'var(--bg-raised)', border: '1px solid var(--border-2)',
          display: 'grid', placeItems: 'center', color: 'var(--ink-2)',
          fontSize: 11, fontWeight: 600,
        }}>JS</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>jsmith <Badge tone="neutral" mono>you</Badge></div>
          <div className="mono" style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)' }}>local user · created project</div>
        </div>
        <Badge tone="brand" mono>owner</Badge>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>full access</span>
        <Icon name="moreH" size={14} style={{ color: 'var(--ink-4)', cursor: 'pointer' }} />
      </div>
    </SettingsCard>
    <div style={{
      marginTop: 14, padding: '12px 16px',
      borderRadius: 8, border: '1px dashed var(--border-2)',
      fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55,
    }}>
      <Icon name="info" size={13} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--ink-4)' }} />
      Multi-user collaboration is on the roadmap. Until then, share projects by exporting an archive
      (<span className="mono">Project settings → Storage & cleanup → Save a copy</span>) and importing on another machine.
    </div>
  </>
);

/* ============================================================
   Storage & cleanup — disk usage by stage + cleanup actions
============================================================ */
const ProjectSettings_Storage = () => (
  <>
    <SettingsHeader
      title="Storage & cleanup"
      sub="Disk used by this project, broken down by stage. Clean intermediate artifacts safely; the final package is preserved."
      action={<Badge tone="neutral" mono>1.84 GB total</Badge>}
    />

    <SettingsCard>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>Disk usage by stage</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>1.84 GB · 23 stages</span>
        </div>
        <div style={{
          height: 10, borderRadius: 99, overflow: 'hidden',
          background: 'var(--bg-sunk)',
          display: 'flex',
        }}>
          {[
            { id: 'source',    pct: 32, color: 'var(--accent)' },
            { id: 'crop',      pct: 11, color: 'var(--ocr)' },
            { id: 'image',     pct: 24, color: 'var(--exact)' },
            { id: 'ocr',       pct: 14, color: 'var(--fuzzy)' },
            { id: 'review',    pct: 8,  color: 'var(--gt)' },
            { id: 'package',   pct: 11, color: 'var(--ink-3)' },
          ].map(s => (
            <div key={s.id} title={`${s.id} · ${s.pct}%`} style={{ width: `${s.pct}%`, background: s.color }} />
          ))}
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: 'var(--ink-3)' }}>
          {[
            { id: 'source · 596 MB',   color: 'var(--accent)' },
            { id: 'crops · 205 MB',    color: 'var(--ocr)' },
            { id: 'images · 446 MB',   color: 'var(--exact)' },
            { id: 'ocr · 261 MB',      color: 'var(--fuzzy)' },
            { id: 'review · 149 MB',   color: 'var(--gt)' },
            { id: 'package · 205 MB',  color: 'var(--ink-3)' },
          ].map(s => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              <span className="mono">{s.id}</span>
            </span>
          ))}
        </div>
      </div>
    </SettingsCard>

    <div style={{ marginTop: 24 }}>
      <SettingsHeader title="Cleanup actions" sub="Same actions as the Projects page Manage tab. Final package is always preserved." />
      <SettingsCard>
        {[
          {
            icon: 'sparkles',
            title: 'Clean intermediate artifacts',
            desc: 'Drop stage outputs that can be re-derived automatically (crops, OCR, dewarped images).',
            meta: 'reclaim 1.62 GB',
            cta: 'Clean',
            variant: 'default',
          },
          {
            icon: 'archive',
            title: 'Archive project',
            desc: 'Zip the project in place and mark it read-only. Stays in the Projects list under Archived.',
            meta: '→ 24.8 MB zipped',
            cta: 'Archive',
            variant: 'default',
          },
          {
            icon: 'download',
            title: 'Save a copy…',
            desc: 'Download a zip of the full project to a different location. The original remains untouched.',
            meta: '~24.8 MB',
            cta: 'Save copy',
            variant: 'default',
          },
        ].map((a, i) => (
          <div key={a.title} style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 160px 110px',
            gap: 14, padding: '14px 16px', alignItems: 'center',
            borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'var(--bg-raised)', color: 'var(--ink-2)',
              display: 'grid', placeItems: 'center',
            }}>
              <Icon name={a.icon} size={14} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{a.title}</div>
              <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>{a.desc}</div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right' }}>{a.meta}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant={a.variant} size="sm">{a.cta}</Button>
            </div>
          </div>
        ))}
      </SettingsCard>
    </div>
  </>
);

/* ============================================================
   Danger zone — the irreversible stuff
============================================================ */
const ProjectSettings_Danger = () => (
  <>
    <SettingsHeader
      title="Danger zone"
      sub="Irreversible operations. Delete is two-step: from an active project, Delete cleans + archives; only an archived project can be permanently deleted."
    />
    <SettingsCard>
      <div style={{
        display: 'grid', gridTemplateColumns: '28px 1fr 200px 150px',
        gap: 14, padding: '14px 16px', alignItems: 'center',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'color-mix(in oklab, var(--fuzzy) 12%, transparent)',
          color: 'var(--fuzzy)', display: 'grid', placeItems: 'center',
        }}>
          <Icon name="trash" size={14} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Delete project</div>
          <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>
            Cleans intermediate artifacts and archives the project. Run delete again from the archived state to remove it permanently.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--fuzzy)', textAlign: 'right' }}>step 1 of 2 · → archived</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="default" size="sm">Delete…</Button>
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '28px 1fr 200px 150px',
        gap: 14, padding: '14px 16px', alignItems: 'center',
        borderTop: '1px solid var(--border-1)',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'color-mix(in oklab, var(--fuzzy) 12%, transparent)',
          color: 'var(--fuzzy)', display: 'grid', placeItems: 'center',
        }}>
          <Icon name="refresh" size={14} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Reset project</div>
          <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>
            Discard all stage outputs and selections; return to immediately-after-import state. Source files are kept.
            A recovery checkpoint is saved for 7 days — run reset a second time to discard it permanently.
          </div>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--fuzzy)', textAlign: 'right' }}>step 1 of 2 · → checkpoint</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="default" size="sm">Reset…</Button>
        </div>
      </div>
    </SettingsCard>
  </>
);

Object.assign(window, {
  ProjectSettings_Bibliographic, ProjectSettings_PGDP, ProjectSettings_Format,
  ProjectSettings_StageDefaults, ProjectSettings_Members, ProjectSettings_Storage,
  ProjectSettings_Danger,
  SettingsHeader, SettingsCard, SettingsRow, Toggle, FieldRow,
});
