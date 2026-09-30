import { describe, expect, it } from 'vitest'
import { validateFullSalePayment } from '../src/lib/desktop-core/validation'

describe('financial safety rules', () => {
  it('rejects underpayment when no receivable flow exists', () => {
    expect(() => validateFullSalePayment(125, 100)).toThrow()
  })

  it('allows exact payment and returns overpayment change', () => {
    expect(validateFullSalePayment(125, 125)).toBe(0)
    expect(validateFullSalePayment(125, 150)).toBe(25)
  })
})
