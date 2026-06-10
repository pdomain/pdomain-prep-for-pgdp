// hyphen.jsx — Hyphen-join stage content components.
// Wraps the wf05 workbench's inner content pieces inside the final/
// PipelineTemplate's tab bodies (no ProjectConfigureFrame chrome).
//
// Tabs:
//   - overview  : intro + stat tiles + post-book notes preview
//   - queue     : Undecided queue mode (sidebar + case)
//   - joined    : Auto-joined validation (grouped by word)
//   - mismatch  : Mismatched dash report
//   - settings  : Step-settings panel (preset + global library link)

const { useState: useSHJ } = React;

/* ====================================================================
   Shared subhead — sits below the tab bar on every hyphen-join tab.
   Mirrors the wf05 PerBookFrame's subhead row + global-library exit.
==================================================================== */

const HyphenSubhead = ({ title, sub, right }) => (
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
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto' }}>
      {right}
      <Button variant="ghost" size="sm" icon="wrench">Edit global library</Button>
    </div>
  </div>
);

const HyphenBody = ({ children, gap = 14 }) => (
  <div style={{
    padding: '14px 28px 28px',
    display: 'flex', flexDirection: 'column', gap,
    flex: 1, minHeight: 0,
  }}>
    {children}
  </div>
);

/* ====================================================================
   Overview · summary + post-book notes that will ride along with the
   PGDP package. Acts as the landing page for the stage.
==================================================================== */

const HyphenOverview = () => (
  <>
    <HyphenSubhead
      title="Hyphen Join · overview"
      sub="49 cross-line hyphens found in this book. 42 auto-joined by the rule library, 7 need a decision, 3 dash-mismatches in the joined output."
    />
    <HyphenBody>
      <ReportHeader />
      <ReportStatTiles />

      {/* Workflow row — three calls to action, one per remaining tab. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
      }}>
        {[
          {
            tone: 'var(--gt)', label: '1 · Decide the undecideds',
            sub: '7 cross-line cases the rule library could not auto-resolve. Decide one at a time in the Undecided queue.',
            cta: 'Open queue', icon: 'eye', count: '7',
          },
          {
            tone: 'var(--exact)', label: '2 · Validate auto-joins',
            sub: '42 cross-line cases the rule library auto-joined. Skim the grouped-by-word report to confirm none are wrong.',
            cta: 'Open auto-joined', icon: 'check', count: '42',
          },
          {
            tone: 'var(--fuzzy)', label: '3 · Resolve dash mismatches',
            sub: '3 unique words that appear both joined and hyphenated in the joined output. Pick a canonical form.',
            cta: 'Open mismatch', icon: 'alert', count: '3',
          },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-1)',
            borderLeft: `3px solid ${s.tone}`,
            borderRadius: 8,
            padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>{s.label}</span>
              <span className="mono" style={{
                padding: '1px 7px', borderRadius: 99,
                background: 'var(--bg-raised)', border: '1px solid var(--border-1)',
                fontSize: 10.5, color: 'var(--ink-2)', fontWeight: 600,
              }}>{s.count}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              {s.sub}
            </div>
            <div style={{ marginTop: 'auto', paddingTop: 4 }}>
              <Button variant="ghost" size="sm" icon={s.icon} iconRight="arrowR">{s.cta}</Button>
            </div>
          </div>
        ))}
      </div>

      <PostBookNotesPreview />
    </HyphenBody>
  </>
);

/* ====================================================================
   Undecided · the V3 queue mode (sidebar + focused case).
==================================================================== */

const HyphenUndecided = () => (
  <>
    <HyphenSubhead
      title="Undecided · queue mode"
      sub={<>Decide one cross-line case at a time. Keyboard-driven · <Kbd>J</Kbd>/<Kbd>K</Kbd> navigate, <Kbd>Y</Kbd>/<Kbd>N</Kbd> accept/keep, <Kbd>F</Kbd> flag for post-book processing.</>}
      right={<ViewToggle active="queue" />}
    />
    <HyphenBody>
      <ReportStatTiles />
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', minHeight: 0 }}>
        <QueueSidebar activeId={2} />
        <QueueCase c={UNDECIDED_CASES[1]} />
      </div>
      <PostBookNotesPreview />
    </HyphenBody>
  </>
);

/* ====================================================================
   Auto-joined · grouped-by-word validation (V5).
==================================================================== */

const HyphenAutoJoined = () => (
  <>
    <HyphenSubhead
      title="Auto-joined · validation"
      sub="42 cases the rule library auto-joined, grouped into 38 unique words. Expand a row to see every instance · flagged rows have a competing un-joined form elsewhere in the book."
    />
    <HyphenBody>
      <ReportStatTiles />
      <AutoJoinedList />
    </HyphenBody>
  </>
);

/* ====================================================================
   Mismatch · dash-mismatch report (V4).
==================================================================== */

const HyphenMismatch = () => (
  <>
    <HyphenSubhead
      title="Mismatched dash report"
      sub="Same word appears both joined and hyphenated in this book's output. Pick a canonical form to normalise; the corpus-wide pass at submission time can also be deferred."
    />
    <HyphenBody>
      <ReportStatTiles />
      <MismatchedReportV4 />
    </HyphenBody>
  </>
);

/* ====================================================================
   Step settings — preset + library link + auto-flag thresholds.
==================================================================== */

const HyphenStepSettings = ({ state = 'default' }) => {
  // state: 'default' | 'modified' | 'preset'
  const banner = state === 'modified' ? {
    tone: 'var(--fuzzy)', icon: 'alert',
    label: 'Modified · 2 changes vs project default',
    sub: 'Save these as the project default, or revert to inherit.',
  } : state === 'preset' ? {
    tone: 'var(--ocr)', icon: 'sparkles',
    label: 'Using preset · PGDP / 19c-essays',
    sub: 'Loaded from a saved preset; not the project default.',
  } : {
    tone: 'var(--exact)', icon: 'checkCircle',
    label: 'Using project default · Standard + global library',
    sub: 'Hyphen rules come from the global library plus this book\u2019s overrides.',
  };

  return (
    <>
      <HyphenSubhead
        title="Stage settings · Hyphen join"
        sub="Which rule library to use, auto-flag thresholds for the queue, and how mismatched dashes are resolved at submission time."
      />
      <HyphenBody>
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

        {/* Library source */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Rule library</div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>
                The rules that decide what auto-joins, what waits for review, and what gets flagged.
              </div>
            </div>
            <Button variant="ghost" size="sm" icon="wrench" iconRight="arrowR">Edit global library</Button>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
          }}>
            {[
              { label: 'Always-join beginnings', count: 20, sample: 'after-, non-, re-, self-' },
              { label: 'Always-join endings',    count: 10, sample: '-day, -hood, -ness, -ward' },
              { label: 'Always-join words',      count: 14, sample: 'commonwealth, afternoon' },
              { label: 'Always-keep hyphens',    count:  7, sample: 'sister-in-law, e-mail' },
            ].map(g => (
              <div key={g.label} style={{
                background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7,
                padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{g.label}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-1)', fontWeight: 600 }}>{g.count}</span>
                </div>
                <span className="mono" style={{
                  fontSize: 10.5, color: 'var(--ink-4)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{g.sample}</span>
              </div>
            ))}
          </div>
        </div>

        {/* N-gram corpus cache · app-wide */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>Google Books n-gram cache</div>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '1px 8px', height: 18, borderRadius: 99,
                  background: 'color-mix(in oklab, var(--ocr) 12%, transparent)',
                  border: '1px solid color-mix(in oklab, var(--ocr) 40%, var(--border-1))',
                  color: 'var(--ocr)', fontSize: 10, fontWeight: 600,
                  letterSpacing: '.04em', textTransform: 'uppercase',
                  fontFamily: 'var(--mono-font, monospace)',
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--ocr)' }} />
                  app-wide
                </span>
              </div>
              <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Sparklines on the Auto-joined tab pull from a shared cache. N-grams change rarely, so the cache
                is keyed by word and shared across every project on this install — not per-book. Export the
                cache to share it between installs (or seed an air-gapped machine) and import to load one back.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto' }}>
              <Button variant="ghost" size="sm" icon="download">Export…</Button>
              <Button variant="ghost" size="sm" icon="upload">Import…</Button>
              <span style={{ width: 1, height: 18, background: 'var(--border-1)', margin: '0 2px' }} />
              <Button variant="ghost" size="sm" icon="refresh">Refresh cache now</Button>
            </div>
          </div>

          {/* Cache stats */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
          }}>
            {[
              { value: '8,412', label: 'words cached',  tone: 'var(--ink-1)' },
              { value: '4d',    label: 'oldest entry', tone: 'var(--ink-1)' },
              { value: '12',    label: 'in-flight',     tone: 'var(--ocr)' },
              { value: '2.1 MB',label: 'disk',          tone: 'var(--ink-1)' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--bg-raised)', border: '1px solid var(--border-1)', borderRadius: 7,
                padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: s.tone, letterSpacing: '-0.01em' }}>
                  {s.value}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* Cache behaviour rows */}
          <div style={{
            background: 'var(--bg-page)', border: '1px solid var(--border-1)', borderRadius: 7,
            overflow: 'hidden',
          }}>
            {[
              {
                label: 'Auto-fetch on stage entry',
                sub: 'Prefetch n-grams for every cross-line case when this stage opens, so sparklines are ready immediately.',
                control: <HyphenToggle on />,
              },
              {
                label: 'Refresh entries older than',
                sub: 'Re-fetch cached entries once they pass this age. The Google Books corpus updates yearly at most.',
                control: <SelectStub value="180 days" />,
              },
              {
                label: 'Concurrent fetch workers',
                sub: 'Parallel requests against the n-gram service. Higher = faster prefetch, lower = friendlier rate limits.',
                control: <ThresholdSlider value={0.40} />,
              },
              {
                label: 'Persist cache between launches',
                sub: 'Keep the cache on disk between app launches instead of re-fetching at every cold start.',
                control: <HyphenToggle on />,
              },
            ].map((row, i) => (
              <div key={row.label} style={{
                display: 'grid', gridTemplateColumns: '1fr 280px',
                gap: 16, padding: '11px 14px', alignItems: 'center',
                borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
              }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{row.label}</div>
                  <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{row.sub}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {row.control}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Auto-flag thresholds */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          overflow: 'hidden',
        }}>
          {[
            {
              label: 'Auto-join score threshold',
              sub: 'Cases above this n-gram score auto-join without review.',
              control: <ThresholdSlider value={0.95} />,
            },
            {
              label: 'Flag if author-style conflicts with rule',
              sub: 'E.g. "to-day" beats "today" locally · rule says join · case enters queue.',
              control: <HyphenToggle on />,
            },
            {
              label: 'Auto-join cross-page hyphens',
              sub: 'Cross-page cases route through the queue by default · enable to auto-join when score > 0.97.',
              control: <HyphenToggle on={false} />,
            },
            {
              label: 'Mismatched-dash resolution',
              sub: 'How to handle the same word appearing both joined and hyphenated in the joined output.',
              control: <SelectStub value="Flag for post-book corpus pass" />,
            },
          ].map((row, i) => (
            <div key={row.label} style={{
              display: 'grid', gridTemplateColumns: '1fr 320px',
              gap: 16, padding: '12px 16px', alignItems: 'center',
              borderTop: i === 0 ? 0 : '1px solid var(--border-1)',
            }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)' }}>{row.label}</div>
                <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-3)' }}>{row.sub}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {row.control}
              </div>
            </div>
          ))}
        </div>
      </HyphenBody>
    </>
  );
};

/* Minimal slider visual — non-interactive. */
const ThresholdSlider = ({ value = 0.95 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
    <div style={{
      flex: 1, height: 4, borderRadius: 99,
      background: 'var(--border-2)', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: '0 auto 0 0',
        width: `${value * 100}%`, background: 'var(--accent)',
      }} />
      <div style={{
        position: 'absolute', top: -4, left: `calc(${value * 100}% - 6px)`,
        width: 12, height: 12, borderRadius: 99,
        background: 'var(--accent)', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </div>
    <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600, minWidth: 38, textAlign: 'right' }}>
      {value.toFixed(2)}
    </span>
  </div>
);

const HyphenToggle = ({ on = true }) => (
  <span style={{
    width: 30, height: 18, borderRadius: 99, cursor: 'pointer',
    background: on ? 'var(--accent)' : 'var(--border-2)',
    position: 'relative', transition: 'background .12s',
  }}>
    <span style={{
      position: 'absolute', top: 2, left: on ? 14 : 2,
      width: 14, height: 14, borderRadius: 99, background: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,.15)',
      transition: 'left .12s',
    }} />
  </span>
);

const SelectStub = ({ value }) => (
  <div style={{
    width: '100%', height: 30, padding: '0 10px',
    background: 'var(--bg-sunk)', border: '1px solid var(--border-2)', borderRadius: 6,
    display: 'flex', alignItems: 'center', gap: 8,
  }}>
    <span className="mono" style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-1)' }}>{value}</span>
    <Icon name="chevD" size={12} style={{ color: 'var(--ink-3)' }} />
  </div>
);

Object.assign(window, {
  HyphenSubhead, HyphenBody,
  HyphenOverview, HyphenUndecided, HyphenAutoJoined, HyphenMismatch, HyphenStepSettings,
});

/* ====================================================================
   Per-page workbench — list of cross-line hyphen cases on the focused
   page, plus a detail panel for the selected case. Smaller and simpler
   than the project-wide queue mode but uses the same primitives.
==================================================================== */

/* Synthetic "cases on this page" — mixes one undecided (with real case
   data from UNDECIDED_CASES) with a couple of auto-joined instances that
   would normally live silently in the corpus. */
const HJ_PAGE_ID = 'p029';
const HJ_PAGE_IDX = 8;
const HJ_PAGE_CASES = [
  { kind: 'crosspage', caseId: 'cp-in',  line: 1,  head: 'house', tail: 'hold',     status: 'crosspage', validated: true,  conf: 0.99, rule: 'always-join · cross-page',
    note: 'continues from p028 L39 · running head skipped',
    book: { inBody: 8,  pages: 6,
            byState: { verifiedJoin: 4, pendingJoin: 3 } } },
  { kind: 'undecided', caseId: 2,        line: 8,  head: 'after', tail: 'wards',    status: 'undecided', validated: false, conf: 0.97, rule: 'no rule match',
    book: { inBody: 19, pages: 14,
            byState: { verifiedJoin: 10, pendingJoin: 5, verifiedNoAction: 3 } } },
  { kind: 'auto',      caseId: 'a1',     line: 14, head: 'with',  tail: 'out',      status: 'joined',    validated: false, conf: 1.00, rule: 'always-join',
    book: { inBody: 48, pages: 31,
            byState: { verifiedJoin: 22, pendingJoin: 25 } } },
  { kind: 'auto',      caseId: 'a2',     line: 20, head: 'some',  tail: 'thing',    status: 'joined',    validated: true,  conf: 1.00, rule: 'always-join · -thing',
    book: { inBody: 20, pages: 17,
            byState: { verifiedJoin: 15, pendingJoin: 4 } } },
  { kind: 'flag',      caseId: 'f1',     line: 28, head: 'over',  tail: 'whelming', status: 'flagged',   validated: false, conf: 0.66, rule: 'beginning · over-',
    book: { inBody: 5,  pages: 5,
            byState: { verifiedJoin: 2, pendingJoin: 1, verifiedKeep: 1 },
            mismatchPages: ['p091'] } },
  { kind: 'crosspage', caseId: 'cp-out', line: 38, head: 'coun',  tail: 'try',      status: 'crosspage', validated: false, conf: 1.00, rule: 'always-join · cross-page',
    note: 'continues to p030 L1',
    book: { inBody: 23, pages: 19,
            byState: { verifiedJoin: 18, pendingJoin: 4 } } },
];

/* State catalog — order = display order. Each entry: { id, tone,
   filled (for verified states), icon, label, short }. */
const HJ_STATES = [
  { id: 'verifiedJoin',     tone: 'var(--exact)',    filled: true,  icon: 'check', label: 'verified join'    },
  { id: 'verifiedKeep',     tone: 'var(--ocr)',      filled: true,  icon: 'check', label: 'verified keep'    },
  { id: 'verifiedNoAction', tone: 'var(--ink-3)',    filled: true,  icon: 'check', label: 'verified no action' },
  { id: 'pendingJoin',      tone: 'var(--exact)',    filled: false, dot: true,     label: 'pending auto-join' },
  { id: 'pendingKeep',      tone: 'var(--fuzzy)',    filled: false, dot: true,     label: 'pending keep'      },
  { id: 'noAction',         tone: 'var(--ink-4)',    filled: false, dot: true,     label: 'no action'         },
  { id: 'mismatch',         tone: 'var(--mismatch)', filled: true,  icon: 'alert', label: 'hyphen form'       },
];
const HJ_STATES_BY_ID = Object.fromEntries(HJ_STATES.map(s => [s.id, s]));

const HJ_STATUS_TONE = {
  joined:    'var(--exact)',
  validated: 'var(--exact)',
  keep:      'var(--ink-3)',
  undecided: 'var(--fuzzy)',
  flagged:   'var(--mismatch)',
  crosspage: 'var(--ocr)',  // distinct purple for the cross-page route
};

const HJStatusPill = ({ status, validated }) => {
  // Treat a validated joined as its own visual state.
  const effective = (status === 'joined' && validated) ? 'validated' : status;
  const tone = HJ_STATUS_TONE[effective] || HJ_STATUS_TONE.joined;
  const map = {
    joined:    { label: 'auto-joined', icon: null },
    validated: { label: 'validated',   icon: 'check' },
    keep:      { label: 'kept',        icon: null },
    undecided: { label: 'undecided',   icon: null },
    flagged:   { label: 'flagged',     icon: 'alert' },
    crosspage: { label: 'cross-page',  icon: 'swap' },
  };
  const m = map[effective] || map.joined;
  const filled = effective === 'validated';
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 6px', height: 16, borderRadius: 3,
      background: filled
        ? `color-mix(in oklab, ${tone} 78%, transparent)`
        : `color-mix(in oklab, ${tone} 14%, transparent)`,
      border: filled
        ? `1px solid ${tone}`
        : `1px solid color-mix(in oklab, ${tone} 40%, var(--border-1))`,
      color: filled ? '#fff' : tone,
      fontSize: 9.5, fontWeight: 600, letterSpacing: '.04em',
      textTransform: 'uppercase',
    }}>
      {m.icon ? <Icon name={m.icon} size={9} stroke={2} /> : (
        <span style={{ width: 5, height: 5, borderRadius: 99, background: filled ? '#fff' : tone }} />
      )}
      {m.label}
    </span>
  );
};

/* Compact "case row" for the on-page list — head-tail · line · status,
   with a book-stats footer (in-body counts, joined elsewhere, mismatch). */
const HJPageCaseRow = ({ c, active, onClick }) => {
  const book = c.book || {};
  return (
  <div onClick={onClick} style={{
    padding: '8px 10px', borderRadius: 6,
    background: active ? 'color-mix(in oklab, var(--accent) 8%, var(--bg-surface))' : 'var(--bg-page)',
    border: active
      ? '1px solid color-mix(in oklab, var(--accent) 45%, var(--border-1))'
      : '1px solid var(--border-1)',
    cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 6,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="mono" style={{
        flex: 1,
        fontSize: 12, fontWeight: 600, color: 'var(--ink-1)',
      }}>
        {c.head}<span style={{ color: 'var(--accent)' }}>-</span>{c.tail}
      </span>
      <HJStatusPill status={c.status} validated={c.validated} />
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 10.5, color: 'var(--ink-3)',
    }}>
      <span className="mono">L{c.line}</span>
      <span style={{ color: 'var(--border-3)' }}>·</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {c.rule || (c.kind === 'undecided' ? 'no rule match' : '—')}
      </span>
      <span style={{ flex: 1 }} />
      <span className="mono" style={{
        color: c.conf >= 0.9 ? 'var(--exact)'
             : c.conf >= 0.75 ? 'var(--fuzzy)' : 'var(--mismatch)',
        fontWeight: 600,
      }}>
        {c.conf.toFixed(2)}
      </span>
    </div>
    {/* Book-stats footer — state breakdown for occurrences of the joined form
        across the rest of the book (verified vs pending vs no-action, plus
        any mismatch). Header row carries the totals. */}
    {book.inBody != null ? (
      <div style={{
        marginTop: 2, paddingTop: 6, borderTop: '1px dashed var(--border-1)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 6,
          fontSize: 10, color: 'var(--ink-3)',
        }}>
          <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-1)' }}>
            {book.inBody}
          </span>
          <span>in body</span>
          {book.pages ? (
            <>
              <span style={{ color: 'var(--border-3)' }}>·</span>
              <span className="mono">{book.pages} pages</span>
            </>
          ) : null}
        </div>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4,
        }}>
          {HJ_STATES.map(s => {
            const v = book.byState ? book.byState[s.id] : 0;
            if (!v) return null;
            return (
              <HJStateChip
                key={s.id}
                state={s}
                value={v}
                sub={s.id === 'mismatch' && book.mismatchPages
                      ? book.mismatchPages.join(', ') : null}
              />
            );
          })}
        </div>
      </div>
    ) : null}
  </div>
);
};

/* Compact state chip — verified states are filled (solid color, white text);
   pending and no-action states are outlined with a dot. */
const HJStateChip = ({ state, value, sub }) => {
  const { tone, filled, icon, dot, label } = state;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '1px 6px', height: 17, borderRadius: 3,
      background: filled
        ? `color-mix(in oklab, ${tone} 78%, transparent)`
        : `color-mix(in oklab, ${tone} 10%, var(--bg-surface))`,
      border: filled
        ? `1px solid ${tone}`
        : `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`,
      color: filled ? '#fff' : tone,
      fontSize: 9.5,
    }}>
      {icon ? (
        <Icon name={icon} size={9} stroke={2} style={{ color: filled ? '#fff' : tone }} />
      ) : dot ? (
        <span style={{
          width: 5, height: 5, borderRadius: 99,
          background: filled ? '#fff' : tone,
        }} />
      ) : null}
      <span className="mono" style={{ fontWeight: 700 }}>{value}</span>
      <span style={{ fontWeight: 500, color: filled ? '#fff' : 'var(--ink-2)' }}>{label}</span>
      {sub ? <span className="mono" style={{ fontSize: 9, color: filled ? 'rgba(255,255,255,.75)' : 'var(--ink-4)' }}>· {sub}</span> : null}
    </span>
  );
};

/* The full page body, line-by-line as the OCR captured it. Each
   cross-line case is marked at the boundary; cross-page cases are
   the tail/head of a hyphen split across page edges. */
const HJ_PAGE_LINES = [
  /* L1 */  { kind: 'tail',  caseId: 'cp-in',  text: 'of memory, in the lasting form of ditch and barn,' },
  /* L2 */  { text: 'retains an English thing the new arrivals cannot' },
  /* L3 */  { text: 'displace. It is in this conviction that Belloc turns' },
  /* L4 */  { text: 'once more to the place-names, and from this point' },
  /* L5 */  { text: 'the present chapter begins.' },
  /* L6 */  { blank: true },
  /* L7 */  { text: 'He returns again and again to that older England' },
  /* L8 */  { kind: 'head', caseId: 2, text: 'which he insists the new arrivals must come,' },
  /* L9 */  { kind: 'tail', caseId: 2, text: 'to terms with in some quieter mode of mind.' },
  /* L10 */ { text: 'He writes with the directness of a man certain he' },
  /* L11 */ { text: 'has the better of the argument.' },
  /* L12 */ { blank: true },
  /* L13 */ { text: 'It is one of his particular pleasures, this notion' },
  /* L14 */ { kind: 'head', caseId: 'a1', text: 'that so much of what makes the country is grasped' },
  /* L15 */ { kind: 'tail', caseId: 'a1', text: 'the apparatus of formal scholarship — the long' },
  /* L16 */ { text: 'names of villages, the lichen on a yew tree, the' },
  /* L17 */ { text: 'shape of an old wall.' },
  /* L18 */ { blank: true },
  /* L19 */ { text: 'Of the village name itself he is uncommonly tender.' },
  /* L20 */ { kind: 'head', caseId: 'a2', text: 'Through the chapters one notices, again and again,' },
  /* L21 */ { kind: 'tail', caseId: 'a2', text: 'essentially elegiac in the recital — a love' },
  /* L22 */ { text: 'for the survivals more than the new arrivals.' },
  /* L23 */ { blank: true },
  /* L24 */ { text: 'From the very first page of the volume there is the' },
  /* L25 */ { text: 'unmistakable sense that something is going. He calls' },
  /* L26 */ { text: 'it, variously, the older England, or simply the' },
  /* L27 */ { text: 'country; and the running theme — never stated in so' },
  /* L28 */ { kind: 'head', caseId: 'f1', text: 'many words — is the' },
  /* L29 */ { kind: 'tail', caseId: 'f1', text: 'sense that its quietness, soon, will be done.' },
  /* L30 */ { blank: true },
  /* L31 */ { text: 'It is this elegiac note that runs across every chapter' },
  /* L32 */ { text: 'in the volume. The reader who comes for an essay on' },
  /* L33 */ { text: 'Sussex finds himself in mourning for something he had' },
  /* L34 */ { text: 'not previously known to mourn.' },
  /* L35 */ { blank: true },
  /* L36 */ { text: 'Where the running theme bends back upon itself is in' },
  /* L37 */ { text: 'the final lines — and there one feels the very land' },
  /* L38 */ { kind: 'head', caseId: 'cp-out', text: 'of his' },
];

/* The same content, reflowed and joined per the rule library's decision.
   Cross-page joins close up across page edges; undecided/flagged cases
   keep the hyphen but the line break collapses. */
const HJ_PAGE_PARAGRAPHS = [
  {
    head: { caseId: 'cp-in', from: 'p028' },
    text: 'of memory, in the lasting form of ditch and barn, retains an English thing the new arrivals cannot displace. It is in this conviction that Belloc turns once more to the place-names, and from this point the present chapter begins.',
  },
  {
    midCases: [ { caseId: 2, kept: true } ],
    text: 'He returns again and again to that older England which he insists the new arrivals must come, ⟨after-wards⟩, to terms with in some quieter mode of mind. He writes with the directness of a man certain he has the better of the argument.',
  },
  {
    midCases: [ { caseId: 'a1', kept: false } ],
    text: 'It is one of his particular pleasures, this notion that so much of what makes the country is grasped ⟨without⟩ the apparatus of formal scholarship — the long names of villages, the lichen on a yew tree, the shape of an old wall.',
  },
  {
    midCases: [ { caseId: 'a2', kept: false } ],
    text: 'Of the village name itself he is uncommonly tender. Through the chapters one notices, again and again, ⟨something⟩ essentially elegiac in the recital — a love for the survivals more than the new arrivals.',
  },
  {
    midCases: [ { caseId: 'f1', kept: true } ],
    text: 'From the very first page of the volume there is the unmistakable sense that something is going. He calls it, variously, the older England, or simply the country; and the running theme — never stated in so many words — is the ⟨over-whelming⟩ sense that its quietness, soon, will be done.',
  },
  {
    text: 'It is this elegiac note that runs across every chapter in the volume. The reader who comes for an essay on Sussex finds himself in mourning for something he had not previously known to mourn.',
  },
  {
    tail: { caseId: 'cp-out', to: 'p030' },
    text: 'Where the running theme bends back upon itself is in the final lines — and there one feels the very land of his ⟨country⟩…',
  },
];

const HJ_CASE_BY_ID = Object.fromEntries(HJ_PAGE_CASES.map(c => [c.caseId, c]));

/* "Before" — line-by-line OCR text with cross-line hyphens visible at
   line boundaries. Tail/head pairs share a status color; cross-page
   hyphens get a distinct outline. */
const HJBeforeView = ({ activeId }) => {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid var(--border-1)',
        background: 'var(--bg-page)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--ink-3)',
        }}>Before · OCR source</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
          {HJ_PAGE_LINES.length} lines · line breaks preserved
        </span>
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        padding: '12px 16px', display: 'flex', flexDirection: 'column',
        fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-1)',
      }}>
        {HJ_PAGE_LINES.map((ln, i) => {
          const lineNo = i + 1;
          const isBlank = ln.blank;
          const c = ln.caseId ? HJ_CASE_BY_ID[ln.caseId] : null;
          const effective = c ? ((c.status === 'joined' && c.validated) ? 'validated' : c.status) : null;
          const tone = c ? HJ_STATUS_TONE[effective] : null;
          const hot = ln.caseId === activeId;
          const isCrosspageEdge =
            (ln.kind === 'tail' && c && c.kind === 'crosspage' && lineNo === 1) ||
            (ln.kind === 'head' && c && c.kind === 'crosspage' && i === HJ_PAGE_LINES.length - 1);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              minHeight: isBlank ? 14 : undefined,
            }}>
              <span style={{
                flex: '0 0 28px', textAlign: 'right',
                fontFamily: 'var(--mono-font, monospace)', fontSize: 10,
                color: isCrosspageEdge ? 'var(--ocr)' : 'var(--ink-4)',
                fontWeight: isCrosspageEdge ? 700 : 400,
              }}>{lineNo}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {isBlank ? <span style={{ color: 'var(--ink-4)', opacity: 0.4, fontSize: 10 }}>¶</span> : null}
                {ln.kind === 'tail' && c ? (
                  <>
                    <span style={{
                      background: `color-mix(in oklab, ${tone} ${hot ? 24 : 14}%, transparent)`,
                      outline: hot ? `2px solid ${tone}` : `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`,
                      outlineOffset: 1,
                      borderRadius: 3, padding: '0 3px', marginRight: 4,
                    }}>{c.tail}</span>
                    {ln.text}
                  </>
                ) : ln.kind === 'head' && c ? (
                  <>
                    {ln.text}{' '}
                    <span style={{
                      background: `color-mix(in oklab, ${tone} ${hot ? 24 : 14}%, transparent)`,
                      outline: hot ? `2px solid ${tone}` : `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`,
                      outlineOffset: 1,
                      borderRadius: 3, padding: '0 3px',
                    }}>
                      {c.head}<span style={{ color: tone, fontWeight: 700 }}>-</span>
                    </span>
                  </>
                ) : (
                  <span>{ln.text}</span>
                )}
                {isCrosspageEdge && ln.kind === 'tail' ? (
                  <span className="mono" style={{
                    marginLeft: 8, fontSize: 9.5, fontWeight: 600,
                    color: 'var(--ocr)', letterSpacing: '.04em', textTransform: 'uppercase',
                  }}>← p028</span>
                ) : null}
                {isCrosspageEdge && ln.kind === 'head' ? (
                  <span className="mono" style={{
                    marginLeft: 8, fontSize: 9.5, fontWeight: 600,
                    color: 'var(--ocr)', letterSpacing: '.04em', textTransform: 'uppercase',
                  }}>p030 →</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* "After" — line-by-line view that mirrors Before exactly except for the
   within-page auto-joined cases (a1, a2). For those, the head line absorbs
   the tail inline (collapsing the dash), and the tail line drops its tail
   word. Undecided / flagged / cross-page cases render identically to
   Before so the user sees only the rule library's actual changes. */
const HJ_COLLAPSE_IDS = new Set(
  HJ_PAGE_CASES
    .filter(c => c.kind === 'auto' && c.status === 'joined')
    .map(c => c.caseId)
);

const HJAfterView = ({ activeId }) => {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '8px 14px', borderBottom: '1px solid var(--border-1)',
        background: 'var(--bg-page)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--ink-3)',
        }}>After · joined output</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
          {HJ_COLLAPSE_IDS.size} dashes collapsed · rest kept
        </span>
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        padding: '12px 16px', display: 'flex', flexDirection: 'column',
        fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-1)',
      }}>
        {HJ_PAGE_LINES.map((ln, i) => {
          const lineNo = i + 1;
          const isBlank = ln.blank;
          const c = ln.caseId ? HJ_CASE_BY_ID[ln.caseId] : null;
          const effective = c ? ((c.status === 'joined' && c.validated) ? 'validated' : c.status) : null;
          const tone = c ? HJ_STATUS_TONE[effective] : null;
          const hot = ln.caseId === activeId;
          const collapsing = c && HJ_COLLAPSE_IDS.has(c.caseId);
          const isCrosspageEdge =
            (ln.kind === 'tail' && c && c.kind === 'crosspage' && lineNo === 1) ||
            (ln.kind === 'head' && c && c.kind === 'crosspage' && i === HJ_PAGE_LINES.length - 1);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              minHeight: isBlank ? 14 : undefined,
            }}>
              <span style={{
                flex: '0 0 28px', textAlign: 'right',
                fontFamily: 'var(--mono-font, monospace)', fontSize: 10,
                color: isCrosspageEdge ? 'var(--ocr)' : 'var(--ink-4)',
                fontWeight: isCrosspageEdge ? 700 : 400,
              }}>{lineNo}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {isBlank ? <span style={{ color: 'var(--ink-4)', opacity: 0.4, fontSize: 10 }}>¶</span> : null}
                {ln.kind === 'tail' && c ? (
                  collapsing ? (
                    // Tail dropped — line starts directly with the body text.
                    <span>{ln.text}</span>
                  ) : (
                    <>
                      <span style={{
                        background: `color-mix(in oklab, ${tone} ${hot ? 24 : 14}%, transparent)`,
                        outline: hot ? `2px solid ${tone}` : `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`,
                        outlineOffset: 1,
                        borderRadius: 3, padding: '0 3px', marginRight: 4,
                      }}>{c.tail}</span>
                      {ln.text}
                    </>
                  )
                ) : ln.kind === 'head' && c ? (
                  collapsing ? (
                    <>
                      {ln.text}{' '}
                      <span style={{
                        background: `color-mix(in oklab, ${tone} ${hot ? 24 : 14}%, transparent)`,
                        outline: hot ? `2px solid ${tone}` : `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`,
                        outlineOffset: 1,
                        borderRadius: 3, padding: '0 3px',
                      }}>{c.head}{c.tail}</span>
                    </>
                  ) : (
                    <>
                      {ln.text}{' '}
                      <span style={{
                        background: `color-mix(in oklab, ${tone} ${hot ? 24 : 14}%, transparent)`,
                        outline: hot ? `2px solid ${tone}` : `1px solid color-mix(in oklab, ${tone} 35%, var(--border-1))`,
                        outlineOffset: 1,
                        borderRadius: 3, padding: '0 3px',
                      }}>
                        {c.head}<span style={{ color: tone, fontWeight: 700 }}>-</span>
                      </span>
                    </>
                  )
                ) : (
                  <span>{ln.text}</span>
                )}
                {isCrosspageEdge && ln.kind === 'tail' ? (
                  <span className="mono" style={{
                    marginLeft: 8, fontSize: 9.5, fontWeight: 600,
                    color: 'var(--ocr)', letterSpacing: '.04em', textTransform: 'uppercase',
                  }}>← p028</span>
                ) : null}
                {isCrosspageEdge && ln.kind === 'head' ? (
                  <span className="mono" style={{
                    marginLeft: 8, fontSize: 9.5, fontWeight: 600,
                    color: 'var(--ocr)', letterSpacing: '.04em', textTransform: 'uppercase',
                  }}>p030 →</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* The active case's compact decision card — accept / keep / re-flag /
   validate. Shows current vs alternate and validated/cross-page state. */
const HJDecisionCard = ({ active }) => {
  const isCrosspage = active.kind === 'crosspage';
  const isJoinedish = active.status === 'joined' || active.status === 'crosspage';
  const accepted = isJoinedish ? `${active.head}${active.tail}` : `${active.head}-${active.tail}`;
  const alt      = isJoinedish ? `${active.head}-${active.tail}` : `${active.head}${active.tail}`;
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
      padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div>
        <div style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4,
        }}>focused case · L{active.line}{isCrosspage ? ' · cross-page' : ''}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink-1)' }}>
            {active.head}<span style={{ color: HJ_STATUS_TONE[active.validated && active.status === 'joined' ? 'validated' : active.status] }}>-</span>{active.tail}
          </span>
          <HJStatusPill status={active.status} validated={active.validated} />
        </div>
        {active.note ? (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>{active.note}</div>
        ) : null}
      </div>
      <Divider vertical style={{ height: 40 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
          current
        </span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
          {accepted}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
          alternate
        </span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>
          {alt}
        </span>
      </div>
      <span style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {active.status === 'joined' && !active.validated ? (
          <Button variant="primary" size="sm" icon="check">Validate join</Button>
        ) : active.status === 'undecided' ? (
          <>
            <Button variant="primary" size="sm" icon="check">Accept join</Button>
            <Button variant="default" size="sm">Keep hyphen</Button>
          </>
        ) : active.status === 'flagged' ? (
          <>
            <Button variant="default" size="sm" icon="check">Accept join</Button>
            <Button variant="default" size="sm">Keep hyphen</Button>
          </>
        ) : active.status === 'crosspage' && !active.validated ? (
          <Button variant="primary" size="sm" icon="check">Validate cross-page join</Button>
        ) : (
          <Button variant="ghost" size="sm" icon="refresh">Revert decision</Button>
        )}
        <Button variant="ghost" size="sm" icon="bell">
          <span style={{ color: 'var(--fuzzy)' }}>Flag for post-book</span>
        </Button>
      </div>
    </div>
  );
};

const HyphenPageWorkbench = ({ pageId = HJ_PAGE_ID, focusCaseId = 2 }) => {
  const cases = HJ_PAGE_CASES;
  const active = cases.find(c => c.caseId === focusCaseId) || cases[0];
  const counts = {
    crosspage: cases.filter(c => c.kind === 'crosspage').length,
    validated: cases.filter(c => c.status === 'joined' && c.validated).length,
    joined:    cases.filter(c => c.status === 'joined' && !c.validated).length,
    undecided: cases.filter(c => c.status === 'undecided').length,
    flagged:   cases.filter(c => c.status === 'flagged').length,
  };
  return (
    <>
      <HyphenSubhead
        title="Page workbench · Hyphen join"
        sub={<>End-of-line hyphens on this single page, before and after the rule library decides. <span className="mono">{counts.crosspage}</span> cross-page · <span className="mono">{counts.validated}</span> validated · <span className="mono">{counts.joined}</span> auto-joined · <span className="mono">{counts.undecided}</span> undecided · <span className="mono">{counts.flagged}</span> flagged.</>}
        right={
          <>
            <Button variant="ghost" size="sm" icon="chevL">Prev page</Button>
            <Button variant="ghost" size="sm" iconRight="chevR">Next page</Button>
            <Divider vertical style={{ height: 22 }} />
            <Button variant="primary" size="sm" iconRight="arrowR">Apply &amp; Continue</Button>
          </>
        }
      />
      <div style={{
        padding: '14px 28px 28px', flex: 1, minHeight: 0,
        display: 'grid', gridTemplateColumns: '300px 1fr', gap: 14,
      }}>
        {/* Left drawer — cases on this page + legend */}
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderRadius: 8,
          display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--border-1)',
          }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--ink-4)',
            }}>Cases on this page</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{pageId}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>· {HJ_PAGE_IDX} / 232</span>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{cases.length} hyphens</span>
            </div>
          </div>
          <div style={{
            flex: 1, minHeight: 0, overflow: 'auto',
            padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {cases.map(c => (
              <HJPageCaseRow key={c.caseId} c={c} active={c.caseId === active.caseId} />
            ))}
            {/* Legend */}
            <div style={{
              marginTop: 4, padding: '10px 12px', borderRadius: 7,
              background: 'var(--bg-page)', border: '1px solid var(--border-1)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
                textTransform: 'uppercase', color: 'var(--ink-4)',
              }}>Legend</span>
              {[
                { tone: HJ_STATUS_TONE.crosspage, label: 'cross-page · special routing' },
                { tone: HJ_STATUS_TONE.validated, label: 'validated · human confirmed' },
                { tone: HJ_STATUS_TONE.joined,    label: 'auto-joined · awaiting check', dashed: true },
                { tone: HJ_STATUS_TONE.undecided, label: 'undecided · no rule match' },
                { tone: HJ_STATUS_TONE.flagged,   label: 'flagged · mismatch in book' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 18, height: 10, borderRadius: 2,
                    background: `color-mix(in oklab, ${row.tone} ${row.dashed ? 14 : 22}%, transparent)`,
                    border: `1px ${row.dashed ? 'dashed' : 'solid'} color-mix(in oklab, ${row.tone} 60%, var(--border-1))`,
                  }} />
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{row.label}</span>
                </div>
              ))}
            </div>
            <div style={{
              padding: '7px 10px', borderRadius: 6,
              background: 'var(--bg-page)', border: '1px solid var(--border-1)',
              fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.45,
              display: 'flex', alignItems: 'flex-start', gap: 6,
            }}>
              <Icon name="info" size={11} style={{ color: 'var(--ink-4)', marginTop: 1 }} />
              <span>Click a hyphen in either column to focus it here. <Kbd>J</Kbd>/<Kbd>K</Kbd> walks the list.</span>
            </div>
          </div>
        </div>

        {/* Right viewer — before/after split + decision card */}
        <div style={{
          minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {/* Toolbar */}
          <div style={{
            padding: '8px 14px', borderRadius: 8,
            background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-1)', fontWeight: 600 }}>{pageId}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>·</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              before / after · all hyphens shown
            </span>
            <Divider vertical style={{ height: 18 }} />
            <Button variant="ghost" size="sm" icon="eye">Highlight only cross-page</Button>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
              joined output cache:{' '}
              <span style={{ color: counts.undecided + counts.flagged > 0 ? 'var(--fuzzy)' : 'var(--exact)', fontWeight: 600 }}>
                {counts.undecided + counts.flagged > 0 ? 'awaits decisions' : 'fresh'}
              </span>
            </span>
          </div>

          {/* Split: Before | After */}
          <div style={{
            flex: 1, minHeight: 0,
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
          }}>
            <HJBeforeView activeId={active.caseId} />
            <HJAfterView  activeId={active.caseId} />
          </div>

          {/* Decision card */}
          <HJDecisionCard active={active} />
        </div>
      </div>
    </>
  );
};

Object.assign(window, {
  HyphenPageWorkbench,
});
