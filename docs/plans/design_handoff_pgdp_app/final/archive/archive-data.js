// archive-data.js
const ARC_ITEMS = [
  {name:'Source scans (original)',meta:'2.1 GB · 387 JP2',keep:true},
  {name:'Final proof pack + archive',meta:'1.38 GB',keep:true},
  {name:'Manifest + checksums',meta:'provenance',keep:true},
  {name:'Pipeline settings snapshot',meta:'25-stage config',keep:true},
  {name:'Intermediate stage outputs',meta:'18.4 GB',keep:false},
];
Object.assign(window,{ARC_ITEMS});
