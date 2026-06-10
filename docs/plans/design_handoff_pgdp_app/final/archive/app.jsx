// app.jsx — Archive (stage 25, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="archive" />
 <DesignCanvas title="24 · Archive — final" subtitle="Long-term storage handoff — preserves the original scans, the finished package and full provenance to cold storage, while dropping the bulky re-derivable intermediates. The last stage in the pipeline." sectionGap={64}>
 <DCSection id="archive" title="Archive · stage 24 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="ARC-A" label="A · Archived · keep/drop list + destination" width={W} height={Ht}><PipelineTemplate theme={theme} stage="archive" currentTab="overview"><ARCMain/></PipelineTemplate></DCArtboard>
 <DCArtboard id="ARC-S" label="B · Stage settings · destination + retention" width={W} height={Ht}><PipelineTemplate theme={theme} stage="archive" currentTab="settings"><ARCSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
