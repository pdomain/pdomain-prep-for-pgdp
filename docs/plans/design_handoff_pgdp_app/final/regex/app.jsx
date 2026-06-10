// app.jsx — Regex pass (stage 18, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="regex" />
 <DesignCanvas title="18 · Regex pass — final" subtitle="A saved, ordered set of project-scoped find/replace rules run across every page’s proofer text — quote/dash normalisation, ligature expansion, spacing fixes. Each rule previews its matches before it commits, and the whole pass is snapshotted so it can be rolled back." sectionGap={64}>
 <DCSection id="regex" title="Regex pass · stage 18 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="RX-A" label="A · Overview · rule run + before/after preview" width={W} height={Ht}><PipelineTemplate theme={theme} stage="regex" currentTab="overview"><RXMain/></PipelineTemplate></DCArtboard>
 <DCArtboard id="RX-R" label="B · Rules · full ordered list + patterns" width={W} height={Ht}><PipelineTemplate theme={theme} stage="regex" currentTab="rules"><RXRules/></PipelineTemplate></DCArtboard>
 <DCArtboard id="RX-S" label="C · Stage settings · snapshot + scope + markup safety" width={W} height={Ht}><PipelineTemplate theme={theme} stage="regex" currentTab="settings"><RXSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
