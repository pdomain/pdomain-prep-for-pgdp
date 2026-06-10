// app.jsx — Zip (stage 23, Pack group).
const { useState: uS, useEffect: uE } = React;
function App(){ const [theme,setTheme]=uS(()=>localStorage.getItem('pgd-theme')||'light'); uE(()=>localStorage.setItem('pgd-theme',theme),[theme]); const W=1440,Ht=940;
 return (<><CanvasNav theme={theme} setTheme={setTheme} current="zip" />
 <DesignCanvas title="22 · Zip — final" subtitle="Packs the built package into a single deterministic archive — identical inputs always produce a byte-identical .zip (sorted entries, fixed timestamps), with a SHA-256 sidecar for verification. Runs after Build package; feeds Submit check." sectionGap={64}>
 <DCSection id="zip" title="Zip · stage 22 (wired up)" subtitle="Rendered inside PipelineTemplate.">
 <DCArtboard id="ZIP-A" label="A · Built · deterministic archive + checksum + contents" width={W} height={Ht}><PipelineTemplate theme={theme} stage="zip" currentTab="overview"><ZIPMain running={false}/></PipelineTemplate></DCArtboard>
 <DCArtboard id="ZIP-R" label="B · Building · compress progress (deterministic)" width={W} height={Ht}><PipelineTemplate theme={theme} stage="zip" currentTab="overview"><ZIPMain running={true}/></PipelineTemplate></DCArtboard>
 <DCArtboard id="ZIP-S" label="C · Stage settings · format + reproducibility" width={W} height={Ht}><PipelineTemplate theme={theme} stage="zip" currentTab="settings"><ZIPSettings/></PipelineTemplate></DCArtboard>
 </DCSection></DesignCanvas></>); }
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
