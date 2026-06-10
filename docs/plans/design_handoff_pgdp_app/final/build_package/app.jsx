// app.jsx — Build package (stage 22, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="build_package" />
 <DesignCanvas title="21 · Build package — final" subtitle="Assembles the final deliverable — a checksummed manifest, project metadata and a provenance README — over the assembled proof pack, the exact package a PGDP project expects. Runs after Proof pack; feeds Zip and Submit check." sectionGap={64}>
 <DCSection id="build_package" title="Build package · stage 21 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="BP-A" label="A · Built · deliverable tree + manifest.json excerpt" width={W} height={Ht}><PipelineTemplate theme={theme} stage="build_package" currentTab="overview"><BPMain/></PipelineTemplate></DCArtboard>
 <DCArtboard id="BP-S" label="B · Stage settings · checksum + provenance" width={W} height={Ht}><PipelineTemplate theme={theme} stage="build_package" currentTab="settings"><BPSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
