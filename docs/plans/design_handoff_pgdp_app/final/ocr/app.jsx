// app.jsx — OCR stage (stage 10, OCR group). Recognises glyphs → tokens;
// Recognition tab overlays words on the page coloured by confidence.

const { useState: useStOC, useEffect: useEfOC } = React;

function App() {
  const [theme, setTheme] = useStOC(() => localStorage.getItem('pgd-theme') || 'light');
  useEfOC(() => localStorage.setItem('pgd-theme', theme), [theme]);
  const W = 1440, H = 980, Hr = 1040;
  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="ocr" />
      <DesignCanvas
        title="10 · OCR — final"
        subtitle="Recognises glyphs → tokens on the binarized, zoned pages (Tesseract 5). Every page gets a mean model score and per-word scores; low-score words surface for review in the Recognition tab, which overlays the recognised text on the page image coloured by confidence. The Spellcheck stage catches what's left."
        sectionGap={64}
      >
        <DCSection id="OCR" title="OCR · stage 10 (wired up)" subtitle="Overview · Pages · Recognition · Stage settings — rendered inside PipelineTemplate.">
          <DCArtboard id="OC-WB" label="WB ★ · Page workbench · glyph confidence + low-conf tokens" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="workbench">
              <PageWorkbench stage="ocr" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-A" label="A · Pages · running · 188/387 recognised · 3.2/s · Tesseract 5.3" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="pages"><OcrPages state="running" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-B" label="B · Pages · review · score ribbons + % · 18 flagged" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="pages"><OcrPages state="review" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-R" label="C · Recognition tab · word boxes on page + low-score tokens + histogram" width={W} height={Hr}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="recognition"><OcrRecognition /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-E" label="D · Pages · filter=flagged · garbled / dict-miss / mixed-script / rotated" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="pages"><OcrPages state="review" density="M" filter="flagged" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-F" label="E · Pages · density L · score ribbons prominent" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="pages"><OcrPages state="review" density="L" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-G" label="F · Overview · stats + score histogram + page flags + activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="overview"><OcrOverview state="review" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-H" label="G · Stage settings · DocTR · GPU·CUDA (your model, default)" width={W} height={1160}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="settings"><OcrStepSettings state="default" engine="doctr" backend="gpu" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-H-cpu" label="G' · Stage settings · DocTR · CPU fallback (no CUDA · slower)" width={W} height={1160}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="settings"><OcrStepSettings state="default" engine="doctr" backend="cpu" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-H-tess" label="G'' · Stage settings · Tesseract fallback (CPU · langpack + psm config)" width={W} height={1120}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="settings"><OcrStepSettings state="default" engine="tesseract" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="OC-H-mod" label="G''' · Stage settings · modified · stale-bump + per-page overrides" width={W} height={1160}>
            <PipelineTemplate theme={theme} stage="ocr" currentTab="settings"><OcrStepSettings state="modified" engine="doctr" backend="gpu" /></PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
