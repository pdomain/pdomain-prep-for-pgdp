// app.jsx — Finalized Projects page boards.
// 6 boards covering every documented state of the locked design.

const { useState: useStCG, useEffect: useEfCG } = React;

function App() {
  const [theme, setTheme] = useStCG(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCG(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const themeToggle = (
    <div style={{
      position: 'fixed', top: 12, right: 16, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'rgba(21,21,27,0.85)', backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999,
      padding: '3px 4px', boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', fontSize: 12.5,
    }}>
      {['light', 'dark'].map(t => (
        <button key={t} onClick={() => setTheme(t)} style={{
          border: 0, cursor: 'pointer',
          background: theme === t ? '#d6925a' : 'transparent',
          color: theme === t ? '#1a0f08' : '#b0b0b8',
          padding: '5px 12px', borderRadius: 999, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name={t === 'dark' ? 'moon' : 'sun'} size={13} />
          {t === 'dark' ? 'Dark' : 'Light'}
        </button>
      ))}
    </div>
  );

  const W = 1440, H = 900;

  return (
    <>
      {themeToggle}
      <DesignCanvas
        title="1 · Projects — final"
        subtitle="Locked design for the top-level Projects page. AppTemplate (shared header + breadcrumb + content-controls) hosts a left rail (Active / Archived segmented tabs) and a detail pane with three tabs: Recent activity / Attributes / Manage. New section X covers the post-import transition (Pa redirect + Pb drawer)."
        sectionGap={64}
      >
        <DCSection
          id="P"
          title="P · Project detail — every tab state"
          subtitle="Same shell, three tabs. Active project drives Activity / Attributes / Manage(step-1 delete); archived project drives Manage(permanent delete)."
        >
          <DCArtboard id="P1" label="1 · Recent activity (default)" width={W} height={H}>
            <ProjectsPage theme={theme} defaultTab="activity" selectedId="austen-emma-vol2" />
          </DCArtboard>
          <DCArtboard id="P2" label="2 · Attributes — collapsible 2-col reflow" width={W} height={H}>
            <ProjectsPage theme={theme} defaultTab="attributes" selectedId="austen-emma-vol2" />
          </DCArtboard>
          <DCArtboard id="P3" label="3 · Manage (active) — Delete is step 1 (clean + archive)" width={W} height={H}>
            <ProjectsPage theme={theme} defaultTab="manage" selectedId="austen-emma-vol2" />
          </DCArtboard>
          <DCArtboard id="P4" label="4 · Manage (archived) — Delete is permanent" width={W} height={H}>
            <ProjectsPage theme={theme} defaultTab="manage" selectedId="stevenson-kidnapped" />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="R"
          title="R · Rail states"
          subtitle="Same screen, with the rail's segmented tab switched. Archived rows are dimmer and show 'archived <date>' instead of last-updated."
        >
          <DCArtboard id="R1" label="5 · Rail · Archived tab selected" width={W} height={H}>
            <ProjectsPage theme={theme} defaultTab="activity" selectedId="stevenson-kidnapped" />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="E"
          title="E · Empty state"
          subtitle="First-run user with zero projects. Same chrome, full-bleed hero in the content slot."
        >
          <DCArtboard id="E1" label="6 · Empty state · first run" width={W} height={H}>
            <ProjectsEmpty theme={theme} />
          </DCArtboard>
        </DCSection>

        <DCSection
          id="X"
          title="X · Post-import transition · Pa + Pb"
          subtitle="After the user clicks Start on a new project, two coordinated paths: Pa redirects to the new project's pipeline view with thumbnails as stage 1. Pb keeps the user anchored on whatever they had selected and parks the import in the header JobsPill + bottom-right JobsDrawer until done."
        >
          <DCArtboard id="X1" label="7 · Pa · auto-redirect to new project · header pill active" width={W} height={H}>
            <PostImport_Redirect theme={theme} />
          </DCArtboard>
          <DCArtboard id="X1-hover" label="8 · Pa · header Jobs pill open · popover" width={W} height={H}>
            <PostImport_Redirect theme={theme} jobsOpen />
          </DCArtboard>
          <DCArtboard id="X2" label="9 · Pb · drawer expanded · thumbnails running · row hover" width={W} height={H}>
            <PostImport_Drawer theme={theme} drawerMode="expanded" scenario="thumbs" />
          </DCArtboard>
          <DCArtboard id="X3" label="10 · Pb · drawer collapsed · ingest 87%" width={W} height={H}>
            <PostImport_Drawer theme={theme} drawerMode="collapsed" scenario="ingest" />
          </DCArtboard>
          <DCArtboard id="X4" label="11 · Pb · drawer · job done · shimmer + Open" width={W} height={H}>
            <PostImport_Drawer theme={theme} drawerMode="expanded" scenario="done" />
          </DCArtboard>
          <DCArtboard id="X5" label="12 · Pb · drawer dismissed · tombstone toast" width={W} height={H}>
            <PostImport_Drawer theme={theme} drawerMode="dismissed" scenario="dismissed-toast" />
          </DCArtboard>
          <DCArtboard id="X6" label="13 · Pb · header pill · 2 concurrent jobs (import + OCR)" width={W} height={H}>
            <PostImport_Drawer theme={theme} drawerMode="dismissed" scenario="two-jobs" jobsOpen />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
