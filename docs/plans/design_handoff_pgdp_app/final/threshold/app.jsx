// app.jsx — Threshold stage (stage 6, Image group). Wired-up canvas for
// grayscale → bilevel binarization + flag review + bulk re-run. Renders
// inside PipelineTemplate.

const { useState: useStTH, useEffect: useEfTH } = React;

function App() {
  const [theme, setTheme] = useStTH(() => localStorage.getItem('pgd-theme') || 'light');
  useEfTH(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 940;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="threshold" />
      <DesignCanvas
        title="4 · Threshold stage — final"
        subtitle="Binarizes the cropped grayscale page to bilevel (pure black/white) early, so the geometry stages get a crisp signal to work from. Auto-picks Sauvola / Otsu / adaptive per page; low-contrast, bleed-through, speckle and ink-bleed pages surface for a before/after + histogram review. Dewarp and Deskew run next and read these bilevel pages. Same bulk re-run loop as Crop."
        sectionGap={64}
      >
        <DCSection
          id="Threshold"
          title="Threshold · Threshold stage (wired up)"
          subtitle="Pages · Overview · Stage settings — all rendered inside PipelineTemplate."
        >
          <DCArtboard id="TH-WB" label="WB ★ · Page workbench · bilevel preview · before/after curtain" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="workbench">
              <PageWorkbench stage="threshold" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-A" label="A · Pages · running · 168/387 binarized · 14.8/s · skeletons interleaved" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="pages">
              <ThresholdPages state="running" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-B" label="B · Pages · review · 26 flagged · density M (default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="pages">
              <ThresholdPages state="review" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-C" label="C · Pages · 3 selected · bulk-action sticky bar" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="pages">
              <ThresholdPages state="review" density="M" filter="all" selected={[4, 11, 14]} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-D" label="D · Pages · inline before/after + histogram editor (p0005 · bleed-through)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="pages">
              <ThresholdPages state="review" density="M" filter="flagged" editing={4} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-E" label="E · Pages · filter=flagged · per-flag drill-down chips" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="pages">
              <ThresholdPages state="review" density="M" filter="flagged" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-F" label="F · Pages · density L · bigger thumbs · method + black% badges" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="pages">
              <ThresholdPages state="review" density="L" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-G" label="G · Overview tab · stats + method mix + flag distribution + activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="overview">
              <ThresholdOverview state="review" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-H" label="H · Stage settings · default (inheriting project default · Sauvola)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="settings">
              <ThresholdStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-H-mod" label="H' · Stage settings · modified (Otsu · window/k disabled) · stale-bump" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="settings">
              <ThresholdStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TH-H-preset" label="H'' · Stage settings · preset applied (Faded newsprint · adaptive)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="threshold" currentTab="settings">
              <ThresholdStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
