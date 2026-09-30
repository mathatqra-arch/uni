import { describe, expect, it } from 'vitest'
import { isDeadStock, normalizeDeadStockDays, resolveDeadStockDays } from '../src/lib/dead-stock'

describe('dead stock policy', () => {
  it('resolves product > subcategory > category > general', () => {
    expect(resolveDeadStockDays(10, 20, 30, 60)).toEqual({ days: 10, source: 'product' })
    expect(resolveDeadStockDays(null, 20, 30, 60)).toEqual({ days: 20, source: 'subcategory' })
    expect(resolveDeadStockDays(null, null, 30, 60)).toEqual({ days: 30, source: 'category' })
    expect(resolveDeadStockDays(null, null, null, 60)).toEqual({ days: 60, source: 'general' })
  })

  it('uses 60 days as the safe default', () => {
    expect(normalizeDeadStockDays(null)).toBe(60)
    expect(normalizeDeadStockDays('bad')).toBe(60)
  })

  it('does not mark a new product dead before its threshold', () => {
    const now = Date.UTC(2026, 8, 12)
    const fortyDaysAgo = new Date(now - 40 * 86400000).toISOString()
    expect(isDeadStock(fortyDaysAgo, now, 60)).toBe(false)
  })

  it('marks a product dead at the threshold', () => {
    const now = Date.UTC(2026, 8, 12)
    const sixtyDaysAgo = new Date(now - 60 * 86400000).toISOString()
    expect(isDeadStock(sixtyDaysAgo, now, 60)).toBe(true)
  })
})
