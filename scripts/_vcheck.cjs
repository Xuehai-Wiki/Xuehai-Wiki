
const fs = require('fs');
const apps = JSON.parse(fs.readFileSync('public/data/xuehai-apps.json','utf8'));
let multi = 0, single = 0, none = 0;
const dist = {};
for (const a of apps) {
  const n = a.appVersions ? a.appVersions.length : 0;
  dist[n] = (dist[n]||0)+1;
  if (n > 1) multi++; else if (n === 1) single++; else none++;
}
console.log('version-count dist:', JSON.stringify(dist));
console.log('multi:', multi, 'single:', single, 'none:', none);
// apps with most versions
const top = [...apps].sort((a,b)=>(b.appVersions||[]).length-(a.appVersions||[]).length).slice(0,5)
  .map(a=>a.name+':'+(a.appVersions||[]).length);
console.log('most versions:', top);
// check version fields present
const v = apps.find(a=>a.appVersions && a.appVersions.length>1).appVersions[lastest?0:0];
console.log('version keys:', Object.keys(apps.find(a=>a.appVersions&&a.appVersions.length).appVersions[0]));
