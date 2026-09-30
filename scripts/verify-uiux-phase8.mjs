import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const css = fs.readFileSync(path.join(root, 'src/desktop/globals.css'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/desktop/desktop-app.tsx'), 'utf8')
const main = fs.readFileSync(path.join(root, 'src/desktop/main.tsx'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const modules = [
  ['dashboard', 'DashboardModule'],
  ['pos', 'POSModule'],
  ['products', 'ProductsModule'],
  ['inventory', 'InventoryModule'],
  ['sales', 'SalesModule'],
  ['customers', 'CustomersModule'],
  ['loyalty', 'LoyaltyModule'],
  ['purchases', 'PurchasesModule'],
  ['suppliers', 'SuppliersModule'],
  ['cash', 'CashModule'],
  ['expenses', 'ExpensesModule'],
  ['reports', 'ReportsModule'],
  ['general-accounts', 'GeneralAccountsModule'],
  ['audit', 'AuditModule'],
  ['settings', 'SettingsModule'],
  ['categories', 'CategoriesModule'],
  ['employees', 'EmployeesModule'],
  ['platform-admin', 'PlatformAdminModule'],
]

const checks = []
const add = (name, ok) => checks.push([name, Boolean(ok)])

add('Release verify script includes Phase 8 gate', packageJson.scripts?.['verify:release']?.includes('verify:uiux-phase8'))
add('Phase 8 script is registered', packageJson.scripts?.['verify:uiux-phase8'] === 'node scripts/verify-uiux-phase8.mjs')
add('Main content landmark exists', /<main[^>]+id="main-content"/.test(app))
add('Main content is vertically scrollable', /overflow-y-auto/.test(app))
add('Skip link exists', /تخطي إلى المحتوى الرئيسي/.test(main))
add('Command palette remains mounted', /<GlobalCommandPalette\b/.test(app))
add('RTL remains explicit', /dir="rtl"/.test(main) && /direction:\s*rtl/.test(css))
add('Reduced motion guard remains present', /prefers-reduced-motion:\s*reduce/.test(css))
add('High contrast guard remains present', /forced-colors:\s*active/.test(css))
add('Touch target guard remains present', /pointer:\s*coarse/.test(css))
add('Narrow viewport guard remains present', /@media \(max-width: 420px\)/.test(css))
add('Table overflow remains protected', /\[data-slot='table-container'\]/.test(css) && /overflow-x:\s*auto/.test(css))
add('Visual surface hook exists', /\.uk-visual-surface\s*\{/.test(css) && /data-active-module=\{activeModule\}/.test(app))
add('Visual focus hook exists', /\.uk-focus-ring\s*\{/.test(css))
add('Transition safety avoids `transition: all` in app CSS', !/transition\s*:\s*all\b/.test(css))
add('App shell does not import data-layer directly', !/from ['"]@\/lib\/(desktop-api|desktop-core)/.test(app))

for (const [slug, component] of modules) {
  const file = path.join(root, 'src/components/modules', `${slug}.tsx`)
  add(`Module source exists: ${slug}`, fs.existsSync(file))
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8')
    add(`Module export contract: ${slug}`, new RegExp(`export\\s+(?:const|function)\\s+${component}\\b`).test(text))
    add(`Module stays present in app routing source: ${slug}`, slug === 'platform-admin' ? /PlatformAdminModule/.test(app) : new RegExp(`case ['"]${slug}['"]`).test(app))
  }
}

const failed = checks.filter(([, ok]) => !ok)
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
console.log(`\nPhase 8 UI/UX verification: ${checks.length - failed.length}/${checks.length}`)
if (failed.length) {
  console.log('\nFailures:')
  for (const [name] of failed) console.log(`- ${name}`)
}
process.exit(failed.length ? 1 : 0)
