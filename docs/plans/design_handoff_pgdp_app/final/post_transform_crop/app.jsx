// app.jsx — Post-transform crop (stage 7, Image group). Re-crops the
// flattened/deskewed bilevel page tight to its true edges; trims rotation
// wedges + resample fringe the geometry passes introduced.

const { useState: useStPT, useEffect: useEfPT } = React;

function App() {
  const [theme, setTheme] = useStPT(() => localStorage.getItem('pgd-theme') || 'light');
  useEfPT(() => localStorage.setItem('pgd-theme', theme), [theme]);
  const W = 1440, H = 980;
  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="post_transform_crop" />
      <DesignCanvas
        title="7 · Post-transform crop — final"
        subtitle="The second of three crops. Runs after Dewarp + Deskew, on the flattened bilevel page. Those transforms move the page — flattening shifts the edges and rotation leaves black triangular wedges in the corners — so this pass re-finds the true rectangle and trims the artifacts the Rough crop couldn't have known about. The content-aware Post-OCR crop comes later."
        sectionGap={64}
      >
        <DCSection id="PTC" title="Post-transform crop · stage 7 (wired up)" subtitle="Pages · Overview · Stage settings — rendered inside PipelineTemplate.">
          <DCArtboard id="PT-WB" label="WB ★ · Page workbench · re-crop · trims rotation wedges" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="workbench">
              <PageWorkbench stage="post_transform_crop" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-A" label="A · Pages · running · 198/387 re-cropped · 12.1/s" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="pages"><PtcPages state="running" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-B" label="B · Pages · review · 21 flagged · rotation wedges + resample fringe" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="pages"><PtcPages state="review" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-C" label="C · Pages · 3 selected · bulk bar (Trim wedges)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="pages"><PtcPages state="review" density="M" filter="all" selected={[3, 4, 14]} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-D" label="D · Pages · inline tighten-crop editor (p0004 · rot-corner)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="pages"><PtcPages state="review" density="M" filter="flagged" editing={3} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-E" label="E · Pages · filter=flagged · per-flag drill-down" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="pages"><PtcPages state="review" density="M" filter="flagged" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-F" label="F · Pages · density L · wedges + bboxes visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="pages"><PtcPages state="review" density="L" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-G" label="G · Overview · stats + why-second-crop + flags + activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="overview"><PtcOverview state="review" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-H" label="H · Stage settings · default" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="settings"><PtcStepSettings state="default" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-H-mod" label="H' · Stage settings · modified · stale-bump" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="settings"><PtcStepSettings state="modified" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PT-H-preset" label="H'' · Stage settings · preset (Heavy bindings)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_transform_crop" currentTab="settings"><PtcStepSettings state="preset" /></PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
