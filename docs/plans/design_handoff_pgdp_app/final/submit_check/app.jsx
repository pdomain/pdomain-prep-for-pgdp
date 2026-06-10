// app.jsx — Submit check (stage 24, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="submit_check" />
 <DesignCanvas title="23 · Submit check — final" subtitle="Dry-runs the PGDP submission end-to-end — auth, target slot, layout + naming, checksum verification and page-count match — without uploading anything. A passing dry run gates the live submit." sectionGap={64}>
 <DCSection id="submit_check" title="Submit check · stage 23 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="SUB-A" label="A · Dry run · 5 pass · 1 blocker · gated submit" width={W} height={Ht}><PipelineTemplate theme={theme} stage="submit_check" currentTab="overview"><SUBMain/></PipelineTemplate></DCArtboard>
 <DCArtboard id="SUB-S" label="B · Stage settings · target + safety" width={W} height={Ht}><PipelineTemplate theme={theme} stage="submit_check" currentTab="settings"><SUBSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
