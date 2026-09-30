import fs from 'node:fs'

const css = fs.readFileSync('src/desktop/globals.css', 'utf8')
const main = fs.readFileSync('src/desktop/main.tsx', 'utf8')
const app = fs.readFileSync('src/desktop/desktop-app.tsx', 'utf8')

const checks = [
  ['Global RTL direction', /html[\s\S]*direction:\s*rtl/.test(css) && /body[\s\S]*direction:\s*rtl/.test(css)],
  ['Reduced motion support', /prefers-reduced-motion:\s*reduce/.test(css)],
  ['Forced colors support', /forced-colors:\s*active/.test(css)],
  ['Mobile viewport hardening', /@media \(max-width: 767px\)/.test(css)],
  ['Narrow viewport hardening', /@media \(max-width: 420px\)/.test(css)],
  ['Touch input hardening', /pointer:\s*coarse/.test(css)],
  ['Visible focus ring', /focus-visible[^{]*\{[\s\S]*outline:\s*2px/.test(css)],
  ['Screen reader utility', /\.sr-only\s*\{/.test(css)],
  ['Skip link', /تخطي إلى المحتوى الرئيسي/.test(main)],
  ['Main landmark target', /id="main-content"/.test(app)],
  ['Main landmark keyboard focus', /id="main-content"\s+tabIndex=\{?[-]?1\}?/.test(app)],
  ['Phase 7 scope is UI-only', !/from ['"]@\/lib\/(desktop-api|desktop-core)|desktop-api|desktop-core/i.test(main + app)],
  ['All embedded HTML images have alt text', (() => { const html = fs.readFileSync('src/components/pos/qr-code-dialog.tsx', 'utf8'); const tags = html.match(/<img\b[^>]*>/gi) || []; return tags.every((tag) => /\balt\s*=/.test(tag)); })()],
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failed++
}

console.log(`\nPhase 7 UI/UX verification: ${checks.length - failed}/${checks.length}`)
process.exit(failed ? 1 : 0)
