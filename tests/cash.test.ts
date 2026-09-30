import { describe, it, expect } from 'vitest'
import { calculateExpectedCash } from '@/lib/cash-utils'

interface CashSession {
  id: string
  userId: string
  status: 'OPEN' | 'CLOSED'
  openingBalance: number
  movements: Array<{ type: string; amount: number }>
}

function hasOpenSession(sessions: CashSession[], userId: string): boolean {
  return sessions.some((s) => s.userId === userId && s.status === 'OPEN')
}

describe('Cash Session — Open', () => {
  it('should allow opening when no open session exists', () => {
    expect(hasOpenSession([], 'user-1')).toBe(false)
  })

  it('should block opening when open session exists', () => {
    expect(hasOpenSession([
      { id: 's1', userId: 'user-1', status: 'OPEN', openingBalance: 100, movements: [] },
    ], 'user-1')).toBe(true)
  })

  it('should allow reopening after close', () => {
    expect(hasOpenSession([
      { id: 's1', userId: 'user-1', status: 'CLOSED', openingBalance: 100, movements: [] },
    ], 'user-1')).toBe(false)
  })
})

describe('Cash Session — Expected Cash Calculation', () => {
  it('must not double-count the opening movement', () => {
    expect(calculateExpectedCash(500, [{ type: 'OPENING', amount: 500 }])).toBe(500)
  })

  it('adds sales and cash-in', () => {
    expect(calculateExpectedCash(200, [
      { type: 'OPENING', amount: 200 },
      { type: 'SALE', amount: 150 },
      { type: 'CASH_IN', amount: 25 },
    ])).toBe(375)
  })

  it('subtracts cash-out and expenses', () => {
    expect(calculateExpectedCash(300, [
      { type: 'OPENING', amount: 300 },
      { type: 'SALE', amount: 100 },
      { type: 'CASH_OUT', amount: 50 },
      { type: 'EXPENSE', amount: 25 },
    ])).toBe(325)
  })

  it('subtracts refunds regardless of stored sign', () => {
    expect(calculateExpectedCash(300, [
      { type: 'SALE', amount: 100 },
      { type: 'REFUND', amount: -40 },
    ])).toBe(360)
    expect(calculateExpectedCash(300, [
      { type: 'SALE', amount: 100 },
      { type: 'REFUND', amount: 40 },
    ])).toBe(360)
  })

  it('uses positive refund magnitude as the canonical stored representation', () => {
    expect(calculateExpectedCash(500, [
      { type: 'REFUND', amount: 75 },
    ])).toBe(425)
  })

  it('allows a zero opening/closing amount without affecting expected cash', () => {
    expect(calculateExpectedCash(0, [
      { type: 'OPENING', amount: 0 },
      { type: 'CLOSING', amount: 0 },
    ])).toBe(0)
  })

  it('ignores the closing movement', () => {
    expect(calculateExpectedCash(100, [
      { type: 'SALE', amount: 200 },
      { type: 'CLOSING', amount: 300 },
    ])).toBe(300)
  })
})

describe('Cash Session — Close', () => {
  it('calculates the difference from actual cash', () => {
    const expected = calculateExpectedCash(100, [
      { type: 'SALE', amount: 200 },
      { type: 'CASH_OUT', amount: 50 },
    ])
    const actual = 240
    expect(actual - expected).toBe(-10)
  })
})

describe('Cash Session — Non-negative floor', () => {
  it('must never calculate a negative expected balance', () => {
    expect(calculateExpectedCash(100, [{ type: 'CASH_OUT', amount: 150 }])).toBe(0)
  })

  it('can reach exactly zero', () => {
    expect(calculateExpectedCash(100, [{ type: 'CASH_OUT', amount: 100 }])).toBe(0)
  })
})
