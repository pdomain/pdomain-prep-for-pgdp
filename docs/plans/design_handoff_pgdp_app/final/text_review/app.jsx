// app.jsx — Text review stage (stage 16, Text group). The last HUMAN gate
// before packaging: a proofer reads each flagged page against the final
// composited image, approves it, or opens a comment for the team. Runs after
// Wordcheck; cleared pages flow to Illustrations and the proof pack.

const { useState: useStTR, useEffect: useEfTR } = React;

function App() {
  const [theme, setTheme] = useStTR(() => localStorage.getItem('pgd-theme') || 'light');
  useEfTR(() => localStorage.setItem('pgd-theme', theme), [theme]);
  const W = 1440, H = 980, Hq = 1060;
  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="text_review" />
      <DesignCanvas
        title="16 · Text review — final"
        subtitle="The last human gate before packaging. Wordcheck and the OCR step flag what they can; Text review puts a person in front of every page that still carries a concern — held scannos, low-score words, layout and markup questions — on the FINAL canvas-mapped pages. The reviewer approves, edits, or opens a comment thread for the team. Cleared pages flow to Illustrations and the proof pack."
        sectionGap={64}
      >
        <DCSection id="TR" title="Text review · stage 16 (wired up)" subtitle="Overview · Pages · Review queue · Comments · Stage settings — rendered inside PipelineTemplate.">
          <DCArtboard id="TR-WB" label="WB ★ · Page workbench · proof + comments · p0123" width={W} height={1040}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="workbench">
              <PageWorkbench stage="text_review" />
            </PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-Q" label="A · Review queue · page concern → reason · who · comments · approve / discuss" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="queue"><TrReviewQueue filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-Qd" label="A' · Review queue · filter=In discussion · threads needing the team" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="queue"><TrReviewQueue filter="discuss" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-Qm" label="A'' · Review queue · filter=Mine · this reviewer's assignments" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="queue"><TrReviewQueue filter="mine" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-C" label="B · Comments · threaded discussion anchored to pages · open + resolved" width={W} height={Hq}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="comments"><TrComments filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-Co" label="B' · Comments · filter=Open · unresolved threads only" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="comments"><TrComments filter="open" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-G" label="C · Overview · sign-off % + queue reasons + reviewer progress + activity" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="overview"><TrOverview state="review" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-A" label="D · Pages · running · assembling queue · 214/387" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="pages"><TrPages state="running" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-P" label="E · Pages · review · status per page · concern counts · reviewer avatars" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="pages"><TrPages state="review" density="M" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-Pp" label="E' · Pages · filter=Pending · still awaiting a human" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="pages"><TrPages state="review" density="M" filter="pending" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-PL" label="E'' · Pages · density L · margin guide + concern marks on page" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="pages"><TrPages state="review" density="L" filter="all" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-H" label="F · Stage settings · default (single sign-off · queue rules)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="settings"><TrStepSettings state="default" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-H-mod" label="F' · Stage settings · modified · re-opens approved pages" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="settings"><TrStepSettings state="modified" /></PipelineTemplate>
          </DCArtboard>
          <DCArtboard id="TR-H-preset" label="F'' · Stage settings · preset (Two-reviewer sign-off)" width={W} height={H}>
            <PipelineTemplate theme={theme} stage="text_review" currentTab="settings"><TrStepSettings state="preset" /></PipelineTemplate>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
