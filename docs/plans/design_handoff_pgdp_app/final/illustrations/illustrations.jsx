
const Card = ({title,sub,right,children,pad=true}) => (<div style={{background:'var(--bg-surface)',border:'1px solid var(--border-1)',borderRadius:8,overflow:'hidden'}}>{title?<div style={{padding:'12px 16px',borderBottom:'1px solid var(--border-1)',display:'flex',alignItems:'center',gap:10}}><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:'var(--ink-1)'}}>{title}</div>{sub?<div style={{marginTop:2,fontSize:11.5,color:'var(--ink-3)'}}>{sub}</div>:null}</div>{right||null}</div>:null}<div style={{padding:pad?'14px 16px':0}}>{children}</div></div>);
const Stat = ({label,value,tone='ink-1',sub}) => (<div style={{flex:1,background:'var(--bg-surface)',border:'1px solid var(--border-1)',borderRadius:8,padding:'14px 16px'}}><div className="mono" style={{fontSize:22,fontWeight:600,color:'var(--'+tone+')',letterSpacing:'-0.01em'}}>{value}</div><div style={{marginTop:4,fontSize:11,color:'var(--ink-3)',letterSpacing:'.04em',textTransform:'uppercase'}}>{label}</div>{sub?<div className="mono" style={{marginTop:2,fontSize:10.5,color:'var(--ink-4)'}}>{sub}</div>:null}</div>);
const Body = ({children,gap=14}) => (<div style={{padding:'20px 28px 28px',display:'flex',flexDirection:'column',gap}}>{children}</div>);
const Toggle2 = ({on}) => (<span style={{width:30,height:18,borderRadius:99,background:on?'var(--accent)':'var(--border-2)',position:'relative',display:'inline-block',flex:'0 0 auto'}}><span style={{position:'absolute',top:2,left:on?14:2,width:14,height:14,borderRadius:99,background:'#fff',boxShadow:'0 1px 2px rgba(0,0,0,.15)'}}/></span>);
const Seg = ({options,activeIdx=0}) => (<div style={{display:'inline-flex',padding:3,gap:2,background:'var(--bg-raised)',border:'1px solid var(--border-1)',borderRadius:7,flexWrap:'wrap'}}>{options.map((o,i)=>{const a=i===activeIdx;return <div key={o} style={{padding:'5px 12px',borderRadius:5,cursor:'pointer',background:a?'var(--bg-surface)':'transparent',boxShadow:a?'0 0 0 1px var(--border-1)':'none',color:a?'var(--ink-1)':'var(--ink-3)',fontSize:12,fontWeight:a?600:500}}>{o}</div>;})}</div>);
const SetRow = ({title,sub,children}) => (<div style={{display:'grid',gridTemplateColumns:'260px 1fr',gap:12,padding:'13px 16px',alignItems:'center',borderTop:'1px solid var(--border-1)'}}><div><div style={{fontSize:12.5,fontWeight:500,color:'var(--ink-1)'}}>{title}</div><div style={{marginTop:2,fontSize:11.5,color:'var(--ink-3)'}}>{sub}</div></div><div style={{display:'flex',justifyContent:'flex-end'}}>{children}</div></div>);
const Gate = ({ok,label,sub}) => (<div style={{borderRadius:10,border:'1px solid color-mix(in oklab, '+(ok?'var(--exact)':'var(--fuzzy)')+' 40%, var(--border-1))',background:'color-mix(in oklab, '+(ok?'var(--exact)':'var(--fuzzy)')+' 7%, var(--bg-surface))',padding:'14px 16px',display:'flex',alignItems:'center',gap:12}}><div style={{width:30,height:30,borderRadius:7,flex:'0 0 auto',background:'color-mix(in oklab, '+(ok?'var(--exact)':'var(--fuzzy)')+' 18%, var(--bg-surface))',color:ok?'var(--exact)':'var(--fuzzy)',display:'grid',placeItems:'center'}}><Icon name={ok?'checkCircle':'alert'} size={15}/></div><div style={{flex:1}}><div style={{fontSize:13.5,fontWeight:600,color:'var(--ink-1)'}}>{label}</div><div style={{marginTop:2,fontSize:12,color:'var(--ink-3)'}}>{sub}</div></div></div>);

// ── illustration-specific helpers ───────────────────────────────────────────
const ilStatusTone = s => s==='extracted'?'var(--exact)':s==='review'?'var(--fuzzy)':'var(--mismatch)';
const ilStatusIcon = s => s==='extracted'?'check':s==='review'?'eye':'alert';
const ilKind = id => ILL_KINDS.find(k=>k.id===id) || ILL_KINDS[0];
// striped contone placeholder — never a real drawn illustration
const ilThumbBg = 'repeating-linear-gradient(135deg, color-mix(in oklab, var(--ink-4) 22%, var(--bg-sunk)) 0 7px, var(--bg-sunk) 7px 14px)';

const StatusChip = ({status}) => (<span className="mono" style={{display:'inline-flex',alignItems:'center',gap:4,height:18,padding:'0 7px',borderRadius:9,fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'.04em',color:ilStatusTone(status),background:'color-mix(in oklab, '+ilStatusTone(status)+' 13%, transparent)'}}><Icon name={ilStatusIcon(status)} size={10}/>{status}</span>);

const Plate = ({item,compact}) => { const k=ilKind(item.kind); const ar=Math.max(0.5,Math.min(1.6,item.w/item.h));
 return (<div style={{border:'1px solid var(--border-1)',borderRadius:8,overflow:'hidden',background:'var(--bg-surface)'}}>
  <div style={{position:'relative',aspectRatio:'4 / 3',background:ilThumbBg,display:'grid',placeItems:'center'}}>
   <div style={{width:Math.round((ar>=1?70:70*ar))+'%',aspectRatio:ar,background:'var(--bg-raised)',border:'1px dashed var(--border-3)',borderRadius:2,display:'grid',placeItems:'center'}}>
    <span className="mono" style={{fontSize:9.5,color:'var(--ink-4)',letterSpacing:'.04em'}}>{item.w}×{item.h}</span></div>
   <span style={{position:'absolute',top:8,left:8}}><StatusChip status={item.status}/></span>
  </div>
  <div style={{padding:'9px 11px'}}>
   <div style={{display:'flex',alignItems:'center',gap:7}}><span className="mono" style={{fontSize:11,fontWeight:600,color:'var(--ink-1)'}}>{item.page}</span><span style={{width:5,height:5,borderRadius:99,background:'var(--'+k.tone+')'}}/><span style={{fontSize:11,color:'var(--ink-2)'}}>{k.name}</span></div>
   {!compact?<div style={{marginTop:4,fontSize:10.5,color:'var(--ink-3)',lineHeight:1.35}}>{item.note}</div>:null}
   <div className="mono" style={{marginTop:5,fontSize:9.5,color:'var(--ink-4)'}}>{k.keep}</div>
  </div></div>); };

const KindRow = ({k,count}) => (<div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderTop:'1px solid var(--border-1)'}}><span style={{width:8,height:8,borderRadius:99,background:'var(--'+k.tone+')',flex:'0 0 auto'}}/><span style={{flex:1,fontSize:12.5,color:'var(--ink-1)'}}>{k.name}</span><span className="mono" style={{fontSize:11,color:'var(--ink-3)'}}>{k.keep}</span><span className="mono" style={{width:34,textAlign:'right',fontSize:12,fontWeight:600,color:'var(--ink-2)'}}>{count}</span></div>);

const kindCount = id => ILL_ITEMS.filter(i=>i.kind===id).length;

const ILMain = () => (<Body>
 <Gate ok={ILL_COUNTS.flagged===0&&ILL_COUNTS.review===0} label={ILL_COUNTS.review+ILL_COUNTS.flagged>0 ? (ILL_COUNTS.review+ILL_COUNTS.flagged)+' regions need a look' : 'All illustrations extracted'} sub={ILL_COUNTS.review+ILL_COUNTS.flagged>0 ? 'Confirm the flagged detections and bounds below — extracted crops feed the proof pack’s illustrations/ folder.' : 'Every detected region is cropped and named — ready for the proof pack.'} />
 <div style={{display:'flex',gap:12}}><Stat label="detected" value={ILL_COUNTS.detected} tone="ocr"/><Stat label="extracted" value={ILL_COUNTS.extracted} tone="exact"/><Stat label="needs review" value={ILL_COUNTS.review} tone="fuzzy"/><Stat label="flagged" value={ILL_COUNTS.flagged} tone="mismatch"/></div>
 <Card title="Extraction by kind" sub="Each region type is kept at its own depth + resolution — plates stay contone, not bilevel" right={<Button variant="default" size="sm" icon="refresh">Re-detect</Button>}>
  <div style={{display:'flex',flexDirection:'column'}}>{ILL_KINDS.map(k=><KindRow key={k.id} k={k} count={kindCount(k.id)}/>)}</div></Card>
 <Card title="Recently extracted" sub="From illustration zones marked in Page layout" right={<Button variant="ghost" size="sm" iconRight="chevR">Open gallery</Button>}>
  <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:12}}>{ILL_ITEMS.slice(0,4).map(i=><Plate key={i.id} item={i} compact/>)}</div></Card>
</Body>);

const ILGallery = () => (<Body>
 <div style={{display:'flex',alignItems:'center',gap:12}}>
  <Seg options={['All','Plates','Line art','Initials','Figures']} activeIdx={0}/>
  <span style={{flex:1}}/>
  <span className="mono" style={{fontSize:11,color:'var(--ink-3)'}}>{ILL_ITEMS.length} shown · {ILL_COUNTS.detected} total</span>
  <Button variant="default" size="sm" icon="download">Export crops</Button>
 </div>
 <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:14}}>{ILL_ITEMS.map(i=><Plate key={i.id} item={i}/>)}</div>
</Body>);

const ILSettings = () => (<Body><div><h2 style={{fontSize:16,fontWeight:600,color:'var(--ink-1)'}}>Stage settings · Illustrations</h2><div style={{marginTop:3,fontSize:12,color:'var(--ink-3)'}}>How regions are detected, padded, and exported.</div></div>
 <Card><SetRow title="Detection source" sub="Where illustration zones come from"><Seg options={['Page layout zones','Auto re-detect','Both']} activeIdx={0}/></SetRow><SetRow title="Bounds padding" sub="Whitespace kept around each region"><Seg options={['Tight','2 mm','5 mm']} activeIdx={1}/></SetRow><SetRow title="Keep plates as contone" sub="Extract halftones from grayscale, before Threshold"><Toggle2 on={true}/></SetRow><SetRow title="Extract resolution" sub="Output DPI for plate crops"><Seg options={['300 dpi','600 dpi']} activeIdx={0}/></SetRow><SetRow title="Naming" sub="Illustration file naming scheme"><Seg options={['ill_p012','fig001','plate-01']} activeIdx={0}/></SetRow><SetRow title="Flag overlaps with text" sub="Hold regions that intersect a text column for review"><Toggle2 on={true}/></SetRow></Card></Body>);

Object.assign(window,{ILMain,ILGallery,ILSettings});
