// app.jsx — Canvas map (stage 14, Compose group). Places every page on one
// common canvas: derives a common aspect ratio from the body-text pages,
// margins everyone uniformly, and handles split children + facing-page
// sidenotes (mirrored outer margins).

const { useState: useStCM, useEffect: useEfCM } = React;

function App() {
  const [theme, setTheme] = useStCM(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCM(() => localStorage.setItem('pgd-theme', theme), [theme]);
  const W = 1440, Hn = 980, He = 1160, Hg = 1040;
  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="canvas_map" />
      <DesignCanvas
        title="13 · Canvas map — final"
        subtitle="The final composition step. Places every cropped page onto ONE common canvas: derives a common aspect ratio from the pages that are mostly body text (not the plates/outliers), centres each page and adds uniform margins. Special handling: page-split children get a rebuilt cut-edge margin, and facing-page sidenotes widen + mirror the OUTER margin across verso/recto so spreads read symmetric."
        sectionGap={64}
      >
        <DCSection id="CMAP" title="Canvas map · stage 13 (wired up)" subtitle="Overview (aspect analysis) · Pages · Facing pages · Stage settings — rendered inside PipelineTemplate.">
          <DCArtboard id="CM-A" label="A · Pages · running · 240/387 placed · 16.2/s · canvas 2480×3400" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="running" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-B" label="B · Pages · review · 17 flagged · pages on canvas w/ margin guides" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="review" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-Side" label="C · Pages · filter=sidenotes · outer margin widened (L on verso, R on recto)" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="review" density="M" filter="sidenotes" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-Split" label="D · Pages · filter=split children · rebuilt cut-edge margin" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="review" density="M" filter="splits" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-E" label="E · Place editor · sidenote page (p0005) + facing-spread mirror preview" width={W} height={He}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="review" density="M" filter="sidenotes" editing={4} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-E2" label="E' · Place editor · split child (p0003a) · rebuild inner margin" width={W} height={He}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="review" density="M" filter="splits" editing={2} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-E3" label="E'' · Place editor · oversize (p0008) · scale-to-fit / exclude" width={W} height={He}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="review" density="M" filter="flagged" editing={7} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-Spreads" label="F · Facing pages tab · verso|recto spreads with mirrored margins" width={W} height={Hg}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="spreads"><CmapSpreads /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-G" label="G · Pages · density L · margin guides + L/R side badges" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="pages"><CmapPages state="review" density="L" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-H" label="H · Overview · aspect-ratio analysis (scatter) + stats + flags + activity" width={W} height={Hg}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="overview"><CmapOverview state="review" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-I" label="I · Stage settings · default · target canvas + margins + mirror + sidenote/split" width={W} height={Hg}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="settings"><CmapStepSettings state="default" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-I-mod" label="I' · Stage settings · modified · stale-bump" width={W} height={Hg}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="settings"><CmapStepSettings state="modified" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="CM-I-preset" label="I'' · Stage settings · preset (Octavo · annotated)" width={W} height={Hg}>
            <PipelineTemplate theme={theme} stage="canvas_map" currentTab="settings"><CmapStepSettings state="preset" /></PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
