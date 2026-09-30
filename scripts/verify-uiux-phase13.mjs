import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const css = fs.readFileSync(path.join(root, 'src/desktop/globals.css'), 'utf8')
const button = fs.readFileSync(path.join(root, 'src/components/ui/button.tsx'), 'utf8')
const dialog = fs.readFileSync(path.join(root, 'src/components/ui/dialog.tsx'), 'utf8')
const input = fs.readFileSync(path.join(root, 'src/components/ui/input.tsx'), 'utf8')
const select = fs.readFileSync(path.join(root, 'src/components/ui/select.tsx'), 'utf8')
const login = fs.readFileSync(path.join(root, 'src/components/pos/login-screen.tsx'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/desktop/desktop-app.tsx'), 'utf8')

const checks = [
  ['Phase 13 system block', css.includes('PHASE 13: ACCESSIBILITY + INTERACTION CERTIFICATION')],
  ['Global focus ring', css.includes('focus-visible') && css.includes('#D44D5C')],
  ['Light control surface', css.includes('--uk-control-bg: #fffaf1')],
  ['Dark control surface', css.includes('--uk-control-bg: #24142d')],
  ['Opaque Radix surfaces', css.includes('opacity: 1 !important') && css.includes('[data-slot=\'dialog-content\']')],
  ['Dialog overlay contrast', css.includes('--uk-overlay')],
  ['Menu selected state', css.includes('data-selected=\'true\'')],
  ['Controlled scroll region', css.includes('.uk-scroll-region') && css.includes('overscroll-behavior: contain')],
  ['Stable scrollbar gutter', css.includes('scrollbar-gutter: stable')],
  ['Touch target minimum', css.includes('min-height: 40px')],
  ['Reduced motion preserved', css.includes('prefers-reduced-motion: reduce')],
  ['Forced colors support', css.includes('forced-colors: active')],
  ['Button interaction marker', button.includes('data-uk-interactive="true"')],
  ['Dialog remains Radix-based', dialog.includes('@radix-ui/react-dialog')],
  ['Input remains shared', input.includes('data-slot="input"')],
  ['Select remains Radix-based', select.includes('@radix-ui/react-select')],
  ['Login still uses a form', login.includes('<form') && login.includes('type="submit"')],
  ['Desktop main landmark', app.includes('id="main-content"') && app.includes('tabIndex={-1}')],
]
let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failed++
}
console.log(`Phase 13 UI/UX verification: ${checks.length - failed}/${checks.length}`)
if (failed) process.exit(1)
