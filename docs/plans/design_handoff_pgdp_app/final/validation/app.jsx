// app.jsx — Validation (stage 20, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="validation" />
 <DesignCanvas title="19 · Validation — final" subtitle="Pre-flight check that runs before the pack is assembled. Eight rules verify every page has an image + text, is sequenced, UTF-8-clean and metadata-complete; errors block the rest of the Pack group, warnings are advisory and can be waived with a note. (ref wf02)" sectionGap={64}>
 <DCSection id="validation" title="Validation · stage 19 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="VAL-A" label="A · Pre-flight · 5 pass · 2 warn · 1 error (build blocked)" width={W} height={Ht}><PipelineTemplate theme={theme} stage="validation" currentTab="overview"><VALMain/></PipelineTemplate></DCArtboard>
 <DCArtboard id="VAL-S" label="B · Stage settings · strictness + rule toggles" width={W} height={Ht}><PipelineTemplate theme={theme} stage="validation" currentTab="settings"><VALSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
