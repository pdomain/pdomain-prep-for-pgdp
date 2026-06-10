// validation-data.js (ref wf02)
const VAL_RULES = [
  {id:'pages',name:'Every page has image + text',level:'pass',detail:'387 / 387 complete'},
  {id:'seq',name:'Page sequence is contiguous',level:'pass',detail:'no gaps after Page order'},
  {id:'enc',name:'Text is valid UTF-8',level:'pass',detail:'387 files clean'},
  {id:'empty',name:'No empty text files',level:'warn',detail:'2 pages text-light (illustration plates)'},
  {id:'dims',name:'Images share the common canvas',level:'pass',detail:'2480×3400 · from Canvas map'},
  {id:'scan',name:'No unresolved scannos',level:'warn',detail:'4 suspects still in the Wordcheck queue'},
  {id:'hyph',name:'No dangling end-of-line hyphens',level:'pass',detail:'Hyphen join resolved all'},
  {id:'meta',name:'Project metadata complete',level:'error',detail:'missing: source URL / scan credit'},
];
const VAL_COUNTS={pass:5,warn:2,error:1};
Object.assign(window,{VAL_RULES,VAL_COUNTS});
