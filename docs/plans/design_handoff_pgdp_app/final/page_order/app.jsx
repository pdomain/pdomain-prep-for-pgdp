// app.jsx — Page order stage (stage 11, OCR group). Final, consolidated:
// ONE artboard per tab, all sharing the same 4-tab chrome.

const { useState: useStPO2, useEffect: useEfPO2 } = React;

// The stage's tab band — Runs + Sequence + Pages were collapsed into the single
// "Order & numbering" workspace; "Naming" is the output-file-naming setup.
const PU_TAB_ITEMS = [
  { id: 'overview', name: 'Overview',          icon: 'package' },
  { id: 'work',     name: 'Order & numbering', icon: 'swap', count: '9' },
  { id: 'naming',   name: 'Naming',            icon: 'fileText' },
  { id: 'settings', name: 'Stage settings',    icon: 'wrench' },
];

const PuShell = ({ theme, tab, children }) => (
  <PipelineTemplate theme={theme} stage="page_order" currentTab={tab} tabsSlot={<TabsBand items={PU_TAB_ITEMS} current={tab} />}>{children}</PipelineTemplate>
);

function App() {
  const [theme, setTheme] = useStPO2(() => localStorage.getItem('pgd-theme') || 'light');
  useEfPO2(() => localStorage.setItem('pgd-theme', theme), [theme]);
  const W = 1440, Hs = 1080;
  return (
    <>
      <CanvasNav theme={theme} setTheme={setTheme} current="page_order" />
      <DesignCanvas
        title="11 · Page order — final"
        subtitle="Reads each scan's printed page number (folio) from OCR, reconciles it against numbering runs, and detects scans out of sequence — a misfed leaf, a flipped bifolium, a duplicate scan, a gap. Front matter, plates, blanks and renumbered back matter are handled as separate runs. One view per tab."
        sectionGap={64}
      >
        <DCSection id="FINAL" title="Page order · stage 11" subtitle="Overview · Order & numbering · Naming · Stage settings — the four tabs of the stage, each rendered inside the real pipeline chrome.">
          <DCArtboard id="T-overview" label="Overview · stats + how-detected + flags + activity" width={W} height={Hs}>
            <PuShell theme={theme} tab="overview"><PoOverview /></PuShell>
          </DCArtboard>
          <DCArtboard id="T-work" label="Order & numbering · map + run spine (add/edit/remove) + inline role/run + leaf inspector" width={W} height={Hs}>
            <PuShell theme={theme} tab="work"><PoWorkbenchInspect /></PuShell>
          </DCArtboard>
          <DCArtboard id="T-naming" label="Naming · scheme + padding + type codes + insert-a-found-page" width={W} height={Hs}>
            <PuShell theme={theme} tab="naming"><PoNaming /></PuShell>
          </DCArtboard>
          <DCArtboard id="T-settings" label="Stage settings · default (OCR folios)" width={W} height={Hs}>
            <PuShell theme={theme} tab="settings"><PoStepSettings state="default" /></PuShell>
          </DCArtboard>
        </DCSection>

        <DCSection id="PANELS" title="Order & numbering · every panel open (reference)" subtitle="The same Order & numbering view with all its panels expanded at once, so you can see the full editing surface in one frame: the + Add run form, an Edit run card (with Remove → merge up), an inline role dropdown open on a row, and the leaf inspector showing the original → output filename provenance. In normal use these open on demand.">
          <DCArtboard id="PANELS-all" label="All panels open · add run + edit/remove run + role dropdown + multi-select move bar + leaf inspector (filename provenance)" width={W} height={Hs}>
            <PuShell theme={theme} tab="work"><PoWorkbenchInspect sel0={134} dd0={{ scan: 4, field: 'role' }} edit0="body" adding0={true} selScans0={[140, 141]} /></PuShell>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
