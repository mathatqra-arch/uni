export type RefundEntry = {
  saleId: string
  subtotal?: number
  taxAmount?: number
  total?: number
}

export type NetSale = {
  subtotal: number
  tax: number
  total: number
}

export function calculateRefundedBySale(
  sales: Array<{ id: string; status?: string }> = [],
  returns: RefundEntry[] = []
): Map<string, { total: number; tax: number; subtotal: number }> {
  const refundedBySale = new Map<string, { total: number; tax: number; subtotal: number }>()
  const partialIds = sales.filter((s) => s.status === 'PARTIAL_REFUND').map((s) => s.id)

  if (partialIds.length === 0) return refundedBySale

  for (const r of returns) {
    if (!partialIds.includes(r.saleId)) continue
    const acc = refundedBySale.get(r.saleId) || { total: 0, tax: 0, subtotal: 0 }
    acc.total += Number(r.total || 0)
    acc.tax += Number(r.taxAmount || 0)
    acc.subtotal += Number(r.subtotal ?? (Number(r.total || 0) - Number(r.taxAmount || 0)))
    refundedBySale.set(r.saleId, acc)
  }

  return refundedBySale
}

export function calculateNetSaleTotals(
  sale: { id: string; subtotal: number; taxAmount: number; total: number; status?: string },
  refundedBySale: Map<string, { total: number; tax: number; subtotal: number }>
): NetSale {
  const refunded = refundedBySale.get(sale.id) || { total: 0, tax: 0, subtotal: 0 }
  return {
    subtotal: Math.max(0, Number(sale.subtotal || 0) - Number(refunded.subtotal || 0)),
    tax: Math.max(0, Number(sale.taxAmount || 0) - Number(refunded.tax || 0)),
    total: Math.max(0, Number(sale.total || 0) - Number(refunded.total || 0)),
  }
}

export function calculateProfitSummary(items: Array<{ total: number; taxAmount: number; costAtSale: number; quantity: number }>) {
  const revenue = Number(items.reduce((sum, it) => sum + (Number(it.total || 0) - Number(it.taxAmount || 0)), 0).toFixed(2))
  const tax = Number(items.reduce((sum, it) => sum + Number(it.taxAmount || 0), 0).toFixed(2))
  const cost = Number(items.reduce((sum, it) => sum + Number(it.costAtSale || 0) * Number(it.quantity || 0), 0).toFixed(2))
  const grossProfit = Number((revenue - cost).toFixed(2))
  const marginPercent = revenue > 0 ? Number(((grossProfit / revenue) * 100).toFixed(2)) : 0

  return { revenue, tax, cost, grossProfit, marginPercent }
}

export function calculateDashboardTotals(
  sales: Array<{ id: string; subtotal: number; taxAmount: number; total: number; status?: string; held?: boolean }> = [],
  returns: RefundEntry[] = []
): { count: number; subtotal: number; tax: number; total: number } {
  const activeSales = sales.filter((sale) => sale && sale.status !== 'REFUNDED' && sale.held !== true)
  const refundedBySale = calculateRefundedBySale(activeSales, returns)

  const totals = activeSales.reduce(
    (acc, sale) => {
      const net = calculateNetSaleTotals(sale, refundedBySale)
      acc.subtotal += net.subtotal
      acc.tax += net.tax
      acc.total += net.total
      return acc
    },
    { subtotal: 0, tax: 0, total: 0 }
  )

  return {
    count: activeSales.length,
    subtotal: Number(totals.subtotal.toFixed(2)),
    tax: Number(totals.tax.toFixed(2)),
    total: Number(totals.total.toFixed(2)),
  }
}
