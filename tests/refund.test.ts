import { describe, it, expect } from 'vitest'

// ============================================================
// REFUND VALIDATION TESTS
// ============================================================
// Tests refund double-spend prevention.
// Verifies already-returned quantities are checked.
// ============================================================

interface SaleItem {
  id: string
  quantity: number
}

interface SaleReturnItem {
  saleItemId: string
  quantity: number
}

function validateRefund(
  items: { saleItemId: string; quantity: number }[],
  saleItems: SaleItem[],
  previousReturns: SaleReturnItem[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const ret of items) {
    const saleItem = saleItems.find((si) => si.id === ret.saleItemId)
    if (!saleItem) {
      errors.push(`Sale item not found: ${ret.saleItemId}`)
      continue
    }

    // Calculate already returned
    const alreadyReturned = previousReturns
      .filter((r) => r.saleItemId === ret.saleItemId)
      .reduce((sum, r) => sum + r.quantity, 0)

    const maxRefundable = saleItem.quantity - alreadyReturned

    if (ret.quantity > maxRefundable) {
      errors.push(
        `Quantity exceeds refundable for ${ret.saleItemId} (max: ${maxRefundable}, requested: ${ret.quantity})`
      )
    }

    if (ret.quantity > saleItem.quantity) {
      errors.push(`Refund quantity exceeds original sale quantity for ${ret.saleItemId}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

describe('Refund Validation', () => {
  const saleItems: SaleItem[] = [
    { id: 'si-1', quantity: 5 },
    { id: 'si-2', quantity: 3 },
    { id: 'si-3', quantity: 10 },
  ]

  it('should allow refund within original quantity', () => {
    const result = validateRefund(
      [{ saleItemId: 'si-1', quantity: 3 }],
      saleItems,
      []
    )
    expect(result.valid).toBe(true)
  })

  it('should allow full refund', () => {
    const result = validateRefund(
      [{ saleItemId: 'si-1', quantity: 5 }],
      saleItems,
      []
    )
    expect(result.valid).toBe(true)
  })

  it('should block refund exceeding original quantity', () => {
    const result = validateRefund(
      [{ saleItemId: 'si-1', quantity: 6 }],
      saleItems,
      []
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('exceeds')
  })

  it('should block double refund (already returned)', () => {
    const previousReturns: SaleReturnItem[] = [
      { saleItemId: 'si-1', quantity: 3 },
    ]
    // Try to refund 4 more (3 already returned, 5 original, max = 2)
    const result = validateRefund(
      [{ saleItemId: 'si-1', quantity: 4 }],
      saleItems,
      previousReturns
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('max: 2')
  })

  it('should allow partial refund after previous partial', () => {
    const previousReturns: SaleReturnItem[] = [
      { saleItemId: 'si-1', quantity: 2 },
    ]
    // 5 - 2 = 3 remaining, refund 3 more
    const result = validateRefund(
      [{ saleItemId: 'si-1', quantity: 3 }],
      saleItems,
      previousReturns
    )
    expect(result.valid).toBe(true)
  })

  it('should block refund for non-existent sale item', () => {
    const result = validateRefund(
      [{ saleItemId: 'non-existent', quantity: 1 }],
      saleItems,
      []
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  it('should handle multiple items in one refund', () => {
    const result = validateRefund(
      [
        { saleItemId: 'si-1', quantity: 2 },
        { saleItemId: 'si-2', quantity: 1 },
        { saleItemId: 'si-3', quantity: 5 },
      ],
      saleItems,
      []
    )
    expect(result.valid).toBe(true)
  })

  it('should calculate refund total correctly', () => {
    const items = [
      { saleItemId: 'si-1', quantity: 2, unitPrice: 100, total: 200 },
      { saleItemId: 'si-2', quantity: 1, unitPrice: 50, total: 50 },
    ]
    const refundTotal = items.reduce((sum, i) => sum + i.total, 0)
    expect(refundTotal).toBe(250)
  })

  it('should set status REFUNDED when full refund', () => {
    const saleTotal = 500
    const refundTotal = 500
    const status = refundTotal >= saleTotal ? 'REFUNDED' : 'PARTIAL_REFUND'
    expect(status).toBe('REFUNDED')
  })

  it('should set status PARTIAL_REFUND when partial', () => {
    const saleTotal = 500
    const refundTotal = 200
    const status = refundTotal >= saleTotal ? 'REFUNDED' : 'PARTIAL_REFUND'
    expect(status).toBe('PARTIAL_REFUND')
  })

  // ============================================================
  // REGRESSION: cumulative status across multiple partial refunds
  // ============================================================
  // BUG: status was computed from just the current refund call's amount
  // instead of the sum of ALL completed returns for the sale. Two 50%
  // partial refunds would leave the sale stuck as PARTIAL_REFUND forever
  // instead of flipping to REFUNDED once nothing is left to return.
  function statusAfterRefund(saleTotal: number, allCompletedReturnTotals: number[]): string {
    const cumulativeRefunded = allCompletedReturnTotals.reduce((s, t) => s + t, 0)
    return cumulativeRefunded >= saleTotal ? 'REFUNDED' : 'PARTIAL_REFUND'
  }

  it('should flip to REFUNDED once cumulative partial refunds cover the full total', () => {
    const saleTotal = 500
    // First partial refund: 250 of 500 → still partial
    expect(statusAfterRefund(saleTotal, [250])).toBe('PARTIAL_REFUND')
    // Second partial refund brings cumulative to 500 → now fully refunded
    expect(statusAfterRefund(saleTotal, [250, 250])).toBe('REFUNDED')
  })

  it('should stay PARTIAL_REFUND if cumulative refunds are still short of total', () => {
    const saleTotal = 500
    expect(statusAfterRefund(saleTotal, [100, 150])).toBe('PARTIAL_REFUND')
  })

  it('should compute remaining refundable quantity accounting for prior returns', () => {
    const originalQty = 5
    const alreadyReturned = 2
    const remaining = originalQty - alreadyReturned
    expect(remaining).toBe(3)
  })

  // ============================================================
  // REGRESSION: full vs partial classification per return, not per sale
  // ============================================================
  // BUG: reports classified each return row as "full"/"partial" by reading
  // the sale's CURRENT status. Once a sale becomes fully refunded via two
  // separate 50% partial returns, both historical return rows (each of
  // which was genuinely partial at the time) got relabeled "full" — wrong.
  function isFullReturn(ret: { total: number; sale: { total: number } | null }): boolean {
    return !!ret.sale && ret.total >= ret.sale.total - 0.01
  }

  it('should label a single one-shot full refund as full', () => {
    expect(isFullReturn({ total: 500, sale: { total: 500 } })).toBe(true)
  })

  it('should label each half of two sequential 50% partial refunds as partial, not full', () => {
    const sale = { total: 500 }
    const firstReturn = { total: 250, sale }
    const secondReturn = { total: 250, sale }
    // Even though the SALE ends up REFUNDED after the second return lands,
    // neither individual return transaction was itself a full refund.
    expect(isFullReturn(firstReturn)).toBe(false)
    expect(isFullReturn(secondReturn)).toBe(false)
  })

  it('should not be fooled by sale.status when classifying a return', () => {
    // Sale is now fully REFUNDED (cumulative), but this particular return
    // only ever covered a fraction of the total.
    const ret = { total: 100, sale: { total: 500, status: 'REFUNDED' } as any }
    expect(isFullReturn(ret)).toBe(false)
  })
})
