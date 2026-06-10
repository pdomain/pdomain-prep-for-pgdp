// app.jsx — Dewarp stage (stage 4). Wired-up canvas for auto-dewarp +
// before/after review + bulk re-run. Renders inside PipelineTemplate.

const { useState: useStDW, useEffect: useEfDW } = React;

function App() {
  const [theme, setTheme] = useStDW(() => localStorage.getItem('pgd-theme') || 'light');
  useEfDW(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 940;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="dewarp" />
      <DesignCanvas
        title="5 · Dewarp stage — final"
        subtitle="Removes the curved-page distortion book bindings leave along the gutter (the 'smile'). Runs after Threshold and reads the binarized page — crisp text lines make the warp-mesh fit more reliable. Fits a 2D warp mesh per page from text-line + edge curvature, resamples to flat. Low-score / extreme-curve pages surface for a before/after review. Same bulk re-run loop as Crop."
        sectionGap={64}
      >
        <DCSection
          id="Dewarp"
          title="Dewarp · Dewarp stage (wired up)"
          subtitle="Pages · Overview · Stage settings — all rendered inside PipelineTemplate."
        >
          <DCArtboard id="DW-WB" label="WB ★ · Page workbench · warp mesh + flattened preview" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="workbench">
              <PageWorkbench stage="dewarp" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-A" label="A · Pages · running · 142/387 dewarped · 5.1/s · skeletons interleaved" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="pages">
              <DewarpPages state="running" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-B" label="B · Pages · review · 22 flagged · density M (default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="pages">
              <DewarpPages state="review" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-C" label="C · Pages · 3 selected · bulk-action sticky bar" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="pages">
              <DewarpPages state="review" density="M" filter="all" selected={[4, 7, 14]} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-D" label="D · Pages · inline before/after wipe editor (p0005 · extreme-curve)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="pages">
              <DewarpPages state="review" density="M" filter="flagged" editing={4} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-D2" label="D' · Editor with warp-mesh overlay revealed" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="pages">
              <DewarpPages state="review" density="M" filter="flagged" editing={7} showMesh={true} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-E" label="E · Pages · filter=flagged · per-flag drill-down chips" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="pages">
              <DewarpPages state="review" density="M" filter="flagged" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-F" label="F · Pages · density L · bigger thumbs · curvature badges" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="pages">
              <DewarpPages state="review" density="L" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-G" label="G · Overview tab · stats grid + flag distribution + recent activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="overview">
              <DewarpOverview state="review" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-H" label="H · Stage settings · default (inheriting project default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="settings">
              <DewarpStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-H-mod" label="H' · Stage settings · modified · stale-bump warning visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="settings">
              <DewarpStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DW-H-preset" label="H'' · Stage settings · preset applied (Tight binding · hardcover)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="dewarp" currentTab="settings">
              <DewarpStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
