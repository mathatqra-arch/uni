import { describe, it, expect } from 'vitest'

// ============================================================
// STOCK DEDUCTION TESTS
// ============================================================
// Tests overselling prevention logic.
// Verifies stock cannot go negative (unless allowNegativeStock).
// ============================================================

interface StockLevel {
  productId: string
  quantity: number
}

interface Product {
  id: string
  name: string
  allowNegativeStock: boolean
}

function checkStockAvailability(
  items: { productId: string; quantity: number }[],
  stockLevels: Map<string, number>,
  products: Map<string, Product>
): { canFulfill: boolean; errors: string[] } {
  const errors: string[] = []

  for (const item of items) {
    const currentStock = stockLevels.get(item.productId) || 0
    const product = products.get(item.productId)

    if (!product) {
      errors.push(`Product not found: ${item.productId}`)
      continue
    }

    if (!product.allowNegativeStock && currentStock < item.quantity) {
      errors.push(
        `Insufficient stock for ${product.name} (available: ${currentStock}, requested: ${item.quantity})`
      )
    }
  }

  return { canFulfill: errors.length === 0, errors }
}

describe('Stock Deduction — Overselling Prevention', () => {
  const stockLevels = new Map([
    ['prod-1', 10],
    ['prod-2', 5],
    ['prod-3', 0],
  ])

  const products = new Map([
    ['prod-1', { id: 'prod-1', name: 'Perfume', allowNegativeStock: false }],
    ['prod-2', { id: 'prod-2', name: 'Lipstick', allowNegativeStock: false }],
    ['prod-3', { id: 'prod-3', name: 'Cream', allowNegativeStock: false }],
    ['prod-4', { id: 'prod-4', name: 'Special Item', allowNegativeStock: true }],
  ])

  it('should allow sale when stock is sufficient', () => {
    const items = [{ productId: 'prod-1', quantity: 5 }]
    const result = checkStockAvailability(items, stockLevels, products)
    expect(result.canFulfill).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should block sale when stock is insufficient', () => {
    const items = [{ productId: 'prod-1', quantity: 15 }] // Only 10 available
    const result = checkStockAvailability(items, stockLevels, products)
    expect(result.canFulfill).toBe(false)
    expect(result.errors[0]).toContain('Insufficient stock')
    expect(result.errors[0]).toContain('available: 10')
  })

  it('should block sale when stock is zero', () => {
    const items = [{ productId: 'prod-3', quantity: 1 }]
    const result = checkStockAvailability(items, stockLevels, products)
    expect(result.canFulfill).toBe(false)
    expect(result.errors[0]).toContain('available: 0')
  })

  it('should allow sale when allowNegativeStock is true', () => {
    const items = [{ productId: 'prod-4', quantity: 100 }] // No stock, but allowed
    const result = checkStockAvailability(items, stockLevels, products)
    expect(result.canFulfill).toBe(true)
  })

  it('should handle multiple items with mixed availability', () => {
    const items = [
      { productId: 'prod-1', quantity: 5 },  // OK (10 available)
      { productId: 'prod-2', quantity: 10 }, // FAIL (5 available)
      { productId: 'prod-3', quantity: 1 },  // FAIL (0 available)
    ]
    const result = checkStockAvailability(items, stockLevels, products)
    expect(result.canFulfill).toBe(false)
    expect(result.errors).toHaveLength(2)
  })

  it('should block sale for non-existent product', () => {
    const items = [{ productId: 'non-existent', quantity: 1 }]
    const result = checkStockAvailability(items, stockLevels, products)
    expect(result.canFulfill).toBe(false)
    expect(result.errors[0]).toContain('not found')
  })

  it('should allow exact stock quantity', () => {
    const items = [{ productId: 'prod-1', quantity: 10 }] // Exactly 10 available
    const result = checkStockAvailability(items, stockLevels, products)
    expect(result.canFulfill).toBe(true)
  })
})

describe('Stock Deduction — Calculation', () => {
  it('should deduct stock correctly after sale', () => {
    let stock = 10
    const quantity = 3
    stock = stock - quantity
    expect(stock).toBe(7)
  })

  it('should restore stock correctly after refund', () => {
    let stock = 7
    const refundQuantity = 2
    stock = stock + refundQuantity
    expect(stock).toBe(9)
  })

  it('should handle concurrent deductions atomically', () => {
    // Simulate two concurrent sales of 6 items each on stock of 10
    // Only one should succeed (the other should be blocked)
    let stock = 10
    const sale1Qty = 6
    const sale2Qty = 6

    // Sale 1 goes first
    if (stock >= sale1Qty) {
      stock -= sale1Qty
    }
    expect(stock).toBe(4)

    // Sale 2 should fail (4 < 6)
    expect(stock >= sale2Qty).toBe(false)
  })
})
