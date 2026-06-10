
const Card = ({title,sub,right,children,pad=true}) => (<div style={{background:'var(--bg-surface)',border:'1px solid var(--border-1)',borderRadius:8,overflow:'hidden'}}>{title?<div style={{padding:'12px 16px',borderBottom:'1px solid var(--border-1)',display:'flex',alignItems:'center',gap:10}}><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:'var(--ink-1)'}}>{title}</div>{sub?<div style={{marginTop:2,fontSize:11.5,color:'var(--ink-3)'}}>{sub}</div>:null}</div>{right||null}</div>:null}<div style={{padding:pad?'14px 16px':0}}>{children}</div></div>);
const Stat = ({label,value,tone='ink-1',sub}) => (<div style={{flex:1,background:'var(--bg-surface)',border:'1px solid var(--border-1)',borderRadius:8,padding:'14px 16px'}}><div className="mono" style={{fontSize:22,fontWeight:600,color:'var(--'+tone+')',letterSpacing:'-0.01em'}}>{value}</div><div style={{marginTop:4,fontSize:11,color:'var(--ink-3)',letterSpacing:'.04em',textTransform:'uppercase'}}>{label}</div>{sub?<div className="mono" style={{marginTop:2,fontSize:10.5,color:'var(--ink-4)'}}>{sub}</div>:null}</div>);
const Body = ({children,gap=14}) => (<div style={{padding:'20px 28px 28px',display:'flex',flexDirection:'column',gap}}>{children}</div>);
const Toggle2 = ({on}) => (<span style={{width:30,height:18,borderRadius:99,background:on?'var(--accent)':'var(--border-2)',position:'relative',display:'inline-block',flex:'0 0 auto'}}><span style={{position:'absolute',top:2,left:on?14:2,width:14,height:14,borderRadius:99,background:'#fff',boxShadow:'0 1px 2px rgba(0,0,0,.15)'}}/></span>);
const Seg = ({options,activeIdx=0}) => (<div style={{display:'inline-flex',padding:3,gap:2,background:'var(--bg-raised)',border:'1px solid var(--border-1)',borderRadius:7,flexWrap:'wrap'}}>{options.map((o,i)=>{const a=i===activeIdx;return <div key={o} style={{padding:'5px 12px',borderRadius:5,cursor:'pointer',background:a?'var(--bg-surface)':'transparent',boxShadow:a?'0 0 0 1px var(--border-1)':'none',color:a?'var(--ink-1)':'var(--ink-3)',fontSize:12,fontWeight:a?600:500}}>{o}</div>;})}</div>);
const SetRow = ({title,sub,children}) => (<div style={{display:'grid',gridTemplateColumns:'260px 1fr',gap:12,padding:'13px 16px',alignItems:'center',borderTop:'1px solid var(--border-1)'}}><div><div style={{fontSize:12.5,fontWeight:500,color:'var(--ink-1)'}}>{title}</div><div style={{marginTop:2,fontSize:11.5,color:'var(--ink-3)'}}>{sub}</div></div><div style={{display:'flex',justifyContent:'flex-end'}}>{children}</div></div>);
const Gate = ({ok,label,sub}) => (<div style={{borderRadius:10,border:'1px solid color-mix(in oklab, '+(ok?'var(--exact)':'var(--fuzzy)')+' 40%, var(--border-1))',background:'color-mix(in oklab, '+(ok?'var(--exact)':'var(--fuzzy)')+' 7%, var(--bg-surface))',padding:'14px 16px',display:'flex',alignItems:'center',gap:12}}><div style={{width:30,height:30,borderRadius:7,flex:'0 0 auto',background:'color-mix(in oklab, '+(ok?'var(--exact)':'var(--fuzzy)')+' 18%, var(--bg-surface))',color:ok?'var(--exact)':'var(--fuzzy)',display:'grid',placeItems:'center'}}><Icon name={ok?'checkCircle':'alert'} size={15}/></div><div style={{flex:1}}><div style={{fontSize:13.5,fontWeight:600,color:'var(--ink-1)'}}>{label}</div><div style={{marginTop:2,fontSize:12,color:'var(--ink-3)'}}>{sub}</div></div></div>);

// ── regex-specific helpers ──────────────────────────────────────────────────
const rxTone = s => s==='applied'?'var(--exact)':s==='review'?'var(--fuzzy)':'var(--ink-4)';
const rxIcon = s => s==='applied'?'check':s==='review'?'eye':'pause';
const RxStatus = ({status}) => (<span className="mono" style={{display:'inline-flex',alignItems:'center',gap:4,height:18,padding:'0 7px',borderRadius:9,fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'.04em',color:rxTone(status),background:'color-mix(in oklab, '+rxTone(status)+' 13%, transparent)'}}><Icon name={rxIcon(status)} size={10}/>{status}</span>);
// pattern token — monospaced "find → replace" pill pair
const Pat = ({find,repl}) => (<span className="mono" style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:11.5}}><code style={{background:'color-mix(in oklab, var(--ocr) 13%, transparent)',color:'var(--ocr)',padding:'2px 6px',borderRadius:4,whiteSpace:'pre'}}>{find}</code><Icon name="arrowR" size={11} style={{color:'var(--ink-4)'}}/><code style={{background:'color-mix(in oklab, var(--exact) 13%, transparent)',color:'var(--exact)',padding:'2px 6px',borderRadius:4,whiteSpace:'pre'}}>{repl}</code></span>);

const RuleRow = ({rule,idx,full}) => (<div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderTop:idx===0?0:'1px solid var(--border-1)'}}>
 <span className="mono" style={{width:18,textAlign:'right',fontSize:11,color:'var(--ink-4)',flex:'0 0 auto'}}>{idx+1}</span>
 <Toggle2 on={rule.status!=='pending'}/>
 <div style={{flex:1,minWidth:0}}>
  <div style={{fontSize:12.5,fontWeight:500,color:'var(--ink-1)'}}>{rule.name}</div>
  <div style={{marginTop:5}}><Pat find={rule.find} repl={rule.repl}/></div>
  {full?<div className="mono" style={{marginTop:5,fontSize:10,color:'var(--ink-4)'}}>scope: {rule.scope} · flags: /{rule.flags}</div>:null}
 </div>
 <div style={{textAlign:'right',flex:'0 0 auto'}}><div className="mono" style={{fontSize:13,fontWeight:600,color:'var(--ink-2)'}}>{rule.matches.toLocaleString()}</div><div className="mono" style={{fontSize:9.5,color:'var(--ink-4)',textTransform:'uppercase',letterSpacing:'.04em'}}>matches</div></div>
 <RxStatus status={rule.status}/>
 {rule.status!=='applied'?<Button variant="ghost" size="sm">{rule.status==='review'?'Review':'Run'}</Button>:<span style={{width:60}}/>}
</div>);

const DiffLine = ({h}) => (<div style={{display:'grid',gridTemplateColumns:'52px 1fr 1fr',gap:10,padding:'9px 0',borderTop:'1px solid var(--border-1)',alignItems:'center'}}>
 <span className="mono" style={{fontSize:10.5,color:'var(--ink-4)'}}>{h.page}</span>
 <span className="mono" style={{fontSize:11.5,color:'var(--mismatch)',background:'color-mix(in oklab, var(--mismatch) 8%, transparent)',padding:'3px 7px',borderRadius:4}}>{h.before}</span>
 <span className="mono" style={{fontSize:11.5,color:'var(--exact)',background:'color-mix(in oklab, var(--exact) 8%, transparent)',padding:'3px 7px',borderRadius:4,display:'inline-flex',alignItems:'center',gap:6}}>{h.after}{h.warn?<Icon name="alert" size={11} style={{color:'var(--fuzzy)'}}/>:null}</span>
</div>);

const reviewRule = RX_RULES.find(r=>r.id===RX_PREVIEW.rule);

const RXMain = () => (<Body>
 <Gate ok={RX_COUNTS.review+RX_COUNTS.pending===0} label={RX_COUNTS.review+RX_COUNTS.pending>0 ? (RX_COUNTS.review+RX_COUNTS.pending)+' rules awaiting a decision' : 'Regex pass clean'} sub={RX_COUNTS.review+RX_COUNTS.pending>0 ? 'Preview the flagged rules before committing — the whole pass is snapshotted, so it can be rolled back.' : 'All rules applied · a snapshot was taken before the run.'} />
 <div style={{display:'flex',gap:12}}><Stat label="rules" value={RX_COUNTS.rules}/><Stat label="applied" value={RX_COUNTS.applied} tone="exact"/><Stat label="needs review" value={RX_COUNTS.review} tone="fuzzy"/><Stat label="replacements" value={RX_COUNTS.matches.toLocaleString()} tone="ocr"/></div>
 <Card title="Rules" sub="Run top-to-bottom across every page · toggle to enable" right={<Button variant="default" size="sm" icon="plus">Add rule</Button>}>
  <div style={{display:'flex',flexDirection:'column'}}>{RX_RULES.slice(0,5).map((r,i)=><RuleRow key={r.id} rule={r} idx={i}/>)}</div></Card>
 <Card title={'Preview · '+reviewRule.name} sub="Before / after on matched lines — verify, then commit" right={<div style={{display:'flex',gap:8}}><Button variant="ghost" size="sm">Skip</Button><Button variant="primary" size="sm" icon="check">Commit rule</Button></div>}>
  <div style={{display:'grid',gridTemplateColumns:'52px 1fr 1fr',gap:10,paddingBottom:2}}><span className="label">page</span><span className="label">before</span><span className="label">after</span></div>
  {RX_PREVIEW.hunks.map((h,i)=><DiffLine key={i} h={h}/>)}
  <div style={{marginTop:10,display:'flex',alignItems:'center',gap:7,fontSize:11,color:'var(--ink-3)'}}><Icon name="alert" size={12} style={{color:'var(--fuzzy)'}}/>1 match touches an initial (“M . Belloc”) — confirm it should close up.</div></Card>
</Body>);

const RXRules = () => (<Body>
 <div style={{display:'flex',alignItems:'center',gap:12}}>
  <Seg options={['All','Applied','Needs review','Disabled']} activeIdx={0}/>
  <span style={{flex:1}}/>
  <Button variant="ghost" size="sm" icon="package">Load preset</Button>
  <Button variant="default" size="sm" icon="plus">Add rule</Button>
 </div>
 <Card sub={null}><div style={{display:'flex',flexDirection:'column'}}>{RX_RULES.map((r,i)=><RuleRow key={r.id} rule={r} idx={i} full/>)}</div></Card>
 <div style={{display:'flex',alignItems:'center',gap:7,fontSize:11.5,color:'var(--ink-3)'}}><Icon name="info" size={13} style={{color:'var(--ocr)'}}/>Rules are ordered — an earlier replacement can change what a later rule matches. Drag to reorder.</div>
</Body>);

const RXSettings = () => (<Body><div><h2 style={{fontSize:16,fontWeight:600,color:'var(--ink-1)'}}>Stage settings · Regex pass</h2><div style={{marginTop:3,fontSize:12,color:'var(--ink-3)'}}>How the pass runs and what it’s allowed to touch.</div></div>
 <Card><SetRow title="Snapshot before run" sub="Keep a restore point so the pass is reversible"><Toggle2 on={true}/></SetRow><SetRow title="Require preview to commit" sub="No rule applies until its matches are reviewed"><Toggle2 on={true}/></SetRow><SetRow title="Default scope" sub="What a new rule matches against"><Seg options={['All pages','Body text','Selection']} activeIdx={0}/></SetRow><SetRow title="Skip proofer markup" sub="Don’t match inside [** ] notes or footnote tags"><Toggle2 on={true}/></SetRow><SetRow title="Case sensitivity" sub="Default for new rules"><Seg options={['Sensitive','Insensitive']} activeIdx={0}/></SetRow><SetRow title="Re-run on text change" sub="Re-apply enabled rules when upstream text updates"><Toggle2 on={false}/></SetRow></Card></Body>);

Object.assign(window,{RXMain,RXRules,RXSettings});
