import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const css = fs.readFileSync(path.join(root, 'src/desktop/globals.css'), 'utf8')
const dash = fs.readFileSync(path.join(root, 'src/components/modules/dashboard.tsx'), 'utf8')
const dialog = fs.readFileSync(path.join(root, 'src/components/ui/dialog.tsx'), 'utf8')
const input = fs.readFileSync(path.join(root, 'src/components/ui/input.tsx'), 'utf8')
const toast = fs.readFileSync(path.join(root, 'src/components/ui/toast.tsx'), 'utf8')

const checks = [
  ['Phase 12 token block', css.includes('PHASE 12 — UX FINISHING SYSTEM')],
  ['Light surface tokens', css.includes('--uk-surface-hover: #f3e7ed') && css.includes('--uk-field-bg: #fffaf1')],
  ['Dark surface tokens', css.includes('--uk-surface-hover: #3b243f') && css.includes('--uk-field-bg: #24142d')],
  ['Invalid field state', css.includes("[aria-invalid='true']") && css.includes('--uk-danger')],
  ['Disabled field state', css.includes(':disabled') && css.includes('--uk-ink-muted')],
  ['Table hover state', css.includes('[data-slot=\'table\'] tbody tr:hover')],
  ['Table focus-within state', css.includes('[data-slot=\'table\'] tbody tr:focus-within')],
  ['Intentional horizontal scrolling', css.includes('.uk-table-scroll') && css.includes('overscroll-behavior-inline')],
  ['Dialog footer separation', css.includes('[data-slot=\'dialog-content\'] [data-slot=\'dialog-footer\']')],
  ['Menu target size', css.includes("[data-slot='dropdown-menu-item']") && css.includes('min-height: 38px')],
  ['Reduced motion preserved', css.includes('prefers-reduced-motion: reduce')],
  ['Dashboard refresh import remains present', dash.includes('RefreshCw')],
  ['Dialog remains Radix-based', dialog.includes('@radix-ui/react-dialog')],
  ['Input remains present', input.includes('data-slot="input"')],
  ['Toast remains Radix-based', toast.includes('@radix-ui/react-toast')],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failed++
}
console.log(`Phase 12 UI/UX verification: ${checks.length - failed}/${checks.length}`)
if (failed) process.exit(1)
