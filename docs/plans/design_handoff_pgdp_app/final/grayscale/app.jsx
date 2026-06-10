// app.jsx — Grayscale stage (stage 2). Wired-up canvas for perceptual
// grayscale conversion. Renders inside PipelineTemplate. Adapts the
// wf11 mode-chooser content for the full-width Step Settings tab.

const { useState: useStCG, useEffect: useEfCG } = React;

function App() {
  const [theme, setTheme] = useStCG(() => localStorage.getItem('pgd-theme') || 'light');
  useEfCG(() => localStorage.setItem('pgd-theme', theme), [theme]);

  const W = 1440, H = 1040;

  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="grayscale" />
      <DesignCanvas
        title="2 · Grayscale stage — final"
        subtitle={
          'Converts every cropped scan to grayscale. Two modes: Standard (luma-weighted, sub-second) and Perceptual (neighbourhood-sampled, preserves local contrast on newsprint and faded books). ' +
          'Auto-picks the right mode from an 8-page sample; runs on GPU when CUDA is present, falls back to CPU otherwise. ' +
          'Sits between Source and Crop because crop\u2019s edge detection wants a clean grayscale signal.'
        }
        sectionGap={64}
      >
        <DCSection
          id="GS"
          title="GS · Grayscale stage (wired up)"
          subtitle="Overview · Pages · Step settings — all rendered inside PipelineTemplate. Mode-chooser + advanced params adapted from wf11."
        >
          <DCArtboard id="GS-A" label="A · Overview · stat tiles + auto-detect summary + downstream impact" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="overview">
              <GrayscaleOverview backend="gpu" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-A-cpu" label="A&prime; · Overview · CPU fallback variant" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="overview">
              <GrayscaleOverview backend="cpu" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-B" label="B · Pages · grayscale thumb grid · auto-mode mix" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="pages">
              <GrayscalePages state="done" backend="gpu" filter="all" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-B-run" label="B&prime; · Pages · running · 72% through · CPU" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="pages">
              <GrayscalePages state="running" backend="cpu" filter="all" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-B-std" label="B&Prime; · Pages · filter = standard only" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="pages">
              <GrayscalePages state="done" backend="gpu" filter="standard" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-C" label="C \u2605 · Page workbench · default · GPU auto-perceptual + advanced params open" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="workbench">
              <GrayscaleStepSettings state="default" backend="gpu" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-C-cpu" label="C \u2605 · Page workbench · CPU fallback · prominent perf warning" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="workbench">
              <GrayscaleStepSettings state="default" backend="cpu" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-C-mod" label="C&prime; · Page workbench · modified · save-as-default visible" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="workbench">
              <GrayscaleStepSettings state="modified" backend="gpu" />
            </PipelineTemplate>
          </DCArtboard>

          <DCArtboard id="GS-C-preset" label="C&Prime; · Page workbench · preset applied (Newsprint · pre-1920)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="grayscale" currentTab="workbench">
              <GrayscaleStepSettings state="preset" backend="gpu" />
            </PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
