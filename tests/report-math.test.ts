import { describe, expect, it } from 'vitest'
import {
  calculateNetSaleTotals,
  calculateProfitSummary,
  calculateRefundedBySale,
  calculateDashboardTotals,
} from '@/lib/report-math'

describe('report math', () => {
  it('subtracts partial refund amounts from subtotal, tax and total', () => {
    const sales = [
      { id: 'sale-1', subtotal: 1000, taxAmount: 150, total: 1150, status: 'PARTIAL_REFUND' },
      { id: 'sale-2', subtotal: 500, taxAmount: 75, total: 575, status: 'COMPLETED' },
    ]

    const returns = [
      { saleId: 'sale-1', subtotal: 200, taxAmount: 30, total: 230 },
    ]

    const refundedBySale = calculateRefundedBySale(sales, returns)
    const net1 = calculateNetSaleTotals(sales[0], refundedBySale)
    const net2 = calculateNetSaleTotals(sales[1], refundedBySale)

    expect(net1.subtotal).toBe(800)
    expect(net1.tax).toBe(120)
    expect(net1.total).toBe(920)
    expect(net2.subtotal).toBe(500)
    expect(net2.tax).toBe(75)
    expect(net2.total).toBe(575)
  })

  it('keeps profit revenue before tax and excludes tax from profit', () => {
    const items = [
      { total: 110, taxAmount: 10, costAtSale: 80, quantity: 1 },
      { total: 220, taxAmount: 20, costAtSale: 150, quantity: 1 },
    ]

    const summary = calculateProfitSummary(items)

    expect(summary.revenue).toBe(300)
    expect(summary.tax).toBe(30)
    expect(summary.cost).toBe(230)
    expect(summary.grossProfit).toBe(70)
    expect(summary.marginPercent).toBeCloseTo(23.33, 2)
  })

  it('excludes fully refunded sales and nets partial refunds for dashboard totals', () => {
    const sales = [
      { id: 'sale-1', subtotal: 1000, taxAmount: 150, total: 1150, status: 'COMPLETED' },
      { id: 'sale-2', subtotal: 500, taxAmount: 75, total: 575, status: 'REFUNDED' },
      { id: 'sale-3', subtotal: 800, taxAmount: 120, total: 920, status: 'PARTIAL_REFUND' },
    ]

    const returns = [
      { saleId: 'sale-3', subtotal: 200, taxAmount: 30, total: 230 },
    ]

    const summary = calculateDashboardTotals(sales, returns)

    expect(summary.count).toBe(2)
    expect(summary.subtotal).toBe(1600)
    expect(summary.tax).toBe(240)
    expect(summary.total).toBe(1840)
  })
})
