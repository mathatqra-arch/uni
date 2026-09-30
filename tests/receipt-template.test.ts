import { describe, expect, it } from 'vitest'
import { buildReceiptHTML } from '@/lib/receipt-template'

describe('receipt template', () => {
  const receipt = {
    invoiceNumber: 'INV-001',
    date: '2026-09-11T20:00:00.000Z',
    cashier: 'مهند',
    customer: null,
    store: {
      name: 'NexFlow POS', address: 'السويس', phone: '01000000000',
      receiptFooter: 'شكرًا لزيارتكم', logo: 'data:image/png;base64,AAAA', showLogo: true, width: '80' as const,
    },
    items: [{ product: { nameAr: 'منتج تجريبي' }, quantity: 1, unitPrice: 100, total: 100 }],
    subtotal: 100, discountAmount: 0, taxAmount: 0, total: 100, paidAmount: 100, changeAmount: 0,
    paymentMethod: 'CASH', loyaltyEarned: 0,
  }

  it('renders saved logo and Alexandria font', () => {
    const html = buildReceiptHTML(receipt)
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain("font-family: 'Alexandria'")
  })

  it('omits logo when receipt.showLogo is false', () => {
    const html = buildReceiptHTML({ ...receipt, store: { ...receipt.store, showLogo: false } })
    expect(html).not.toContain('data:image/png;base64,AAAA')
  })
})
