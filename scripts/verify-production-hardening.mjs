import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
let failures = 0
function pass(label){ console.log(`PASS ${label}`) }
function fail(label){ console.error(`FAIL ${label}`); failures++ }

const packageJson = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
const lockJson = JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'))
const scripts = packageJson.scripts || {}
for (const name of ['typecheck','build','test','lint','verify:release']) {
  if (typeof scripts[name] === 'string' && scripts[name]) pass(`package script: ${name}`)
  else fail(`package script missing: ${name}`)
}

const sourceFiles = []
function walk(dir){
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','dist','build','coverage'].includes(entry.name)) continue
    const full = path.join(dir,entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full)
  }
}
walk(path.join(root,'src'))

let rawConsole = []
let clientDirectiveIssues = []
for (const file of sourceFiles) {
  const s = fs.readFileSync(file,'utf8')
  if (/console\.(log|debug|info|warn|error)\s*\(/.test(s) && !file.endsWith(`${path.sep}logger.ts`)) rawConsole.push(path.relative(root,file))
  if (/(^|\n)\s*['"]use client['"]/.test(s)) {
    const stripped=s.replace(/^\uFEFF/,'').trimStart()
    if (!(stripped.startsWith("'use client'") || stripped.startsWith('"use client"'))) clientDirectiveIssues.push(path.relative(root,file))
  }
}
if (rawConsole.length) rawConsole.forEach(f=>fail(`raw console in ${f}`)); else pass('production source uses central logger')
if (clientDirectiveIssues.length) clientDirectiveIssues.forEach(f=>fail(`client directive order: ${f}`)); else pass('all client directives are first')

if (lockJson.packages?.['']?.devDependencies?.['@types/bcryptjs']) fail('deprecated @types/bcryptjs remains in lockfile')
else pass('deprecated bcryptjs stub removed from lockfile')

const secretCandidates = ['unikasher-private.key','UniKasher-master-private.key','master-private.key']
const leaked = secretCandidates.filter(f=>fs.existsSync(path.join(root,f)))
if (leaked.length) leaked.forEach(f=>fail(`private key leaked in project root: ${f}`)); else pass('no private key in release tree')

if (failures) { process.exitCode=1 } else console.log('Uni Kasher production hardening verification: PASS')
