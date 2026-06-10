// app.jsx — Deskew stage (stage 5). Wired-up canvas for auto-deskew +
// before/after angle review + bulk re-run. Renders inside PipelineTemplate.

const { useState: useStDK, useEffect: useEfDK } = React;

function App() {
  const [theme, setTheme] = useStDK(() => localStorage.getItem('pgd-theme') || 'light');
  useEfDK(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 940;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="deskew" />
      <DesignCanvas
        title="6 · Deskew stage — final"
        subtitle="After dewarp flattens the page, deskew measures the residual rotation (text baselines vs horizontal) and rotates each page to a true rectangle. Works on the binarized page, so baselines are crisp to measure. Low-score, extreme-angle, and residual-skew pages surface for a before/after review against baseline guides. Same bulk re-run loop as Crop."
        sectionGap={64}
      >
        <DCSection
          id="Deskew"
          title="Deskew · Deskew stage (wired up)"
          subtitle="Pages · Overview · Stage settings — all rendered inside PipelineTemplate."
        >
          <DCArtboard id="DK-WB" label="WB ★ · Page workbench · baseline guides · −2.4° → 0°" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="workbench">
              <PageWorkbench stage="deskew" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-A" label="A · Pages · running · 210/387 deskewed · 11.3/s · skeletons interleaved" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="pages">
              <DeskewPages state="running" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-B" label="B · Pages · review · 19 flagged · density M (default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="pages">
              <DeskewPages state="review" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-C" label="C · Pages · 3 selected · bulk-action sticky bar" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="pages">
              <DeskewPages state="review" density="M" filter="all" selected={[4, 7, 14]} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-D" label="D · Pages · inline before/after angle editor (p0005 · extreme-skew)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="pages">
              <DeskewPages state="review" density="M" filter="flagged" editing={4} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-E" label="E · Pages · filter=flagged · per-flag drill-down chips" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="pages">
              <DeskewPages state="review" density="M" filter="flagged" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-F" label="F · Pages · density L · bigger thumbs · angle badges" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="pages">
              <DeskewPages state="review" density="L" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-G" label="G · Overview tab · stats grid + flag distribution + recent activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="overview">
              <DeskewOverview state="review" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-H" label="H · Stage settings · default (inheriting project default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="settings">
              <DeskewStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-H-mod" label="H' · Stage settings · modified · stale-bump warning visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="settings">
              <DeskewStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DK-H-preset" label="H'' · Stage settings · preset applied (Loose-leaf scans)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="deskew" currentTab="settings">
              <DeskewStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
