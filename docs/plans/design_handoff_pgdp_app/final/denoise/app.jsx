// app.jsx — Denoise stage (stage 7, Image group). Wired-up canvas for
// OCR-guided despeckle: a first-pass word/mark detector protects marginal
// marks, then the cleaner removes speckle/blobs without eroding text.

const { useState: useStDN, useEffect: useEfDN } = React;

function App() {
  const [theme, setTheme] = useStDN(() => localStorage.getItem('pgd-theme') || 'light');
  useEfDN(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 980;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="denoise" />
      <DesignCanvas
        title="8 · Denoise stage — final"
        subtitle="Cleans the bilevel output: speckle, pin-holes, ink-bleed blobs — without eroding text. Sitting right after Deskew, it also clears the jagged edges and stray pixels that dewarp/deskew resampling can leave on a 1-bit page. The catch: a blind despeckler can't tell a printer's signature mark or a foot page-number from a stray speckle. So denoise runs a fast FIRST-PASS word/mark detector first and protects anything that reads as intentional ink. Full recognition still happens later at stage 10 · OCR."
        sectionGap={64}
      >
        <DCSection
          id="Denoise"
          title="Denoise · Denoise stage (wired up)"
          subtitle="Pages · Overview · Stage settings — all rendered inside PipelineTemplate. The first-pass detect → protect → clean loop runs through every board."
        >
          <DCArtboard id="DN-WB" label="WB ★ · Page workbench · before/after · protected marks" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="workbench">
              <PageWorkbench stage="denoise" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-A" label="A · Pages · running · 154/387 cleaned · 9.6/s · detecting + despeckling" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="running" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-B" label="B · Pages · review · 18 flagged · first-pass strip + protected pills · density M" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="review" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-C" label="C · Pages · 3 selected · bulk-action sticky bar (incl. Keep protected)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="review" density="M" filter="all" selected={[3, 4, 14]} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-D" label="D · Pages · inline editor · resolve a protect-conflict (p0004 · sig. mark 52%)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="review" density="M" filter="flagged" editing={3} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-D2" label="D' · Inline editor · mark-at-risk (p0010 · faint foot page-no. 41%)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="review" density="M" filter="flagged" editing={9} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-E" label="E · Pages · filter=flagged · per-flag drill-down chips" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="review" density="M" filter="flagged" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-P" label="P · Pages · filter=protected · every page with kept marginal marks" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="review" density="M" filter="protected" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-F" label="F · Pages · density L · bigger thumbs · protected pills + Δblack" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="pages">
              <DenoisePages state="review" density="L" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-G" label="G · Overview · stats + first-pass summary + why-order note + flags + activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="overview">
              <DenoiseOverview state="review" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-H" label="H · Stage settings · default · first-pass detection section + clean controls" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="settings">
              <DenoiseStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-H-mod" label="H' · Stage settings · modified · stale-bump warning visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="settings">
              <DenoiseStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="DN-H-preset" label="H'' · Stage settings · preset applied (Heavy speckle · microfilm)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="denoise" currentTab="settings">
              <DenoiseStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
