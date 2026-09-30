import fs from "node:fs"
import path from "node:path"
const root=path.resolve(process.cwd())
const css=fs.readFileSync(path.join(root,"src/desktop/globals.css"),"utf8")
const pos=fs.readFileSync(path.join(root,"src/components/modules/pos.tsx"),"utf8")
const login=fs.readFileSync(path.join(root,"src/components/pos/login-screen.tsx"),"utf8")
const checks=[
  [css.includes("PHASE 10A — Contrast & Surface Clarity"),"contrast foundation"],
  [css.includes("PHASE 10B — Contrast polish"),"contrast polish"],
  [css.includes('[data-slot="dialog-content"]'),"opaque dialogs"],
  [css.includes('[data-slot="popover-content"]'),"opaque popovers"],
  [css.includes(".dark .login-input"),"dark login input"],
  [css.includes(".pos-workspace"),"viewport locked POS"],
  [css.includes("scrollbar-width: none"),"hidden POS scrollbars"],
  [css.includes("repeat(6, minmax(0, 1fr))"),"dense desktop POS grid"],
  [pos.includes("pos-categories-scroll"),"wrapped categories"],
  [pos.includes("pos-products-pagination") && pos.includes("pos-products-viewport"),"bounded product list without product scrollbar"],
  [pos.includes("pos-cart-footer"),"anchored cart footer"],
  [login.includes("login-surface") && login.includes("login-input"),"login surface contrast"],
]
let bad=0
for(const [ok,label] of checks){console.log(`${ok?'PASS':'FAIL'} ${label}`); if(!ok) bad++}
if(bad)process.exit(1)
console.log(`${checks.length}/${checks.length} Phase 10 PASS`)
