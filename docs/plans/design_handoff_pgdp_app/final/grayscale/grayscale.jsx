// grayscale.jsx — Perceptual Grayscale stage (stage 2).
// Three tab bodies — overview, pages, step settings — adapted from the
// wf11 workbench (which targets the Page Workbench's StageControlsPanel)
// to render full-width inside the final PipelineTemplate.

const { useState: useSG, useMemo: useMG } = React;

/* ====================================================================
   Estimation helpers — same model as wf11
   GPU ≈ 0.18 s/MP (CUDA-backed neighbourhood sampler)
   CPU ≈ 2.5  s/MP (numpy fallback, single-threaded)
==================================================================== */

const SAMPLE_PAGE_GS = { w: 2364, h: 3568 };          // typical book scan
const PROJECT_PAGES_GS = 232;
const STANDARD_TIME_GS = '<1s';

const estimatePerceptualSecGS = ({ w, h, backend }) => {
  const mp = (w * h) / 1_000_000;
  const rate = backend === 'gpu' ? 0.18 : 2.5;
  return mp * rate;
};

const fmtSecGS = (s) => {
  if (s < 10) return `~${s.toFixed(1)}s`;
  if (s < 60) return `~${Math.round(s)}s`;
  const m = Math.floor(s / 60), rem = Math.round(s - m * 60);
  return rem ? `~${m}m ${rem}s` : `~${m}m`;
};

const fmtProjectTotalGS = (perPageSec, n) => {
  const total = perPageSec * n;
  if (total < 90) return `${Math.round(total)}s`;
  if (total < 3600) return `${Math.round(total / 60)}m`;
  return `${(total / 3600).toFixed(1)}h`;
};

/* ====================================================================
   Backend chip — pill that surfaces the runtime that's actually
   executing the perceptual sampler. GPU = exact-green, CPU = fuzzy-amber.
==================================================================== */

const BackendChip = ({ backend = 'gpu', compact = false }) => {
  const isGpu = backend === 'gpu';
  const color = isGpu ? 'var(--exact)' : 'var(--fuzzy)';
  const label = isGpu ? 'GPU · CUDA' : 'CPU · numpy';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: compact ? '1px 7px' : '2px 8px',
      height: compact ? 18 : 22,
      borderRadius: 99,
      background: `color-mix(in oklab, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in oklab, ${color} 35%, var(--border-1))`,
      color, fontSize: compact ? 10 : 11, fontWeight: 600,
      fontFamily: 'var(--mono-font, monospace)',
      letterSpacing: '.02em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
    </span>
  );
};

/* ====================================================================
   Auto-detect banner — top of the Step Settings panel.
   "We looked at the source and picked perceptual / standard for you."
==================================================================== */

const AutoDetectBanner = ({ backend = 'gpu', detected = 'perceptual', why = 'newsprint · low contrast · low DPI' }) => {
  const sec = estimatePerceptualSecGS({ ...SAMPLE_PAGE_GS, backend });
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
      padding: '12px 14px', borderRadius: 8,
      background: 'color-mix(in oklab, var(--accent) 6%, var(--bg-surface))',
      border: '1px solid color-mix(in oklab, var(--accent) 35%, var(--border-1))',
      alignItems: 'center',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7,
          background: 'color-mix(in oklab, var(--accent) 16%, var(--bg-surface))',
          color: 'var(--accent)', display: 'grid', placeItems: 'center', flex: '0 0 auto',
        }}>
          <Icon name="sparkles" size={15} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
            Auto-detected source profile
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            Picked <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{detected}</span> from a
            sample of 8 pages · <span className="mono" style={{ color: 'var(--ink-2)' }}>{why}</span>.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end' }}>
        <BackendChip backend={backend} />
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
            project · {PROJECT_PAGES_GS} pages
          </div>
          <div className="mono" style={{ fontSize: 13, color: 'var(--ink-1)', fontWeight: 600, marginTop: 2 }}>
            {fmtSecGS(sec)}/page · ~{fmtProjectTotalGS(sec, PROJECT_PAGES_GS)} total
          </div>
        </div>
        <Button variant="ghost" size="sm" icon="refresh">Re-detect</Button>
      </div>
    </div>
  );
};

/* ====================================================================
   Mode card — full-width two-up chooser.
   `kind` ∈ 'standard' | 'perceptual' · `selected` for the active one.
==================================================================== */

const ModeCard = ({ kind, selected, backend = 'gpu' }) => {
  const isPerc = kind === 'perceptual';
  const accent = isPerc ? 'var(--accent)' : 'var(--exact)';
  const sec = estimatePerceptualSecGS({ ...SAMPLE_PAGE_GS, backend });
  const time = isPerc ? fmtSecGS(sec) : STANDARD_TIME_GS;
  const timeTone = isPerc ? (backend === 'gpu' ? 'var(--fuzzy)' : 'var(--mismatch)') : 'var(--exact)';

  return (
    <div style={{
      flex: 1, padding: '14px 16px', borderRadius: 8,
      border: `1.5px solid ${selected ? accent : 'var(--border-1)'}`,
      background: selected
        ? `color-mix(in oklab, ${accent} 6%, var(--bg-surface))`
        : 'var(--bg-surface)',
      display: 'flex', flexDirection: 'column', gap: 10,
      position: 'relative',
      cursor: 'pointer',
    }}>
      {selected ? (
        <span style={{
          position: 'absolute', top: 12, right: 12,
          width: 18, height: 18, borderRadius: 99,
          background: accent, color: '#fff',
          display: 'grid', placeItems: 'center',
        }}>
          <Icon name="check" size={10} stroke={2.5} />
        </span>
      ) : null}

      {/* Header row */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>
            {isPerc ? 'Perceptual' : 'Standard'}
          </span>
          {isPerc ? (
            <span className="mono" style={{
              padding: '1px 6px', borderRadius: 4,
              background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
              color: 'var(--accent)', fontSize: 10, fontWeight: 600, letterSpacing: '.04em',
            }}>recommended</span>
          ) : null}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {isPerc
            ? 'Neighbourhood-sampled. Preserves local contrast — gives downstream stages a much cleaner signal on newsprint and faded books.'
            : 'Luma-weighted (0.299R + 0.587G + 0.114B). The fastest path. Fine for clean modern scans.'}
        </div>
      </div>

      {/* Algorithm + cost */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        padding: '8px 10px', borderRadius: 6,
        background: 'var(--bg-page)', border: '1px solid var(--border-1)',
      }}>
        <div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            algorithm
          </div>
          <div className="mono" style={{ marginTop: 3, fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>
            {isPerc ? 'np_uint8_color_to_gray' : 'cv2.cvtColor · BGR2GRAY'}
          </div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            ~/page
          </div>
          <div className="mono" style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600, color: timeTone }}>
            {time}
          </div>
        </div>
      </div>

      {/* Tiny preview strip — synthesised gradient that mimics local contrast. */}
      <div style={{
        height: 38, borderRadius: 4,
        background: isPerc
          ? 'linear-gradient(90deg, oklch(0.92 0 0) 0%, oklch(0.85 0 0) 20%, oklch(0.78 0 0) 35%, oklch(0.66 0 0) 50%, oklch(0.55 0 0) 70%, oklch(0.40 0 0) 100%)'
          : 'linear-gradient(90deg, oklch(0.92 0 0) 0%, oklch(0.84 0 0) 30%, oklch(0.66 0 0) 60%, oklch(0.46 0 0) 100%)',
        border: '1px solid var(--border-1)',
        position: 'relative',
      }}>
        <span className="mono" style={{
          position: 'absolute', top: 4, left: 6, fontSize: 9, color: 'rgba(0,0,0,.4)',
          letterSpacing: '.04em', textTransform: 'uppercase',
        }}>preview · histogram</span>
      </div>
    </div>
  );
};

/* ====================================================================
   Advanced params — collapsible row of perceptual-only sliders.
==================================================================== */

const AdvancedParams = ({ open = true }) => (
  <div style={{
    borderRadius: 8, border: '1px solid var(--border-1)',
    background: 'var(--bg-surface)', overflow: 'hidden',
  }}>
    <div style={{
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: open ? '1px solid var(--border-1)' : 'none',
      cursor: 'pointer',
    }}>
      <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: 'var(--ink-3)' }} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>Advanced · perceptual params</span>
      <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
        sampler radius, gamma, output range — defaults usually fine
      </span>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" icon="refresh">Reset to defaults</Button>
    </div>
    {open ? (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
      }}>
        {[
          {
            label: 'Sampler radius',
            sub: 'Size of neighbourhood (px) sampled per output pixel. Larger = smoother, more cost.',
            val: 3, min: 1, max: 9, unit: 'px',
          },
          {
            label: 'Gamma',
            sub: 'Output gamma curve. <1 brightens shadows, >1 deepens them.',
            val: 1.10, min: 0.5, max: 2.0, unit: '',
          },
          {
            label: 'Output range',
            sub: 'Linear stretch applied after sampling. Compress the tails for cleaner thresholding.',
            val: '12 – 248', min: 0, max: 255, unit: '',
          },
        ].map((row, i) => (
          <div key={row.label} style={{
            padding: '12px 14px',
            borderLeft: i === 0 ? 'none' : '1px solid var(--border-1)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>{row.label}</div>
              <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>{row.sub}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                flex: 1, height: 4, borderRadius: 99,
                background: 'var(--border-2)', position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', inset: '0 auto 0 0',
                  width: typeof row.val === 'number'
                    ? `${((row.val - row.min) / (row.max - row.min)) * 100}%`
                    : '46%',
                  background: 'var(--accent)', borderRadius: 99,
                }} />
                <div style={{
                  position: 'absolute', top: -4,
                  left: typeof row.val === 'number'
                    ? `calc(${((row.val - row.min) / (row.max - row.min)) * 100}% - 6px)`
                    : 'calc(46% - 6px)',
                  width: 12, height: 12, borderRadius: 99, background: 'var(--accent)',
                  boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                }} />
              </div>
              <span className="mono" style={{
                fontSize: 11.5, fontWeight: 600, color: 'var(--ink-1)',
                minWidth: 64, textAlign: 'right',
              }}>
                {row.val}{row.unit}
              </span>
            </div>
          </div>
        ))}
      </div>
    ) : null}
  </div>
);

/* ====================================================================
   Subhead — sits below the tab bar.
==================================================================== */

const GrayscaleSubhead = ({ title, sub, right }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    padding: '18px 28px 0', gap: 14,
  }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.005em' }}>
        {title}
      </div>
      <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        {sub}
      </div>
    </div>
    {right ? (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto' }}>
        {right}
      </div>
    ) : null}
  </div>
);

const GrayscaleBody = ({ children, gap = 14 }) => (
  <div style={{
    padding: '14px 28px 28px',
    display: 'flex', flexDirection: 'column', gap,
    flex: 1, minHeight: 0,
  }}>
    {children}
  </div>
);

/* ====================================================================
   Overview tab
==================================================================== */

const GrayscaleStatTile = ({ value, label, tone = 'var(--ink-1)' }) => (
  <div style={{
    flex: 1, padding: '14px 16px',
    background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
  }}>
    <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: tone, letterSpacing: '-0.01em' }}>
      {value}
    </div>
    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
      {label}
    </div>
  </div>
);

const GrayscaleOverview = ({ backend = 'gpu' }) => {
  const sec = estimatePerceptualSecGS({ ...SAMPLE_PAGE_GS, backend });
  return (
    <>
      <GrayscaleSubhead
        title="Perceptual grayscale · overview"
        sub="Converts every cropped scan to grayscale. Auto-picks perceptual for newsprint and faded books, standard for clean modern scans. Runs once per page; cached for every downstream stage."
        right={<BackendChip backend={backend} />}
      />
      <GrayscaleBody>
        {/* Stat row */}
        <div style={{ display: 'flex', gap: 12 }}>
          <GrayscaleStatTile value="232" label="pages converted" tone="var(--exact)" />
          <GrayscaleStatTile value="198" label="perceptual mode" tone="var(--accent)" />
          <GrayscaleStatTile value="34"  label="standard mode" tone="var(--ink-2)" />
          <GrayscaleStatTile value={fmtSecGS(sec)} label="avg / page" />
          <GrayscaleStatTile value={fmtProjectTotalGS(sec, PROJECT_PAGES_GS)} label="project total" />
        </div>

        {/* Auto-detect summary */}
        <AutoDetectBanner backend={backend} />

        {/* What's next */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          padding: '14px 16px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 10 }}>
            What lands downstream
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              {
                stage: 'crop',
                via: 'edge detection on grayscale',
                detail: 'Perceptual output gives the auto-crop a much cleaner gradient signal on faded covers.',
              },
              {
                stage: 'threshold',
                via: 'Sauvola / adaptive',
                detail: 'Local-window thresholders feed off this stage directly. Bad input here = speckle everywhere.',
              },
              {
                stage: 'ocr',
                via: 'preprocessed page',
                detail: 'Tesseract gets the grayscale tensor; cleaner gradients = fewer scannos.',
              },
            ].map(s => (
              <div key={s.stage} style={{
                background: 'var(--bg-page)', border: '1px solid var(--border-1)', borderRadius: 7,
                padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{
                    padding: '2px 7px', borderRadius: 4,
                    background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
                    fontSize: 11, fontWeight: 600, color: 'var(--ink-1)',
                  }}>{s.stage}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.via}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{s.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </GrayscaleBody>
    </>
  );
};

/* ====================================================================
   Pages tab — grid of grayscale thumbs, with mode + cost per page.
==================================================================== */

const GrayThumb = ({ tone = 0.86, mode = 'perceptual', label }) => {
  // tone: 0..1 lightness in oklch. mode controls the local-contrast hint.
  const paper = `oklch(${tone} 0 0)`;
  const inkTone = Math.max(0.20, tone - 0.55);
  const ink = `oklch(${inkTone} 0 0)`;
  return (
    <div style={{
      width: 116, height: 152, borderRadius: 3, position: 'relative', overflow: 'hidden',
      background: paper, boxShadow: 'inset 0 0 0 1px rgba(40,40,40,0.15)',
    }}>
      {/* Mottled grayscale "page" — paper grain + scanner shadow */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage:
          `radial-gradient(ellipse at top, oklch(${tone + 0.04} 0 0) 0%, transparent 50%),
           radial-gradient(ellipse at bottom right, oklch(${tone - 0.04} 0 0) 0%, transparent 60%)`,
      }} />
      {/* Faint ink lines */}
      <div style={{
        position: 'absolute', inset: '14% 14% 14% 14%',
        backgroundImage: mode === 'perceptual'
          ? `repeating-linear-gradient(to bottom, ${ink} 0 1.2px, transparent 1.2px 6px)`
          : `repeating-linear-gradient(to bottom, ${ink} 0 1.6px, transparent 1.6px 6px)`,
        opacity: mode === 'perceptual' ? 0.7 : 0.55,
      }} />
      {/* Page number stripe */}
      <div style={{
        position: 'absolute', left: '40%', right: '40%', bottom: '7%',
        height: 2, background: ink, opacity: 0.55,
      }} />
      {/* Page label */}
      <div style={{
        position: 'absolute', top: 4, right: 4,
        fontFamily: 'var(--mono-font, monospace)', fontSize: 9, color: 'oklch(0.32 0 0)',
      }}>{label}</div>
    </div>
  );
};

const ModePill = ({ mode }) => {
  const isPerc = mode === 'perceptual';
  const color = isPerc ? 'var(--accent)' : 'var(--ink-3)';
  const bg = isPerc ? `color-mix(in oklab, ${color} 14%, transparent)` : 'var(--bg-raised)';
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 6px', height: 16, borderRadius: 3,
      background: bg, border: `1px solid color-mix(in oklab, ${color} 30%, var(--border-1))`,
      color, fontSize: 9.5, fontWeight: 600, letterSpacing: '.04em',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: color }} />
      {isPerc ? 'perceptual' : 'standard'}
    </span>
  );
};

// 24 representative pages for the grid.
const GRAY_PAGES = (() => {
  // Mostly perceptual, occasional standard. Mix of tones.
  const tones = [0.92, 0.88, 0.84, 0.80, 0.78, 0.82, 0.86, 0.90];
  const modes = (i) => (i === 3 || i === 11 || i === 17 || i === 22) ? 'standard' : 'perceptual';
  return Array.from({ length: 24 }, (_, i) => ({
    id: String(i + 1).padStart(3, '0'),
    tone: tones[i % tones.length] - (i * 0.003),
    mode: modes(i),
  }));
})();

const GrayscalePages = ({ state = 'done', backend = 'gpu', filter = 'all' }) => {
  const sec = estimatePerceptualSecGS({ ...SAMPLE_PAGE_GS, backend });
  const pages = filter === 'standard' ? GRAY_PAGES.filter(p => p.mode === 'standard') : GRAY_PAGES;

  return (
    <>
      <GrayscaleSubhead
        title="Pages · grayscale output"
        sub={state === 'running'
          ? `Converting · ${Math.round(GRAY_PAGES.length * 0.72)} / ${GRAY_PAGES.length} pages — ${fmtSecGS(sec)} per page on ${backend === 'gpu' ? 'GPU' : 'CPU'}.`
          : 'Every page converted. Auto-picked the cheaper standard mode where it could; perceptual where the source needed it.'}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <BackendChip backend={backend} />
            <Divider vertical style={{ height: 22 }} />
            {[
              { id: 'all', label: 'All', count: GRAY_PAGES.length },
              { id: 'perceptual', label: 'Perceptual', count: GRAY_PAGES.filter(p => p.mode === 'perceptual').length },
              { id: 'standard', label: 'Standard', count: GRAY_PAGES.filter(p => p.mode === 'standard').length },
            ].map(f => {
              const active = filter === f.id;
              return (
                <span key={f.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 9px', height: 24, borderRadius: 6,
                  background: active ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : 'transparent',
                  border: active
                    ? '1px solid color-mix(in oklab, var(--accent) 45%, var(--border-1))'
                    : '1px solid var(--border-1)',
                  color: active ? 'var(--accent)' : 'var(--ink-2)',
                  fontSize: 11.5, fontWeight: active ? 600 : 500, cursor: 'pointer',
                }}>
                  {f.label}
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{f.count}</span>
                </span>
              );
            })}
          </div>
        }
      />
      <GrayscaleBody>
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          padding: 18, flex: 1, minHeight: 0, overflow: 'auto',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 14,
          }}>
            {pages.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <GrayThumb tone={p.tone} mode={p.mode} label={`p${p.id}`} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>p{p.id}</span>
                  <ModePill mode={p.mode} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </GrayscaleBody>
    </>
  );
};

/* ====================================================================
   Step settings — the meat. Adapted from wf11 BodyF.
==================================================================== */

/* ====================================================================
   Step settings — IS the per-page workbench.
   Two-pane layout: stage controls drawer + page viewer with before/after.
   Tweaking the controls re-renders the viewer; Apply & Run commits.
==================================================================== */

/* --------- Compact, stacked rows for advanced params (fits the drawer) --------- */
const AdvancedParamsStacked = () => (
  <div style={{
    borderRadius: 7, border: '1px solid var(--border-1)',
    background: 'var(--bg-surface)', overflow: 'hidden',
  }}>
    <div style={{
      padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: '1px solid var(--border-1)',
    }}>
      <Icon name="chevD" size={11} style={{ color: 'var(--ink-3)' }} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-1)' }}>Advanced · perceptual</span>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" size="sm" icon="refresh">Reset</Button>
    </div>
    {[
      { label: 'Sampler radius', val: 3, min: 1, max: 9, unit: 'px' },
      { label: 'Gamma',          val: 1.10, min: 0.5, max: 2.0, unit: '' },
      { label: 'Output range',   val: '12 – 248', pct: 0.92, unit: '' },
    ].map((row, i) => {
      const pct = row.pct != null
        ? row.pct
        : (row.val - row.min) / (row.max - row.min);
      return (
        <div key={row.label} style={{
          padding: '8px 12px',
          borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{row.label}</span>
            <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-1)' }}>
              {row.val}{row.unit}
            </span>
          </div>
          <div style={{
            height: 3, borderRadius: 99, background: 'var(--border-2)', position: 'relative',
          }}>
            <div style={{
              position: 'absolute', inset: '0 auto 0 0',
              width: `${pct * 100}%`, background: 'var(--accent)', borderRadius: 99,
            }} />
            <div style={{
              position: 'absolute', top: -3.5,
              left: `calc(${pct * 100}% - 5px)`,
              width: 10, height: 10, borderRadius: 99, background: 'var(--accent)',
              boxShadow: '0 1px 2px rgba(0,0,0,.2)',
            }} />
          </div>
        </div>
      );
    })}
  </div>
);

/* --------- Compact mode chooser for the drawer (stacked, not side-by-side) --------- */
const ModeRowCompact = ({ kind, selected, backend = 'gpu' }) => {
  const isPerc = kind === 'perceptual';
  const accent = isPerc ? 'var(--accent)' : 'var(--exact)';
  const sec = estimatePerceptualSecGS({ ...SAMPLE_PAGE_GS, backend });
  const time = isPerc ? fmtSecGS(sec) : STANDARD_TIME_GS;
  const timeTone = isPerc ? (backend === 'gpu' ? 'var(--fuzzy)' : 'var(--mismatch)') : 'var(--exact)';
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 7,
      border: `1.5px solid ${selected ? accent : 'var(--border-1)'}`,
      background: selected
        ? `color-mix(in oklab, ${accent} 6%, var(--bg-surface))`
        : 'var(--bg-surface)',
      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
    }}>
      <span style={{
        width: 16, height: 16, borderRadius: 99,
        border: `1.5px solid ${selected ? accent : 'var(--border-2)'}`,
        background: selected ? accent : 'transparent',
        display: 'grid', placeItems: 'center', flex: '0 0 auto',
      }}>
        {selected ? <Icon name="check" size={9} stroke={2.5} style={{ color: '#fff' }} /> : null}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>
            {isPerc ? 'Perceptual' : 'Standard'}
          </span>
          {isPerc ? (
            <span className="mono" style={{
              padding: '0 5px', borderRadius: 3,
              background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
              color: 'var(--accent)', fontSize: 9, fontWeight: 600, letterSpacing: '.04em',
            }}>RECOMMENDED</span>
          ) : null}
        </div>
        <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
          {isPerc ? 'Neighbourhood-sampled · preserves local contrast' : 'Luma-weighted · fastest'}
        </div>
      </div>
      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: timeTone, flex: '0 0 auto' }}>
        {time}
      </span>
    </div>
  );
};

/* --------- Stage controls panel (left drawer) --------- */
const StageControlsLeft = ({ state, backend, pageId = 'p012', pageIdx = 23 }) => {
  const sec = estimatePerceptualSecGS({ ...SAMPLE_PAGE_GS, backend });
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert',
    label: 'Modified · 2 changes vs project default',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles',
    label: 'Using preset · Newsprint · pre-1920',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle',
    label: 'Using project default',
  };

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border-1)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div>
          <div style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--ink-4)',
          }}>Stage controls</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>grayscale</span>
            <span style={{
              padding: '1px 6px', borderRadius: 4,
              background: 'color-mix(in oklab, var(--fuzzy) 14%, transparent)',
              color: 'var(--fuzzy)',
              fontFamily: 'var(--mono-font, monospace)',
              fontSize: 9.5, fontWeight: 600, letterSpacing: '.04em',
            }}>DIRTY</span>
          </div>
        </div>
        <BackendChip backend={backend} compact />
      </div>

      {/* Scrollable body */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Inheritance pill row */}
        <div style={{
          padding: '8px 10px', borderRadius: 6,
          border: '1px solid color-mix(in oklab, ' + banner.tone + ' 40%, var(--border-1))',
          background: 'color-mix(in oklab, ' + banner.tone + ' 7%, var(--bg-surface))',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name={banner.icon} size={12} style={{ color: banner.tone, flex: '0 0 auto' }} />
          <span style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 500, flex: 1, minWidth: 0 }}>{banner.label}</span>
          {state === 'modified' ? (
            <Button variant="ghost" size="sm" icon="refresh">Revert</Button>
          ) : state === 'preset' ? (
            <Button variant="ghost" size="sm" icon="refresh">Reset</Button>
          ) : null}
        </div>

        {/* Auto-detect mini banner */}
        <div style={{
          padding: '10px 12px', borderRadius: 7,
          background: 'color-mix(in oklab, var(--accent) 6%, var(--bg-surface))',
          border: '1px solid color-mix(in oklab, var(--accent) 30%, var(--border-1))',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--accent)',
          }}>
            <Icon name="sparkles" size={11} />
            Auto-detected
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Picked <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>perceptual</span> from 8-page sample.
            <span className="mono" style={{ color: 'var(--ink-3)' }}> newsprint · low contrast · low DPI</span>
          </div>
          <div style={{
            marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 10.5,
          }}>
            <span className="mono" style={{ color: 'var(--ink-3)' }}>
              {fmtSecGS(sec)}/page · ~{fmtProjectTotalGS(sec, PROJECT_PAGES_GS)} total
            </span>
            <Button variant="ghost" size="sm" icon="refresh">Re-detect</Button>
          </div>
        </div>

        {/* CPU fallback warning if needed */}
        {backend === 'cpu' ? (
          <div style={{
            padding: '9px 10px', borderRadius: 6,
            background: 'color-mix(in oklab, var(--mismatch) 9%, var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--mismatch) 35%, var(--border-1))',
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.45,
          }}>
            <Icon name="alert" size={12} style={{ color: 'var(--mismatch)', marginTop: 2, flex: '0 0 auto' }} />
            <div>
              <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>No CUDA device.</span>{' '}
              Perceptual on CPU · <span className="mono">{fmtSecGS(sec)}/page</span>.
              <a style={{ color: 'var(--accent)', marginLeft: 4 }}>Switch to Standard</a>
            </div>
          </div>
        ) : null}

        {/* Mode chooser — stacked for the drawer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--ink-4)',
          }}>Grayscale mode</div>
          <ModeRowCompact kind="standard"  backend={backend} />
          <ModeRowCompact kind="perceptual" backend={backend} selected />
        </div>

        {/* Advanced params */}
        <AdvancedParamsStacked />

        {/* Cached note */}
        <div style={{
          padding: '7px 10px', borderRadius: 6,
          background: 'var(--bg-page)', border: '1px solid var(--border-1)',
          display: 'flex', alignItems: 'flex-start', gap: 7,
          fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.45,
        }}>
          <Icon name="info" size={11} style={{ color: 'var(--ink-4)', marginTop: 1, flex: '0 0 auto' }} />
          <span>
            Output cached per page. Downstream stages re-use the cached tensor — you only pay the conversion cost once.
          </span>
        </div>
      </div>

      {/* Sticky footer — save defaults */}
      {state === 'modified' ? (
        <div style={{
          padding: '10px 14px', borderTop: '1px solid var(--border-1)',
          background: 'var(--bg-surface)',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <Button variant="ghost" size="sm" icon="refresh">Revert</Button>
          <Button variant="primary" size="sm" icon="check">Save as default</Button>
        </div>
      ) : null}
    </div>
  );
};

/* --------- Big two-up page viewer with before/after --------- */
const PageRender = ({ tone = 0.82, isColor = false, mode = 'perceptual' }) => {
  // Color version uses warm-paper hues; grayscale version is desaturated.
  const paper = isColor ? 'oklch(0.88 0.04 75)' : `oklch(${tone} 0 0)`;
  const inkTone = Math.max(0.20, tone - 0.55);
  const ink = isColor ? 'oklch(0.30 0.04 60)' : `oklch(${inkTone} 0 0)`;
  const accent = isColor ? 'oklch(0.65 0.10 35)' : `oklch(${tone - 0.20} 0 0)`;

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: paper,
      boxShadow: 'inset 0 0 0 1px rgba(40,40,40,0.15), 0 4px 12px rgba(0,0,0,0.25)',
    }}>
      {/* Paper grain / scanner shadow */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: isColor
          ? `radial-gradient(ellipse at top, oklch(0.94 0.03 75) 0%, transparent 50%),
             radial-gradient(ellipse at bottom right, oklch(0.78 0.05 60) 0%, transparent 60%)`
          : `radial-gradient(ellipse at top, oklch(${tone + 0.05} 0 0) 0%, transparent 50%),
             radial-gradient(ellipse at bottom right, oklch(${tone - 0.05} 0 0) 0%, transparent 60%)`,
      }} />

      {/* "Page" content — title block, body, illustration suggestion */}
      <div style={{ position: 'absolute', inset: '8% 12%', display: 'flex', flexDirection: 'column', gap: '2%' }}>
        {/* Title rule */}
        <div style={{ height: 2, width: '40%', background: accent, opacity: 0.7, marginBottom: 6 }} />
        {/* Title text */}
        <div style={{ height: 18, width: '78%', background: ink, opacity: 0.85, borderRadius: 1 }} />
        <div style={{ height: 12, width: '52%', background: ink, opacity: 0.6, marginBottom: 14 }} />
        {/* Body lines */}
        {[...Array(14)].map((_, i) => (
          <div key={i} style={{
            height: mode === 'perceptual' ? 3 : 3.5,
            width: `${88 - (i % 4) * 7}%`,
            background: ink,
            opacity: mode === 'perceptual' ? 0.72 : 0.58,
          }} />
        ))}
        {/* Illustration block */}
        <div style={{
          marginTop: 14, height: 90, background: accent, opacity: 0.18, borderRadius: 2,
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', inset: 6, border: `1px dashed ${ink}`, opacity: 0.4 }} />
        </div>
        {/* Body lines tail */}
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            height: 3, width: `${85 - (i % 3) * 8}%`,
            background: ink, opacity: mode === 'perceptual' ? 0.7 : 0.55,
          }} />
        ))}
        {/* Page number */}
        <span style={{ marginTop: 'auto', textAlign: 'center', fontFamily: 'var(--mono-font, monospace)', fontSize: 10, color: ink, opacity: 0.7 }}>
          12
        </span>
      </div>
    </div>
  );
};

const PageViewer = ({ pageId = 'p012', mode = 'perceptual', backend = 'gpu' }) => {
  const sec = estimatePerceptualSecGS({ ...SAMPLE_PAGE_GS, backend });
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
    }}>
      {/* Viewer toolbar */}
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid var(--border-1)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>{pageId}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>·</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>23 / 232</span>
        </div>
        <Divider vertical style={{ height: 18 }} />
        {/* View-mode segmented toggle */}
        <div style={{
          display: 'inline-flex', padding: 2, gap: 2,
          background: 'var(--bg-page)', border: '1px solid var(--border-1)', borderRadius: 6,
        }}>
          {['Before', 'Split', 'After'].map((v, i) => (
            <span key={v} style={{
              padding: '4px 10px', borderRadius: 4,
              background: i === 1 ? 'var(--bg-surface)' : 'transparent',
              border: i === 1 ? '1px solid var(--border-2)' : '1px solid transparent',
              color: i === 1 ? 'var(--ink-1)' : 'var(--ink-3)',
              fontSize: 11, fontWeight: i === 1 ? 600 : 500, cursor: 'pointer',
            }}>{v}</span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
          this page · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmtSecGS(sec)}</span> · cached
        </span>
        <Divider vertical style={{ height: 18 }} />
        <Button variant="ghost" size="sm" icon="refresh">Re-run page</Button>
      </div>

      {/* Split-pane viewer */}
      <div style={{
        flex: 1, minHeight: 0,
        padding: 18,
        background: 'var(--bg-page)',
        display: 'grid', gridTemplateColumns: '1fr 8px 1fr', gap: 0,
      }}>
        {/* Before — color/source */}
        <div style={{ position: 'relative' }}>
          <PageRender tone={0.88} isColor />
          <span style={{
            position: 'absolute', top: 8, left: 8,
            padding: '2px 8px', borderRadius: 4,
            background: 'rgba(0,0,0,0.45)', color: '#fff',
            fontFamily: 'var(--mono-font, monospace)', fontSize: 10, fontWeight: 600,
            letterSpacing: '.04em',
          }}>BEFORE · source</span>
        </div>
        {/* Split handle */}
        <div style={{
          background: 'var(--border-2)', position: 'relative',
        }}>
          <span style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 22, height: 22, borderRadius: 99,
            background: 'var(--bg-surface)', border: '1px solid var(--border-2)',
            display: 'grid', placeItems: 'center', cursor: 'col-resize',
            color: 'var(--ink-3)', fontSize: 10,
          }}>
            <Icon name="arrowUpDown" size={11} style={{ transform: 'rotate(90deg)' }} />
          </span>
        </div>
        {/* After — grayscale output */}
        <div style={{ position: 'relative' }}>
          <PageRender tone={0.82} mode={mode} />
          <span style={{
            position: 'absolute', top: 8, left: 8,
            padding: '2px 8px', borderRadius: 4,
            background: 'rgba(0,0,0,0.55)', color: '#fff',
            fontFamily: 'var(--mono-font, monospace)', fontSize: 10, fontWeight: 600,
            letterSpacing: '.04em',
          }}>AFTER · {mode}</span>
          <span style={{
            position: 'absolute', top: 8, right: 8,
            padding: '2px 8px', borderRadius: 4,
            background: 'color-mix(in oklab, var(--accent) 90%, black)', color: '#fff',
            fontFamily: 'var(--mono-font, monospace)', fontSize: 10, fontWeight: 600,
          }}>preview</span>
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
          {GRAY_PAGES.slice(19, 32).map((p, i) => {
            const active = i === 4; // p012 highlighted (idx 23 in full list)
            return (
              <div key={p.id} title={`p${p.id}`} style={{
                flex: '0 0 auto', width: 36, height: 48, borderRadius: 3,
                background: `oklch(${p.tone} 0 0)`,
                boxShadow: 'inset 0 0 0 1px rgba(40,40,40,0.15)',
                outline: active ? '2px solid var(--accent)' : 'none',
                outlineOffset: 1,
                position: 'relative',
                cursor: 'pointer',
              }}>
                <div style={{
                  position: 'absolute', inset: '14% 14% 14% 14%',
                  backgroundImage: 'repeating-linear-gradient(to bottom, oklch(0.32 0 0) 0 1px, transparent 1px 4px)',
                  opacity: 0.6,
                }} />
              </div>
            );
          })}
        </div>
        <Button variant="ghost" size="sm" iconRight="chevR" />
      </div>
    </div>
  );
};

const GrayscaleStepSettings = ({ state = 'default', backend = 'gpu', pageId = 'p012' }) => (
  <>
    <GrayscaleSubhead
      title="Page workbench · Grayscale"
      sub={<>Per-page workbench. Tune the mode and sampler for <span className="mono">{pageId}</span>, then <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>Apply &amp; Run</span> commits the change to the cache. Save these as project defaults from the controls drawer.</>}
      right={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button variant="ghost" size="sm" icon="chevL">Prev page</Button>
          <Button variant="ghost" size="sm" iconRight="chevR">Next page</Button>
          <Divider vertical style={{ height: 22 }} />
          <Button variant="primary" size="sm" iconRight="arrowR">Apply &amp; Run</Button>
        </div>
      }
    />
    <GrayscaleBody gap={0}>
      <div style={{
        display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14,
        flex: 1, minHeight: 0,
      }}>
        <StageControlsLeft state={state} backend={backend} pageId={pageId} />
        <PageViewer pageId={pageId} mode="perceptual" backend={backend} />
      </div>
    </GrayscaleBody>
  </>
);

Object.assign(window, {
  GrayscaleOverview, GrayscalePages, GrayscaleStepSettings,
  StageControlsLeft, PageViewer,
});
