import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const css = fs.readFileSync(path.join(root, 'src/desktop/globals.css'), 'utf8')
const checks = [
  ['motion tokens', css.includes('--uk-duration-fast') && css.includes('--uk-ease-spring')],
  ['button tactile feedback', css.includes('[data-slot=\'button\']:not(:disabled):active')],
  ['focus motion', css.includes('@keyframes uk-focus-in')],
  ['toast enter/exit', css.includes('uk-toast-in') && css.includes('uk-toast-out')],
  ['surface enter/exit', css.includes('uk-surface-in') && css.includes('uk-surface-out')],
  ['overlay transitions', css.includes('uk-overlay-in') && css.includes('uk-overlay-out')],
  ['skeleton shimmer', css.includes('uk-skeleton-shimmer') && css.includes('uk-shimmer')],
  ['success feedback', css.includes('uk-success-pop')],
  ['financial number feedback', css.includes('uk-number-update')],
  ['item entrance', css.includes('uk-item-enter')],
  ['stagger utility', css.includes('uk-stagger')],
  ['reduced motion', css.includes('@media (prefers-reduced-motion: reduce)')],
  ['no layout animation primitive', !css.includes('transition: all')],
  ['GPU-friendly transforms', css.includes('translate3d')],
  ['motion cap on large collections', css.includes('.uk-motion-light')],
]

let passed = 0
for (const [name, ok] of checks) {
  if (ok) { passed++; console.log(`PASS ${name}`) }
  else console.error(`FAIL ${name}`)
}
console.log(`\nUI/UX Phase 5: ${passed}/${checks.length}`)
if (passed !== checks.length) process.exit(1)
