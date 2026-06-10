// template.jsx — Canonical app shell for "final" decisions.
// Header (icon + name / search / bell + user) + breadcrumb + content slot.
// Reuses design-system primitives (Icon, KeyCap) — references tokens only, no literals.

/* ---------------------- Top header ----------------------
   Left:   app icon + app name
   Center: search box (with ⌘K hint)
   Right:  bell (with unread dot) + username + avatar
*/
const AppHeader = ({
  appName = 'pgdp-prep',
  searchPlaceholder = 'Search projects, pages, settings…',
  username = 'jsmith',
  initials = 'JS',
  unread = 2,
  // Jobs item: passing a non-empty `activeJobs` array lights up the chip;
  // `jobsOpen` forces the hover popover visible (for static artboards / demos).
  activeJobs = [],
  jobsOpen = false,
}) => (
  <header style={{
    height: 52, flex: '0 0 auto',
    background: 'var(--bg-page)', borderBottom: '1px solid var(--border-1)',
    display: 'grid', gridTemplateColumns: '1fr minmax(280px, 520px) 1fr',
    alignItems: 'center', padding: '0 20px', gap: 20,
  }}>
    {/* Left: app icon + name */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 6,
        background: 'var(--accent)', color: 'var(--accent-ink)',
        display: 'grid', placeItems: 'center',
        fontFamily: 'var(--mono-font)', fontWeight: 700, fontSize: 14,
        letterSpacing: '-0.02em',
      }}>p</div>
      <span style={{
        color: 'var(--ink-1)', fontWeight: 600, fontSize: 14,
        letterSpacing: '-0.005em', whiteSpace: 'nowrap',
      }}>{appName}</span>
    </div>

    {/* Center: search box */}
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      height: 32, padding: '0 12px',
      background: 'var(--bg-sunk)', border: '1px solid var(--border-2)',
      borderRadius: 6, color: 'var(--ink-3)',
    }}>
      <Icon name="search" size={14} />
      <span style={{
        flex: 1, fontSize: 12.5, color: 'var(--ink-3)',
        fontFamily: 'var(--ui-font)',
      }}>{searchPlaceholder}</span>
      <KeyCap>⌘K</KeyCap>
    </div>

    {/* Right: jobs + bell + username + avatar */}
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      justifyContent: 'flex-end', minWidth: 0,
    }}>
      <JobsPill activeJobs={activeJobs} open={jobsOpen} />
      <button style={{
        position: 'relative', width: 30, height: 30, borderRadius: 6,
        background: 'transparent', border: '1px solid transparent',
        color: 'var(--ink-2)', cursor: 'pointer',
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name="bell" size={16} />
        {unread > 0 ? (
          <span style={{
            position: 'absolute', top: 4, right: 5,
            minWidth: 14, height: 14, padding: '0 4px',
            background: 'var(--accent)', color: 'var(--accent-ink)',
            borderRadius: 99, fontSize: 9, fontWeight: 700,
            display: 'grid', placeItems: 'center',
            border: '2px solid var(--bg-page)',
            fontFamily: 'var(--mono-font)', lineHeight: 1,
          }}>{unread}</span>
        ) : null}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <div style={{
          width: 26, height: 26, borderRadius: 99,
          background: 'var(--bg-raised)', border: '1px solid var(--border-2)',
          color: 'var(--ink-2)', fontSize: 10.5, fontWeight: 600,
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--ui-font)',
        }}>{initials}</div>
        <span style={{
          fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500,
          whiteSpace: 'nowrap',
        }}>{username}</span>
        <Icon name="chevD" size={12} style={{ color: 'var(--ink-4)' }} />
      </div>
    </div>
  </header>
);

/* ---------------------- JobsPill ----------------------
   Header-anchored "Jobs" chip with:
   - idle state: muted (no active jobs)
   - active state: accent dot + count, pulsing
   - hover (or `open` prop, for static artboards): popover with running jobs +
     a "View all" link to the future /jobs page.
   Each job shape: { id, title, phase, pct, project }.
*/
const JobsPill = ({ activeJobs = [], open = false }) => {
  const [hover, setHover] = React.useState(false);
  const show = open || hover;
  const isActive = activeJobs.length > 0;
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 26, padding: '0 9px', borderRadius: 6,
        background: isActive ? 'color-mix(in oklab, var(--ocr) 12%, transparent)' : 'transparent',
        border: '1px solid ' + (isActive ? 'color-mix(in oklab, var(--ocr) 35%, transparent)' : 'transparent'),
        color: isActive ? 'var(--ink-1)' : 'var(--ink-3)',
        cursor: 'pointer', fontSize: 12, fontWeight: 500,
      }}>
        {isActive ? (
          <span style={{
            width: 7, height: 7, borderRadius: 99, background: 'var(--ocr)',
            animation: 'pgd-pulse 1.4s ease-in-out infinite',
          }} />
        ) : (
          <Icon name="package" size={13} />
        )}
        Jobs
        {isActive ? (
          <span className="mono" style={{
            fontSize: 10, padding: '1px 5px', borderRadius: 4,
            background: 'var(--ocr)', color: 'var(--accent-ink)',
            fontWeight: 600,
          }}>{activeJobs.length}</span>
        ) : null}
      </button>
      {show ? (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          width: 340, padding: 4, borderRadius: 10,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          boxShadow: '0 12px 32px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08)',
          zIndex: 50,
        }}>
          <div style={{ padding: '8px 10px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label" style={{ color: 'var(--ink-3)' }}>
              {isActive ? `Active jobs · ${activeJobs.length}` : 'Jobs'}
            </span>
          </div>
          {isActive ? activeJobs.map(j => (
            <div key={j.id} style={{
              padding: '8px 10px', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6,
              cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 99, background: 'var(--ocr)',
                  animation: 'pgd-pulse 1.4s ease-in-out infinite', flex: '0 0 auto',
                }} />
                <span style={{
                  flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{j.project}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ocr)' }}>{j.pct}%</span>
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{j.phase}</div>
              <div style={{ height: 3, borderRadius: 99, background: 'var(--bg-sunk)' }}>
                <div style={{ width: `${j.pct}%`, height: '100%', background: 'var(--ocr)', borderRadius: 99 }} />
              </div>
            </div>
          )) : (
            <div style={{ padding: '14px 10px', fontSize: 12, color: 'var(--ink-3)' }}>
              No active jobs. Background ingest, OCR runs, and exports will appear here.
            </div>
          )}
          <div style={{
            marginTop: 4, padding: '8px 10px', borderTop: '1px solid var(--border-1)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer',
          }}>
            <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>View all jobs</span>
            <Icon name="arrowR" size={12} style={{ color: 'var(--ink-3)' }} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ---------------------- Breadcrumb ----------------------
   Pass a `trail` array of { label, href?, mono? }.
   Last entry is rendered as the current crumb (no chevron after, stronger color).
   `controls` slot is a long skinny strip on the right (filters, sorts, view toggles…).
*/
const Breadcrumb = ({
  trail = [{ label: 'Projects' }, { label: 'belloc-survivals', mono: true }],
  controls,
}) => (
  <nav style={{
    height: 40, flex: '0 0 auto',
    padding: '0 24px',
    background: 'var(--bg-page)', borderBottom: '1px solid var(--border-1)',
    display: 'flex', alignItems: 'center', gap: 14,
    fontSize: 12, color: 'var(--ink-3)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '0 0 auto' }}>
      {trail.map((crumb, i) => {
        const last = i === trail.length - 1;
        return (
          <React.Fragment key={i}>
            <span
              className={crumb.mono ? 'mono' : ''}
              style={{
                color: last ? 'var(--ink-1)' : 'var(--ink-3)',
                fontWeight: last ? 600 : 500,
                cursor: last ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
              }}>
              {crumb.label}
            </span>
            {!last ? <Icon name="chevR" size={12} style={{ color: 'var(--ink-4)' }} /> : null}
          </React.Fragment>
        );
      })}
    </div>
    {/* Content controls slot — sits immediately after the breadcrumb.
        Per-screen toolbar: sort, filter, then freeform search. */}
    <div data-slot="content-controls" style={{
      height: 26, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ width: 1, height: 16, background: 'var(--border-2)', marginRight: 4 }} />
      {controls !== undefined ? controls : <ControlsPlaceholder />}
    </div>
  </nav>
);

/* Striped placeholder for the controls slot, so the empty template makes the
   slot's shape obvious. Replace by passing `controls={…}` to Breadcrumb /
   AppTemplate. */
const ControlsPlaceholder = () => (
  <div style={{
    width: 460, height: 24, borderRadius: 6,
    border: '1px dashed var(--border-2)',
    background: 'repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in oklab, var(--border-1) 50%, transparent) 8px 9px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--mono-font)', fontSize: 10, color: 'var(--ink-4)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
  }}>
    content controls
  </div>
);

/* ---------------------- AppTemplate ----------------------
   Full shell: AppHeader + Breadcrumb + content slot.
   `theme` switches the .pgd theme. `children` fills the blank content area.
   `header` / `breadcrumb` let callers fully override either band when needed.
*/
const AppTemplate = ({
  theme = 'light',
  header,
  breadcrumb,
  trail,
  controls,
  // Forwarded to AppHeader.
  activeJobs,
  jobsOpen,
  children,
  contentPad = '24px 24px 32px',
}) => (
  <div className="pgd" data-theme={theme} style={{
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: 'var(--bg-page)',
  }}>
    {header !== undefined ? header : <AppHeader activeJobs={activeJobs} jobsOpen={jobsOpen} />}
    {breadcrumb !== undefined ? breadcrumb : <Breadcrumb trail={trail} controls={controls} />}
    <main style={{
      flex: 1, minHeight: 0, overflow: 'auto',
      background: 'var(--bg-page)',
      padding: contentPad,
    }}>
      {children}
    </main>
  </div>
);

/* ---------------------- JobsDrawer ----------------------
   Bottom-right floating jobs surface. Same job shape as JobsPill.
   - mode='expanded'  : full panel with title bar + scrollable rows + footer
   - mode='collapsed' : 36px header bar only (pulsing dot + summary + ↑)
   - mode='dismissed' : nothing renders (pill in header still carries state)
   Each job: { id, project, projectId, phase, pct, state, cancelable }
     state: 'running' | 'done' | 'paused'
   `toasts`: tiny tombstone cards above the drawer for recently-completed
   jobs that have already been dismissed from the drawer body. Each:
     { id, project, message }
*/
const JobsDrawer = ({
  activeJobs = [],
  toasts = [],
  mode = 'expanded',
  // For demo / artboards: forces a fake hover state on the first running
  // row so we can show inline actions on a static board.
  forceHoverFirst = false,
}) => {
  if (mode === 'dismissed' && activeJobs.length === 0 && toasts.length === 0) return null;
  const running = activeJobs.filter(j => j.state !== 'done');
  const done    = activeJobs.filter(j => j.state === 'done');
  const summary =
    running.length && done.length ? `${running.length} running · ${done.length} done` :
    running.length ? `${running.length} running` :
    done.length    ? `${done.length} done` :
    'No jobs';

  return (
    <div style={{
      position: 'absolute', right: 20, bottom: 20,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
      pointerEvents: 'none',
    }}>
      {/* Tombstone toasts — stack above the drawer */}
      {toasts.map(t => (
        <div key={t.id} style={{
          pointerEvents: 'auto',
          minWidth: 280, maxWidth: 360,
          padding: '9px 12px',
          background: 'var(--bg-surface)',
          border: '1px solid color-mix(in oklab, var(--exact) 40%, var(--border-1))',
          borderRadius: 8,
          boxShadow: '0 6px 18px rgba(15,23,42,.14)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 12,
          animation: 'pgd-slide-up 200ms ease-out',
        }}>
          <Icon name="checkCircle" size={14} style={{ color: 'var(--exact)', flex: '0 0 auto' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--ink-1)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.project}</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{t.message}</div>
          </div>
          <button style={{ background: 'transparent', border: 0, color: 'var(--ink-2)', cursor: 'pointer', fontSize: 11.5, fontWeight: 500, padding: '4px 6px' }}>
            Open
          </button>
          <button style={{ background: 'transparent', border: 0, color: 'var(--ink-4)', cursor: 'pointer', padding: 2, display: 'grid', placeItems: 'center' }} aria-label="Dismiss">
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}

      {/* Drawer body */}
      {mode !== 'dismissed' && activeJobs.length > 0 ? (
        <div style={{
          pointerEvents: 'auto',
          width: 380,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          borderRadius: 10,
          boxShadow: '0 14px 36px rgba(15,23,42,.20), 0 2px 6px rgba(15,23,42,.08)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Resize-handle hint along the top edge (visual only on static boards) */}
          {mode === 'expanded' ? (
            <div style={{
              position: 'relative', height: 6,
              cursor: 'ns-resize',
              background: 'var(--bg-page)',
              borderBottom: '1px solid var(--border-1)',
            }} aria-label="Resize drawer">
              <div style={{
                position: 'absolute', left: '50%', top: '50%',
                width: 28, height: 2, borderRadius: 99,
                background: 'var(--border-3)',
                transform: 'translate(-50%, -50%)',
              }} />
            </div>
          ) : null}

          {/* Header bar — always present, doubles as the collapsed surface */}
          <div style={{
            padding: '8px 10px 8px 12px',
            background: 'var(--bg-page)',
            borderBottom: mode === 'expanded' ? '1px solid var(--border-1)' : 0,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {running.length ? (
              <span style={{
                width: 8, height: 8, borderRadius: 99, background: 'var(--ocr)',
                animation: 'pgd-pulse 1.4s ease-in-out infinite', flex: '0 0 auto',
              }} />
            ) : (
              <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--exact)', flex: '0 0 auto' }} />
            )}
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>Jobs</span>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{summary}</span>
            {mode === 'collapsed' && running.length === 1 ? (
              <span className="mono" style={{
                marginLeft: 'auto', fontSize: 11, color: 'var(--ocr)', fontWeight: 600,
              }}>{running[0].pct}%</span>
            ) : (
              <span style={{ flex: 1 }} />
            )}
            <button style={{
              width: 24, height: 24, borderRadius: 5,
              background: 'transparent', border: 0, cursor: 'pointer',
              color: 'var(--ink-3)', display: 'grid', placeItems: 'center',
            }} aria-label={mode === 'expanded' ? 'Collapse' : 'Expand'}>
              <Icon name="chevD" size={13} style={{
                transform: mode === 'expanded' ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform .15s',
              }} />
            </button>
            <button style={{
              width: 24, height: 24, borderRadius: 5,
              background: 'transparent', border: 0, cursor: 'pointer',
              color: 'var(--ink-3)', display: 'grid', placeItems: 'center',
            }} aria-label="Dismiss drawer">
              <Icon name="x" size={12} />
            </button>
          </div>

          {/* Collapsed: just the header. Show single-job mini progress bar
              if there's exactly one running job. */}
          {mode === 'collapsed' && running.length === 1 ? (
            <div style={{ padding: '6px 12px 8px' }}>
              <div className="mono" style={{
                fontSize: 10.5, color: 'var(--ink-3)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginBottom: 4,
              }}>
                {running[0].project} · {running[0].phase}
              </div>
              <div style={{ height: 3, borderRadius: 99, background: 'var(--bg-sunk)', overflow: 'hidden' }}>
                <div style={{ width: `${running[0].pct}%`, height: '100%', background: 'var(--ocr)', borderRadius: 99 }} />
              </div>
            </div>
          ) : null}

          {/* Expanded: full list */}
          {mode === 'expanded' ? (
            <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              {activeJobs.map((j, idx) => (
                <JobRow
                  key={j.id} job={j}
                  hovered={forceHoverFirst && idx === 0 && j.state === 'running'} />
              ))}
              <div style={{
                padding: '8px 12px', borderTop: '1px solid var(--border-1)',
                background: 'var(--bg-page)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer',
              }}>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>View all jobs</span>
                <Icon name="arrowR" size={12} style={{ color: 'var(--ink-3)' }} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/* JobRow — single row inside JobsDrawer expanded list. */
const JobRow = ({ job, hovered = false }) => {
  const isDone   = job.state === 'done';
  const isPaused = job.state === 'paused';
  const accent   = isDone ? 'var(--exact)' : isPaused ? 'var(--fuzzy)' : 'var(--ocr)';
  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid var(--border-1)',
      background: isDone ? 'color-mix(in oklab, var(--exact) 6%, var(--bg-surface))' : 'transparent',
      display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative',
    }}>
      {/* Done-shimmer overlay */}
      {isDone ? (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--exact) 22%, transparent) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'pgd-shimmer 2.8s linear infinite',
          opacity: 0.7,
        }} />
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <span style={{
          width: 8, height: 8, borderRadius: 99, background: accent,
          animation: !isDone && !isPaused ? 'pgd-pulse 1.4s ease-in-out infinite' : 'none',
          flex: '0 0 auto',
        }} />
        <span style={{
          flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{job.project}</span>
        {isDone ? (
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 22, padding: '0 8px', borderRadius: 5,
            background: 'var(--exact)', color: 'var(--accent-ink)',
            border: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }}>
            Open <Icon name="arrowR" size={11} />
          </button>
        ) : (
          <span className="mono" style={{ fontSize: 11, color: accent, fontWeight: 600 }}>{job.pct}%</span>
        )}
      </div>

      <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', position: 'relative' }}>{job.phase}</div>

      {!isDone ? (
        <div style={{ height: 3, borderRadius: 99, background: 'var(--bg-sunk)', overflow: 'hidden', position: 'relative' }}>
          <div style={{
            width: `${job.pct}%`, height: '100%',
            background: isPaused ? 'var(--fuzzy)' : 'var(--ocr)',
            borderRadius: 99,
            backgroundImage: isPaused ? 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.18) 4px 8px)' : 'none',
          }} />
        </div>
      ) : null}

      {/* Inline hover actions — Open / Pause / Discard */}
      {hovered && !isDone ? (
        <div style={{
          marginTop: 2, display: 'flex', gap: 6, position: 'relative',
        }}>
          <Button variant="default" size="sm" iconRight="arrowR">Open project</Button>
          <Button variant="ghost"   size="sm" icon={isPaused ? 'play' : 'pause'}>
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          <span style={{ flex: 1 }} />
          {job.cancelable ? (
            <Button variant="danger" size="sm" icon="trash">Discard</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

Object.assign(window, { AppHeader, JobsPill, JobsDrawer, JobRow, Breadcrumb, ControlsPlaceholder, AppTemplate });
