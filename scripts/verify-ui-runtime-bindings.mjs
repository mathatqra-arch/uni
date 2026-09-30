import fs from 'node:fs'
import path from 'node:path'

const checks = [
  {
    file: 'src/desktop/desktop-app.tsx',
    required: ['const { activeModule, setModule, theme } = useUIStore()'],
    label: 'DesktopApp setModule binding',
  },
  {
    file: 'src/components/modules/dashboard.tsx',
    required: [
      'RefreshCw',
      'Plus,',
      'WalletCards',
      'PackagePlus',
      'ShoppingCart as ShoppingCartIcon',
    ],
    label: 'Dashboard icon imports',
  },
]

let passed = 0
for (const check of checks) {
  const content = fs.readFileSync(path.resolve(check.file), 'utf8')
  const ok = check.required.every((fragment) => content.includes(fragment))
  if (!ok) {
    console.error(`FAIL ${check.label}`)
    process.exitCode = 1
    continue
  }
  passed++
  console.log(`PASS ${check.label}`)
}

console.log(`UI runtime binding verification: ${passed}/${checks.length}`)
