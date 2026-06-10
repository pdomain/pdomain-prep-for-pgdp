// app.jsx — Post-OCR crop (stage 13, Compose group). Content-aware crop to the
// true text/zone extent; protects sidenotes, decides keep/drop on folio marks.

const { useState: useStPO, useEffect: useEfPO } = React;

function App() {
  const [theme, setTheme] = useStPO(() => localStorage.getItem('pgd-theme') || 'light');
  useEfPO(() => localStorage.setItem('pgd-theme', theme), [theme]);
  const W = 1440, H = 980;
  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="post_ocr_crop" />
      <DesignCanvas
        title="12 · Post-OCR crop — final"
        subtitle="The third and final content crop. Runs after OCR + layout, so it crops to the true content extent — text-block ∪ kept sidenotes ∪ illustration zones — instead of guessing from page edges. Trims dead margin precisely without clipping real ink, and decides what to do with stray folio marks. Sidenote pages forward their outer-margin needs to Canvas map."
        sectionGap={64}
      >
        <DCSection id="POC" title="Post-OCR crop · stage 12 (wired up)" subtitle="Pages · Overview · Stage settings — rendered inside PipelineTemplate.">
          <DCArtboard id="PO-WB" label="WB ★ · Page workbench · content crop · sidenote protected" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="workbench">
              <PageWorkbench stage="post_ocr_crop" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-A" label="A · Pages · running · 221/387 cropped · 10.4/s" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="pages"><PocPages state="running" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-B" label="B · Pages · review · 19 flagged · content bbox vs crop · L/R side" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="pages"><PocPages state="review" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-C" label="C · Pages · 3 selected · bulk bar (Keep sidenotes / Drop stray)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="pages"><PocPages state="review" density="M" filter="all" selected={[4, 7, 11]} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-D" label="D · Pages · inline editor · sidenote-clip (p0005 · verso, left margin)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="pages"><PocPages state="review" density="M" filter="flagged" editing={4} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-D2" label="D' · Inline editor · sidenote-clip (p0012 · recto, right margin)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="pages"><PocPages state="review" density="M" filter="flagged" editing={11} /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-E" label="E · Pages · filter=flagged · per-flag drill-down" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="pages"><PocPages state="review" density="M" filter="flagged" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-F" label="F · Pages · density L · content + crop boxes visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="pages"><PocPages state="review" density="L" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-G" label="G · Overview · stats + content-aware note + flags + activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="overview"><PocOverview state="review" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-H" label="H · Stage settings · default (Text + sidenotes)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="settings"><PocStepSettings state="default" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-H-mod" label="H' · Stage settings · modified · stale-bump" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="settings"><PocStepSettings state="modified" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="PO-H-preset" label="H'' · Stage settings · preset (Annotated edition)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="post_ocr_crop" currentTab="settings"><PocStepSettings state="preset" /></PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
