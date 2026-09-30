import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const css=read('src/desktop/globals.css');
const pos=read('src/components/modules/pos.tsx');
const err=read('src/components/error-boundary.tsx');
const login=read('src/components/pos/login-screen.tsx');
const dash=read('src/components/modules/dashboard.tsx');
const checks=[
['global phase marker',css.includes('PHASE 11 — GLOBAL VISUAL CONSISTENCY')],
['light surface token',css.includes('--uk-surface-0: #fffaf1')],
['dark surface token',css.includes('--uk-surface-1: #281533')],
['opaque dialogs',css.includes('opacity: 1 !important') && css.includes("[data-slot='dialog-content']")],
['POS product viewport hidden overflow',css.includes('.pos-products-viewport {') && css.includes('overflow: hidden !important')],
['POS pagination state',pos.includes('const [productPage, setProductPage]')],
['POS pagination UI',pos.includes('pos-products-pagination')],
['POS no product ScrollArea',!pos.includes('<ScrollArea className="pos-products-scroll flex-1 min-h-0">')],
['error boundary themed',err.includes('error-surface') && !err.includes('bg-white')],
['single login submit',((login.match(/type="submit"/g)||[]).length===1) && !/onClick=\{[^}]*handleLogin/.test(login)],
['dashboard refresh import',/import[\s\S]*RefreshCw/.test(dash)],
['no transaction SQL in UI files', ![pos,err,login,dash].some(s=>/\b(BEGIN|COMMIT|ROLLBACK)\b/.test(s))],
];
let fail=0; for(const [n,p] of checks){console.log(`${p?'PASS':'FAIL'} ${n}`); if(!p) fail++;}
console.log(`UI/UX Phase 11: ${checks.length-fail}/${checks.length} PASS`);
process.exit(fail?1:0);
