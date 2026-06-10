// app.jsx — final/template on a design canvas, matching the other WF pages.

const { useState: useStCG, useEffect: useEfCG } = React;

function App() {
  const [theme, setTheme] = useStCG(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCG(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const themeToggle = null;

  const W = 1440, H = 900;

  const EmptySlot = () => (
    <div style={{
      height: '100%', minHeight: 480,
      border: '1px dashed var(--border-2)', borderRadius: 10,
      background: 'repeating-linear-gradient(135deg, transparent 0 14px, color-mix(in oklab, var(--border-1) 35%, transparent) 14px 15px)',
      display: 'grid', placeItems: 'center', color: 'var(--ink-3)',
    }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          content slot
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Drop the screen body here.
        </div>
      </div>
    </div>
  );

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="template" />
      <DesignCanvas
        title="pgdp-prep · final · app shell template"
        subtitle="Canonical 'all pages' frame for locked-in decisions: app header (icon + name · search · bell + username) and breadcrumb with a content-controls strip, with a blank content slot below. Every final screen is built by dropping into this template."
        sectionGap={56}
      >
        <DCSection
          id="T"
          title="T · App shell template"
          subtitle="Same chrome on every page. Header (app icon + name · search · bell + username) + breadcrumb with content-controls slot. Theme follows the toggle in the top-right corner."
        >
          <DCArtboard id="T1" label="1 · App shell · empty content slot" width={W} height={H}>
            <AppTemplate
              theme={theme}
              trail={[{ label: 'Projects' }, { label: 'belloc-survivals', mono: true }]}>
              <EmptySlot />
            </AppTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
