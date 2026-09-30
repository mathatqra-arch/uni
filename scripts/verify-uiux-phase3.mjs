import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const modules = ['products.tsx','inventory.tsx','customers.tsx','suppliers.tsx','categories.tsx'];
const errors = [];
for (const file of modules) {
  const full = path.join(root, 'src', 'components', 'modules', file);
  if (!fs.existsSync(full)) { errors.push(`${file}: missing`); continue; }
  const s = fs.readFileSync(full, 'utf8');
  if (!s.includes('module-page')) errors.push(`${file}: module-page missing`);
  if (!s.includes('ux-data-table')) errors.push(`${file}: ux-data-table missing`);
  if (!s.includes('ux-action-btn') && !s.includes('<Button')) errors.push(`${file}: actionable controls missing`);
}
const css = fs.readFileSync(path.join(root,'src','desktop','globals.css'),'utf8');
for (const token of ['PHASE 3 — DATA MANAGEMENT UX','prefers-reduced-motion','ux-filter-card']) {
  if (!css.includes(token)) errors.push(`globals.css: missing ${token}`);
}
if (errors.length) {
  console.error(`UI/UX Phase 3 verification FAILED (${errors.length})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log('UI/UX Phase 3 verification PASSED (data management modules + motion/accessibility guards)');
