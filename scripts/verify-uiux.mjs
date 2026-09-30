import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const checks = []
const check = (ok, message) => {
  checks.push({ ok, message })
  if (ok) console.log(`✓ ${message}`)
  else console.error(`✗ ${message}`)
}

const css = read('src/desktop/globals.css')
const button = read('src/components/ui/button.tsx')
const card = read('src/components/ui/card.tsx')
const input = read('src/components/ui/input.tsx')
const table = read('src/components/ui/table.tsx')
const tabs = read('src/components/ui/tabs.tsx')
const dialog = read('src/components/ui/dialog.tsx')
const shell = read('src/desktop/desktop-app.tsx')
const sidebar = read('src/components/layout/sidebar.tsx')
const generalAccounts = read('src/components/modules/general-accounts.tsx')
const login = read('src/components/pos/login-screen.tsx')
const license = read('src/components/pos/license-screen.tsx')

for (const hex of ['#F5EFE2', '#E8E5A4', '#D44D5C', '#772344', '#160029']) {
  check(css.includes(hex), `brand color ${hex} present in design tokens`)
}
check(css.includes('.app-context-bar'), 'contextual app header styles are defined')
check(css.includes(':focus-visible'), 'accessible focus treatment is defined')
check(css.includes('prefers-reduced-motion'), 'reduced-motion support is defined')
check(css.includes('.table-shell'), 'table shell pattern is defined')
check(button.includes('active:scale-[0.985]'), 'button interaction feedback is standardized')
check(input.includes('rounded-xl'), 'form controls use the shared rounded treatment')
check(card.includes('border-border/70'), 'cards use the shared border token')
check(table.includes('[&_th]:bg-muted/50'), 'table headers have a consistent visual hierarchy')
check(tabs.includes('overflow-x-auto'), 'tabs remain usable on narrow screens')
check(dialog.includes('rounded-2xl'), 'dialogs use the shared modal surface')
check(shell.includes('app-context-bar'), 'desktop shell uses the contextual header')
check(sidebar.includes('/icon-512.png'), 'sidebar uses the Uni Kasher app icon')
check(login.includes('/icon-512.png'), 'login screen uses the Uni Kasher app icon')
check(license.includes('/icon-512.png'), 'license screen uses the Uni Kasher app icon')
check(!generalAccounts.includes('حساب جديد'), 'General Accounts no longer exposes account-creation action')
check(!generalAccounts.includes('قيد يومية'), 'General Accounts no longer exposes daily-journal creation action')
check(generalAccounts.includes('سجل القيود'), 'existing journal history remains readable')

const passed = checks.filter((x) => x.ok).length
console.log(`Uni Kasher UI/UX verification: ${passed}/${checks.length}`)
if (passed !== checks.length) process.exit(1)
