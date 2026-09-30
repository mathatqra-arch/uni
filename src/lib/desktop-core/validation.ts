import { z } from 'zod'
import { round2 } from './sql'

const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  // A points-redemption line is intentionally priced by the server at 0.
  pointsRedeemed: z.boolean().optional().default(false),
})

export const createSaleSchema = z.object({
  items: z.array(saleItemSchema).min(1, 'لا توجد أصناف'),
  customerId: z.string().nullable().optional(),
  userId: z.string().optional(), // ignored; authenticated user is authoritative
  discountAmount: z.number().min(0).optional().default(0),
  taxAmount: z.number().min(0).optional().default(0),
  taxExempt: z.boolean().optional().default(false),
  total: z.number().min(0).optional(),
  paidAmount: z.number().min(0).optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'SPLIT']).optional().default('CASH'),
  paymentDetails: z.record(z.string(), z.unknown()).optional().default({}),
  note: z.string().max(500).optional().default(''),
  loyaltyRedeem: z.number().int().min(0).optional().default(0),
  clientTxnId: z.string().optional(),
})

export const refundSchema = z.object({
  items: z.array(z.object({
    saleItemId: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1, 'لا توجد أصناف للإرجاع'),
  reason: z.string().max(500).optional().default('إرجاع'),
  refundMethod: z.enum(['CASH', 'CARD', 'TRANSFER']).optional().default('CASH'),
  userId: z.string().optional(),
  clientTxnId: z.string().optional(),
})

export const expenseSchema = z.object({
  categoryId: z.string().min(1, 'الفئة مطلوبة'),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER']).optional().default('CASH'),
  note: z.string().max(500).optional().default(''),
  date: z.string().optional(),
  userId: z.string().optional(),
  clientTxnId: z.string().optional(),
})

export const cashOpenSchema = z.object({
  openingBalance: z.number().min(0).optional().default(0),
  userId: z.string().optional(),
  clientTxnId: z.string().optional(),
})

export const cashCloseSchema = z.object({
  sessionId: z.string().min(1, 'معرف الجلسة مطلوب'),
  actualCash: z.number().min(0),
  userId: z.string().optional(),
  clientTxnId: z.string().optional(),
})

export const loyaltyRedeemSchema = z.object({
  customerId: z.string().min(1, 'العميل مطلوب'),
  points: z.number().int().positive('النقاط يجب أن تكون أكبر من صفر'),
  note: z.string().max(500).optional().default('استبدال نقاط'),
  clientTxnId: z.string().min(1).optional(),
})
export const loyaltyRefundSchema = loyaltyRedeemSchema

export const assignProductsSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1, 'اختر منتج واحد على الأقل'),
})

/** Keep legacy wholesalePrice accepted during migration; purchaseCost is canonical. */
export const bulkPriceSchema = z.object({
  mode: z.enum(['PERCENT', 'FIXED']),
  value: z.number(),
  field: z.enum(['sellingPrice', 'purchaseCost', 'wholesalePrice', 'both']).optional().default('sellingPrice'),
  includeSubcategories: z.boolean().optional().default(true),
})

export const PURCHASE_PAYMENT_SOURCES = ['CASHBOX', 'OUTSIDE_CASH', 'CARD', 'TRANSFER'] as const

export function normalizePurchasePaymentSource(value: unknown): typeof PURCHASE_PAYMENT_SOURCES[number] {
  const normalized = String(value || 'CASHBOX').toUpperCase()
  if (normalized === 'CASH') return 'CASHBOX'
  if (normalized === 'OUTSIDE' || normalized === 'EXTERNAL_CASH' || normalized === 'OUTSIDE_CASH') return 'OUTSIDE_CASH'
  return (PURCHASE_PAYMENT_SOURCES as readonly string[]).includes(normalized)
    ? normalized as typeof PURCHASE_PAYMENT_SOURCES[number]
    : 'CASHBOX'
}

export function validateFullSalePayment(finalTotal: number, paidAmount: number): number {
  const total = Math.max(0, Number(finalTotal) || 0)
  const paid = Math.max(0, Number(paidAmount) || 0)
  if (paid + 0.01 < total) {
    throw new Error('لا يمكن إتمام البيع بمبلغ أقل من الإجمالي. إمّا سدّد كامل الفاتورة أو استخدم عملية آجل/مديونية مسجلة.')
  }
  return round2(Math.max(0, paid - total))
}

export function zodError(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const field = issue.path.join('.')
    return field ? `${field}: ${issue.message}` : issue.message
  }).join(' | ')
}
