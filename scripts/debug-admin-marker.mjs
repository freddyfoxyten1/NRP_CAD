import fs from 'fs';
const s = fs.readFileSync('artifacts/dojrp/src/pages/AdminPortal.classic.tsx', 'utf8').replace(/\r\n/g, '\n');
const contentIdx = s.indexOf('          <div className="flex-1 px-5 py-8 sm:px-8 lg:px-9">');
const tabStartIdx = s.indexOf("            {activeTab === 'members' &&", contentIdx);
console.log('contentIdx', contentIdx, 'tabStartIdx', tabStartIdx);
const i = s.indexOf('{staffOpenDocId !== null && (');
console.log('overlay', i);
console.log(JSON.stringify(s.slice(i - 250, i + 30)));
