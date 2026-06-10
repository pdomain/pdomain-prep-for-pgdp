// submit-check-data.js
const SUB_CHECKS = [
  {ok:true,label:'Authenticated to pgdp.net as project manager'},
  {ok:true,label:'Target project slot exists and is empty'},
  {ok:true,label:'Package matches PGDP layout + naming rules'},
  {ok:true,label:'Manifest checksums verify against the archive'},
  {ok:true,label:'Page count (387) matches the project record'},
  {ok:false,label:'Source-scan credit line present in metadata'},
];
Object.assign(window,{SUB_CHECKS});
