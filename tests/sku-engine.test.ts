import { describe, expect, it } from 'vitest'
import { arabicToLatin, generateProductSku } from '@/lib/sku-generator'

describe('SKU engine', () => {
  it('transliterates Arabic text into stable latin tokens', () => {
    expect(arabicToLatin('ملابس')).toContain('ml')
  })

  it('generates category/subcategory-aware sequential SKUs', async () => {
    const rows: Record<string, any[]> = {
      categories: [{ id: 'sub-1', name: 'تيشيرت', name_ar: 'تيشيرت', parent_id: 'cat-1', sku_code: 'TSH' },
        { id: 'cat-1', name: 'ملابس', name_ar: 'ملابس', parent_id: null, sku_code: 'MLS' }],
      products: [],
      sku_sequences: [],
    }
    const db = {
      select: async (sql: string, args: any[]) => {
        if (sql.includes('FROM categories WHERE id=?')) return rows.categories.filter(r => r.id === args[0])
        if (sql.includes('SELECT sku_code FROM categories')) return rows.categories.map(r => ({ sku_code: r.sku_code }))
        if (sql.includes('FROM sku_sequences')) return rows.sku_sequences.filter(r => r.sequence_key === args[0])
        if (sql.includes('FROM products WHERE sku')) return rows.products.filter(r => r.sku === args[0])
        return []
      },
      execute: async (sql: string) => {
        const seqMatch = sql.match(/sequence_key='([^']+)'/)
        if (sql.startsWith('UPDATE sku_sequences')) {
          const key = seqMatch?.[1]
          const row = rows.sku_sequences.find(r => r.sequence_key === key)
          if (row) row.next_number += 1
        } else if (sql.startsWith('INSERT INTO sku_sequences')) {
          const m = sql.match(/VALUES\('([^']+)',(\d+)/)
          if (m) rows.sku_sequences.push({ sequence_key: m[1], next_number: Number(m[2]) })
        }
      },
    }

    const first = await generateProductSku(db, 'sub-1')
    const second = await generateProductSku(db, 'sub-1')
    expect(first).toBe('MLS-TSH-0001')
    expect(second).toBe('MLS-TSH-0002')
  })
})
