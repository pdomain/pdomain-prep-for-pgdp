// app.jsx — Wordcheck stage (stage 12, OCR group). Catches scannos — OCR
// scan errors — incl. stealth scannos (real but wrong words). Runs after Page
// order, before Hyphen join; flagged suspects feed the later Text review.

const { useState: useStSC, useEffect: useEfSC } = React;

function App() {
  const [theme, setTheme] = useStSC(() => localStorage.getItem('pgd-theme') || 'light');
  useEfSC(() => localStorage.setItem('pgd-theme', theme), [theme]);
  const W = 1440, H = 980, Hq = 1060;
  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="wordcheck" />
      <DesignCanvas
        title="15 · Wordcheck — final"
        subtitle="Catches scannos — OCR scan errors — in the recognised text. Ordinary scannos fail the lexicon; STEALTH scannos (arid→and, be→he) are real words a plain spellcheck misses, caught by a curated list + context. Suspects queue for the proofer; cleared text flows to Hyphen join. Runs before Hyphen join; the human Text review comes later, before Proof pack."
        sectionGap={64}
      >
        <DCSection id="SC" title="Wordcheck · stage 15 (wired up)" subtitle="Overview · Suspects · Pages · Stage settings — rendered inside PipelineTemplate.">
          <DCArtboard id="SC-WB" label="WB ★ · Page workbench · suspicion sidecar · p0123" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="workbench">
              <PageWorkbench stage="wordcheck" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-Q" label="A · Suspects queue · in-context word → fix · type · score · stealth filter" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="suspects"><ScannoSuspects filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-Q2" label="A' · Suspects · filter=stealth · real-word errors only" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="suspects"><ScannoSuspects filter="stealth" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-L" label="B · Word lists · ranked good + bad candidates with evidence · decisions" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="lists"><ScannoListBuilder filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-Lg" label="B' · Word lists · good-word candidates (freq · NER · gazetteer · OCR)" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="lists"><ScannoListBuilder filter="good" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-Lb" label="B'' · Word lists · bad-word candidates (near-miss · confusion · stealth)" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="lists"><ScannoListBuilder filter="bad" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-G" label="C · Overview · stats + scanno-type distribution + stealth note + activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="overview"><ScannoOverview state="review" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-A" label="C · Pages · running · 192/387 checked · 41/s" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="pages"><ScannoPages state="running" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-P" label="D · Pages · review · suspect counts · stealth ⚑ marks" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="pages"><ScannoPages state="review" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-PL" label="E · Pages · density L · suspect highlights on page" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="pages"><ScannoPages state="review" density="L" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-H" label="F · Stage settings · default (lexicon + rule-sets + stealth list)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="settings"><ScannoStepSettings state="default" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-H-mod" label="F' · Stage settings · modified · stale-bump" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="settings"><ScannoStepSettings state="modified" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="SC-H-preset" label="F'' · Stage settings · preset (Pre-1920 prose)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="wordcheck" currentTab="settings"><ScannoStepSettings state="preset" /></PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
