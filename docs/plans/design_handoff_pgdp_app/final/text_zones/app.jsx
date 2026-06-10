// app.jsx — Page layout stage (stage 9, OCR group; id text_zones). Layout
// detection: typed zones + reading order, illustration detection with manual
// box/lasso capture, and an optional layout-driven column/row PAGE SPLIT.

const { useState: useStTZ, useEffect: useEfTZ } = React;

function App() {
  const [theme, setTheme] = useStTZ(() => localStorage.getItem('pgd-theme') || 'light');
  useEfTZ(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, Hn = 980, He = 1200;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="text_zones" />
      <DesignCanvas
        title="9 · Page layout — final"
        subtitle="First stage of the OCR group (id: text_zones). Detects the structure of each page — heading / body / running head+foot / marginalia / illustration / caption / table / footnote — and a reading order. Detects illustrations (and lets you box or lasso ones it missed). When a page is really two — side-by-side columns or stacked blocks — it offers a layout-driven PAGE SPLIT into child pages."
        sectionGap={64}
      >
        <DCSection
          id="PageLayout"
          title="Page layout · stage 9 (wired up)"
          subtitle="Overview · Pages · Page splits · Stage settings — rendered inside PipelineTemplate. Click a page to edit its layout (draw/lasso) or resolve a split."
        >
          <DCArtboard id="TZ-WB" label="WB ★ · Page workbench · zones + reading order · p0123" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="workbench">
              <PageWorkbench stage="text_zones" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-A" label="A · Pages · running · 176/387 segmented · 6.8/s · 4 splits offered" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="pages">
              <ZonePages state="running" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-B" label="B · Pages · review · zone overlays + type legend · density M" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="pages">
              <ZonePages state="review" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-C" label="C · Page splits tab · the 7 column/row split candidates" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="splits">
              <ZonePages state="review" density="M" filter="splits" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-D" label="D · Split editor · column split (p0003 · 88%) → source ⇒ 2 child pages" width={W} height={He}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="splits">
              <ZonePages state="review" density="M" filter="splits" editing={2} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-D2" label="D' · Split editor · row split (p0007 · 74%) → stacked into 2 pages" width={W} height={He}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="splits">
              <ZonePages state="review" density="M" filter="splits" editing={6} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-E" label="E · Layout editor · draw a box around an illustration the detector missed" width={W} height={He}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="pages">
              <ZonePages state="review" density="M" filter="all" editing={3} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-E2" label="E' · Layout editor · re-typing a flagged zone (p0012 · stray-zone)" width={W} height={He}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="pages">
              <ZonePages state="review" density="M" filter="flagged" editing={11} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-F" label="F · Pages · filter=flagged · merged-blocks / table / overlap / stray" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="pages">
              <ZonePages state="review" density="M" filter="flagged" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-G" label="G · Pages · density L · bigger thumbs · reading-order badges visible" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="pages">
              <ZonePages state="review" density="L" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-H" label="H · Overview · stats + zone-type distribution + layout flags + activity" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="overview">
              <ZoneOverview state="review" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-I" label="I · Stage settings · default · page-splitting + illustration + layout controls" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="settings">
              <ZoneStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-I-mod" label="I' · Stage settings · modified (splits off) · stale-bump warning" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="settings">
              <ZoneStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TZ-I-preset" label="I'' · Stage settings · preset applied (Two-column journal)" width={W} height={Hn}>
            <PipelineTemplate theme={theme} stage="text_zones" currentTab="settings">
              <ZoneStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
