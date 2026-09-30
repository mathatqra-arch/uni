function sqlEsc(v){ if(v===null||v===undefined)return 'NULL'; return `'${String(v).replace(/'/g,"''")}'`; }

const ARABIC_MAP: Record<string,string> = {
  'ا':'a','أ':'a','إ':'a','آ':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y','ى':'y','ة':'h','ء':'a','ؤ':'w','ئ':'y'
}

export function arabicToLatin(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().split('').map(ch => ARABIC_MAP[ch] ?? ch).join('')
}

function words(value: unknown): string[] {
  return arabicToLatin(value).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

export function deriveCategorySkuBase(name: string): string {
  const ws = words(name)
  let code = ws.length >= 2 ? ws.map(w => w[0]).join('').slice(0,3) : (ws[0] || 'cat').slice(0,3)
  if (code.length < 3) code = (code + 'cat').slice(0,3)
  return code.toUpperCase()
}

export async function ensureCategorySkuCode(db, categoryId:string): Promise<string> {
  const row = (await db.select('SELECT id,name,name_ar,sku_code FROM categories WHERE id=? LIMIT 1',[categoryId]))[0]
  if (!row) throw new Error('الفئة غير موجودة')
  if (row.sku_code) return row.sku_code
  const used = await db.select('SELECT sku_code FROM categories WHERE sku_code IS NOT NULL AND sku_code != ?', [row.sku_code || ''])
  const usedSet = new Set((used||[]).map((r)=>String(r.sku_code||'').toUpperCase()))
  const base = deriveCategorySkuBase(row.name_ar || row.name)
  let code = base
  let n=2
  while (usedSet.has(code)) code = `${base}${n++}`.slice(0,8)
  await db.execute(`UPDATE categories SET sku_code=${sqlEsc(code)}, updated_at=datetime('now') WHERE id=${sqlEsc(categoryId)}`)
  return code
}

export async function generateProductSku(db, categoryId:string): Promise<string> {
  const category = (await db.select('SELECT id,name,name_ar,parent_id,sku_code FROM categories WHERE id=? LIMIT 1',[categoryId]))[0]
  if (!category) throw new Error('لا يمكن توليد SKU بدون فئة صحيحة')
  const childCode = await ensureCategorySkuCode(db, category.id)
  let prefix = childCode
  if (category.parent_id) {
    const parentCode = await ensureCategorySkuCode(db, category.parent_id)
    prefix = `${parentCode}-${childCode}`
  }
  const seqKey = `PRODUCT:${prefix}`
  const existingSeq = (await db.select('SELECT next_number FROM sku_sequences WHERE sequence_key=? LIMIT 1',[seqKey]))[0]
  let next = Number(existingSeq?.next_number || 1)
  while (true) {
    const sku = `${prefix}-${String(next).padStart(4,'0')}`
    const collision = (await db.select('SELECT id FROM products WHERE sku=? LIMIT 1',[sku]))[0]
    if (!collision) {
      if (existingSeq) await db.execute(`UPDATE sku_sequences SET next_number=${next+1}, updated_at=datetime('now') WHERE sequence_key=${sqlEsc(seqKey)}`)
      else await db.execute(`INSERT INTO sku_sequences(sequence_key,next_number,updated_at) VALUES(${sqlEsc(seqKey)},${next+1},datetime('now'))`)
      return sku
    }
    next++
  }
}
