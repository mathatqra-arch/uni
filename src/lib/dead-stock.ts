export type DeadStockSource = 'product' | 'subcategory' | 'category' | 'general'

export function normalizeDeadStockDays(value: unknown, fallback = 60): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return Math.min(3650, Math.max(1, Math.floor(fallback)))
  return Math.min(3650, Math.max(1, Math.floor(n)))
}

export function resolveDeadStockDays(
  productOverride: unknown,
  subcategoryOverride: unknown,
  categoryOverride: unknown,
  generalDays: unknown,
): { days: number; source: DeadStockSource } {
  const general = normalizeDeadStockDays(generalDays, 60)
  const product = Number(productOverride)
  if (Number.isFinite(product) && product >= 1) return { days: Math.min(3650, Math.floor(product)), source: 'product' }
  const sub = Number(subcategoryOverride)
  if (Number.isFinite(sub) && sub >= 1) return { days: Math.min(3650, Math.floor(sub)), source: 'subcategory' }
  const category = Number(categoryOverride)
  if (Number.isFinite(category) && category >= 1) return { days: Math.min(3650, Math.floor(category)), source: 'category' }
  return { days: general, source: 'general' }
}

export function isDeadStock(lastActivityAt: string | Date | null | undefined, nowMs: number, thresholdDays: number): boolean {
  const threshold = normalizeDeadStockDays(thresholdDays, 60)
  if (!lastActivityAt) return false
  const activityMs = typeof lastActivityAt === 'string' ? new Date(lastActivityAt).getTime() : lastActivityAt.getTime()
  if (!Number.isFinite(activityMs)) return false
  return nowMs - activityMs >= threshold * 86400000
}
