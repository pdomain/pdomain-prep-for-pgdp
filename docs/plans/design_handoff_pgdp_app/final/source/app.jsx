// app.jsx — Source stage (stage 1). Wired-up canvas for thumbnail
// generation + page selection + inserts. Renders inside PipelineTemplate.

const { useState: useStCG, useEffect: useEfCG } = React;

function App() {
  const [theme, setTheme] = useStCG(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCG(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 1040;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="source" />
      <DesignCanvas
        title="1 · Source stage — final"
        subtitle="First stage of the pipeline. Files tab handles thumbnail generation + page selection + inserts; Page workbench is the per-page deep dive (role, page number, rotation, tone); Overview is the stage summary; Stage settings tunes thumbnail quality + workers."
        sectionGap={64}
      >
        <DCSection
          id="Src"
          title="Src · Source stage (wired up)"
          subtitle="Files · Overview · Page workbench · Stage settings — all rendered inside PipelineTemplate."
        >
          <DCArtboard id="Src-A" label="A · Files · thumbnails generating · 42% · skeleton grid" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="files">
              <SourceFiles state="generating" density="M" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-B" label="B · Files · selection · unmarked still pending · density M" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="files">
              <SourceFiles state="selection" density="M" filter="all" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-C" label="C · Files · 3 selected · bulk-action sticky bar" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="files">
              <SourceFiles state="selection" density="M" selected={[10, 11, 13]} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-D" label="D · Files · hovering between thumbs · insert divider visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="files">
              <SourceFiles state="selection" density="M" showInsertDivider />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-E" label="E · Files · Insert page dialog · Missing kind" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="files">
              <SourceFiles state="selection" density="M" dialog />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-F" label="F · Files · filter = Inserts · 4 synthetic pages" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="files">
              <SourceFiles state="selection" density="L" filter="inserts" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-G" label="G · Overview tab · stats grid + status" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="overview">
              <SourceOverview state="selection" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-WB1" label="WB1 ★ · Page workbench · body page p012 (idx 5) · role chooser + viewer" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="workbench">
              <SourcePageWorkbench pageIdx={5} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-WB2" label="WB2 · Page workbench · inserted page (synthetic) · insert note visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="workbench">
              <SourcePageWorkbench pageIdx={7} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-WB3" label="WB3 · Page workbench · cover (idx 0) · role = cover" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="workbench">
              <SourcePageWorkbench pageIdx={0} />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-I" label="I · Stage settings · default (inheriting project default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="settings">
              <SourceStepSettings state="default" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-I-mod" label="I' · Stage settings · modified · Save as project default" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="settings">
              <SourceStepSettings state="modified" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="Src-I-preset" label="I'' · Stage settings · preset applied (not project default)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="source" currentTab="settings">
              <SourceStepSettings state="preset" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
