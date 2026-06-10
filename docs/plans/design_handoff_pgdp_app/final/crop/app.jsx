// app.jsx — Crop stage (stage 2). Wired-up canvas for auto-crop +
// flagged-page review + bulk re-run. Renders inside PipelineTemplate.

const { useState: useStCG, useEffect: useEfCG } = React;

function App() {
  const [theme, setTheme] = useStCG(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCG(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 940;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="crop" />
      <DesignCanvas
        title="3 · Rough crop stage — final"
        subtitle="The coarse first pass: auto-crops every page to roughly the printed rectangle, dropping the scanner bed, edge shadows, fingers and jig — keeping generous margins. Two finer crops follow downstream (post-transform crop after dewarp/deskew, post-OCR crop once content is known), so this pass errs on the side of keeping too much. User reviews flagged pages, tunes per-page bboxes inline, or bulk re-runs."
        sectionGap={64}
      >
        <DCSection
          id="Crop"
          title="Rough crop · stage 3 (wired up)"
          subtitle="Pages · Overview · Step settings — all rendered inside PipelineTemplate."
        >
          <DCArtboard id="Crop-A" label="A · Pages · running · 285/387 cropped · 8.4/s · skeletons interleaved" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="pages">
              <CropPages state="running" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-B" label="B · Pages · review · 31 flagged · density M (default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="pages">
              <CropPages state="review" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-WB" label="WB ★ · Page workbench · flagged p0123 · crop frame + re-detect" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="workbench">
              <PageWorkbench stage="crop" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-C" label="C · Pages · 3 selected · bulk-action sticky bar" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="pages">
              <CropPages state="review" density="M" filter="all" selected={[4, 7, 11]} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-D" label="D · Pages · inline bbox editor on a flagged thumb (p0005 · over+asymmetric)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="pages">
              <CropPages state="review" density="M" filter="flagged" editing={4} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-E" label="E · Pages · filter=flagged · per-flag drill-down chips" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="pages">
              <CropPages state="review" density="M" filter="flagged" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-F" label="F · Pages · density L · bigger thumbs · more flag chips visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="pages">
              <CropPages state="review" density="L" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-G" label="G · Overview tab · stats grid + flag distribution + recent activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="overview">
              <CropOverview state="review" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-H" label="H · Stage settings · default (inheriting project default · edge-detect)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="settings">
              <CropStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-H-mod" label="H' · Stage settings · modified · stale-bump warning visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="settings">
              <CropStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Crop-H-preset" label="H'' · Stage settings · preset applied (Aggressive trim · newsprint)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="crop" currentTab="settings">
              <CropStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
