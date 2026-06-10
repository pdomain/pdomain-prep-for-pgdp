// app.jsx — Illustrations (stage 17, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="illust" />
 <DesignCanvas title="17 · Illustrations — final" subtitle="Detects illustration regions from the zones marked in Page layout and extracts each as a standalone crop — plates kept as grayscale/contone (not the bilevel text image) so they survive into the proof pack’s illustrations/ folder. First stage in the Pack group." sectionGap={64}>
 <DCSection id="illustrations" title="Illustrations · stage 17 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="ILL-WB" label="WB ★ · Page workbench · plate extraction · fig-014" width={W} height={Ht}><PipelineTemplate theme={theme} stage="illust" currentTab="workbench"><PageWorkbench stage="illust" /></PipelineTemplate></DCArtboard>
 <DCArtboard id="ILL-A" label="A · Overview · detected / extracted · by-kind + recent" width={W} height={Ht}><PipelineTemplate theme={theme} stage="illust" currentTab="overview"><ILMain/></PipelineTemplate></DCArtboard>
 <DCArtboard id="ILL-G" label="B · Illustrations · extracted crop gallery + filters" width={W} height={Ht}><PipelineTemplate theme={theme} stage="illust" currentTab="illustrations"><ILGallery/></PipelineTemplate></DCArtboard>
 <DCArtboard id="ILL-S" label="C · Stage settings · detection + bounds + export" width={W} height={Ht}><PipelineTemplate theme={theme} stage="illust" currentTab="settings"><ILSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
