import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mustContain = [
  ['src/desktop/globals.css', ['--uk-ease', '.uk-financial-kpi', '.uk-transaction-row', 'prefers-reduced-motion']],
  ['src/components/modules/cash.tsx', ['uk-page', 'uk-financial-kpi', 'uk-transaction-row', 'uk-amount-positive', 'uk-amount-negative']],
  ['src/components/modules/dashboard.tsx', ['uk-page', 'uk-financial-kpi']],
  ['src/components/modules/reports.tsx', ['uk-financial-report', 'uk-transaction-row']],
];
let passed = 0;
for (const [file, tokens] of mustContain) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const token of tokens) {
    if (!text.includes(token)) throw new Error(`${file}: missing ${token}`);
    passed++;
  }
}
const css = fs.readFileSync(path.join(root, 'src/desktop/globals.css'), 'utf8');
if (!css.includes('@keyframes uk-number-pulse')) throw new Error('Missing motion feedback');
if (!css.includes('prefers-reduced-motion')) throw new Error('Missing reduced-motion support');
passed += 2;
console.log(`UI/UX Phase 4 verification PASSED (${passed}/${passed})`);
