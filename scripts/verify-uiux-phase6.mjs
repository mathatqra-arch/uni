import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = []
const ok = (name, pass, detail='') => checks.push({name, pass, detail})

const app = read('src/desktop/desktop-app.tsx')
const palette = read('src/components/layout/global-command-palette.tsx')
const command = read('src/components/ui/command.tsx')
const pkg = JSON.parse(read('package.json'))

ok('Global command palette exists', palette.includes('GlobalCommandPalette'))
ok('Ctrl+K shortcut wired', app.includes("event.key.toLowerCase() === 'k'"))
ok('F2 POS shortcut wired', app.includes("event.key === 'F2'"))
ok('Command palette supports navigation', palette.includes('التنقل السريع'))
ok('Command palette supports local data search', palette.includes('/products?search=') && palette.includes('/customers?search=') && palette.includes('/suppliers?search='))
ok('Search results are permission-neutral in presentation', !palette.includes("navigate('/platform')"))
ok('Theme command included', palette.includes('toggleTheme'))
ok('Refresh command included', palette.includes("unikasher:data-changed"))
ok('Dialog remains accessible', command.includes('DialogTitle') && command.includes('DialogDescription'))
ok('Command shortcut hint is visible', app.includes('Ctrl K'))
ok('Phase 6 verifier script registered', pkg.scripts?.['verify:uiux-phase6'] === 'node scripts/verify-uiux-phase6.mjs')
ok('Release gate includes Phase 6', String(pkg.scripts?.['verify:release'] || '').includes('verify:uiux-phase6'))

let failed = 0
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
failed = checks.filter(c => !c.pass).length
console.log(`\nUI/UX Phase 6 verification: ${checks.length - failed}/${checks.length} passed`)
if (failed) process.exit(1)
