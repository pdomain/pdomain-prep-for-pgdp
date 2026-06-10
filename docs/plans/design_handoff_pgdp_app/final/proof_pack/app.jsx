// app.jsx — Proof pack (stage 21, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="proof_pack" />
 <DesignCanvas title="20 · Proof pack — final" subtitle="Bundles the finished page images, proofer text, illustration crops and project metadata into the directory layout PGDP expects. Assembled after Validation passes — the hand-off package the later Build / Submit steps operate on." sectionGap={64}>
 <DCSection id="proof_pack" title="Proof pack · stage 20 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="PP-A" label="A · Contents · assembled pack · file tree + completeness" width={W} height={Ht}><PipelineTemplate theme={theme} stage="proof_pack" currentTab="overview"><PPMain/></PipelineTemplate></DCArtboard>
 <DCArtboard id="PP-S" label="B · Stage settings · include toggles + naming" width={W} height={Ht}><PipelineTemplate theme={theme} stage="proof_pack" currentTab="settings"><PPSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
