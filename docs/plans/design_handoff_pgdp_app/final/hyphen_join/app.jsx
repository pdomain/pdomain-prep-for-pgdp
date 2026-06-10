// app.jsx — Hyphen-join stage (stage 14). Wired-up canvas for cross-line
// hyphen resolution. Merges the wf05 Hyphen-Join Workbench into the
// pipeline-step template: each workbench surface becomes a tab body
// inside PipelineTemplate.

const { useState: useStCG, useEffect: useEfCG } = React;

function App() {
  const [theme, setTheme] = useStCG(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCG(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 1080;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="hyphen_join" />
      <DesignCanvas
        title="14 · Hyphen-join stage — final"
        subtitle={
          'Cross-line hyphens get auto-joined by the global rule library; everything the library can\u2019t resolve lands in this stage for review. ' +
          'The wf05 workbench surfaces — Undecided queue (★), Auto-joined validation (★), Mismatch report — are merged in as per-stage tabs. ' +
          'The global rule library itself still lives at /settings.'
        }
        sectionGap={64}
      >
        <DCSection
          id="HJ"
          title="HJ · Hyphen-join stage (wired up)"
          subtitle="Overview · Undecided · Auto-joined · Mismatch · Step settings — all rendered inside PipelineTemplate."
        >
          <DCArtboard id="HJ-A" label="A · Overview · stat tiles + workflow row + post-book notes preview" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="overview">
              <HyphenOverview />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="HJ-B" label="B ★ · Undecided · queue mode · case 2 focused · keyboard-driven" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="queue">
              <HyphenUndecided />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="HJ-C" label="C ★ · Auto-joined · grouped by word · &lsquo;overwhelming&rsquo; flagged" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="joined">
              <HyphenAutoJoined />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="HJ-D" label="D · Mismatch · 3 same-word join/hyphen pairs in the output" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="mismatch">
              <HyphenMismatch />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="HJ-WB" label="WB · Page workbench · cross-line hyphens on p029 · 1 undecided + 2 joined + 1 flagged" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="workbench">
              <HyphenPageWorkbench />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="HJ-E" label="E · Stage settings · default (inheriting project default · standard + global library)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="settings">
              <HyphenStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="HJ-E-mod" label="E&prime; · Stage settings · modified · stale-bump warning visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="settings">
              <HyphenStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="HJ-E-preset" label="E&Prime; · Stage settings · preset applied (PGDP / 19c-essays)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="hyphen_join" currentTab="settings">
              <HyphenStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
