import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
let passed = 0
let failed = 0
function check(label, ok) {
  if (ok) { console.log(`✓ ${label}`); passed++ }
  else { console.error(`✗ ${label}`); failed++ }
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8') }

const main = read('src/desktop/main.tsx')
const login = read('src/components/pos/login-screen.tsx')
const license = read('src/components/pos/license-screen.tsx')
const setup = read('src/components/pos/setup-wizard.tsx')
const app = read('src/desktop/desktop-app.tsx')
const css = read('src/desktop/globals.css')
const html = read('index.html')
const tauri = read('src-tauri/tauri.conf.json')

check('Root error state keeps Uni Kasher branding', main.includes('/icon-512.png') && main.includes('تعذر إكمال التشغيل'))
check('Login is a real accessible form', login.includes('<form') && login.includes('autoComplete="username"') && login.includes('autoComplete="current-password"'))
check('Login supports password visibility without changing auth flow', login.includes('showPassword') && login.includes("type={showPassword ? 'text' : 'password'}"))
check('License screen keeps device-id activation path', license.includes("invoke<LicenseStatus>('license_status')") && license.includes("activate_license"))
check('Setup wizard keeps first-run completion endpoint', setup.includes("apiFetch('/setup/complete'") && setup.includes('onComplete()'))
check('Main app exposes stable main content landmark', app.includes('id="main-content"') && app.includes('aria-label="المحتوى الرئيسي"'))
check('Reduced motion remains covered in final polish', css.includes('.uk-release-state') && css.includes('prefers-reduced-motion: reduce'))
check('HTML remains Arabic RTL and branded', html.includes('lang="ar"') && html.includes('dir="rtl"') && html.includes('Uni Kasher'))
check('Tauri product identity is final', tauri.includes('"productName": "Uni Kasher"') && tauri.includes('"identifier": "com.unikasher.pos"'))
check('No generic gray release error screen remains in root entry', !main.includes('bg-gray-50') && !main.includes('text-gray-900'))
check('Startup/error flows avoid exposing credentials', !main.includes('BEGIN PRIVATE KEY') && !main.includes('-----BEGIN') && !login.includes('admin/123456') && !login.includes('value="123456"'))
check('Release polish marker present', css.includes('PHASE 9 — Final Release Polish'))

console.log(`\nPhase 9 UI/UX checks: ${passed}/${passed + failed}`)
if (failed) process.exit(1)
