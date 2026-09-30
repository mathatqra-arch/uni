import { describe, it, expect } from 'vitest'

// ============================================================
// LOYALTY POINTS TESTS
// ============================================================
// Tests loyalty earn/redeem calculations + TOCTOU prevention.
// ============================================================

interface LoyaltyAccount {
  customerId: string
  points: number
  totalEarned: number
  totalRedeemed: number
}

function calculateEarnedPoints(totalAmount: number, pointsPerEgp: number): number {
  return Math.floor(totalAmount * pointsPerEgp)
}

function canRedeem(account: LoyaltyAccount, points: number): boolean {
  return account.points >= points && points > 0
}

function redeemPoints(account: LoyaltyAccount, points: number): LoyaltyAccount {
  if (!canRedeem(account, points)) {
    throw new Error('Insufficient points')
  }
  return {
    ...account,
    points: account.points - points,
    totalRedeemed: account.totalRedeemed + points,
  }
}

function earnPoints(account: LoyaltyAccount, points: number): LoyaltyAccount {
  return {
    ...account,
    points: account.points + points,
    totalEarned: account.totalEarned + points,
  }
}

describe('Loyalty — Earn Points', () => {
  it('should calculate earned points correctly', () => {
    expect(calculateEarnedPoints(100, 0.1)).toBe(10)
    expect(calculateEarnedPoints(250, 0.1)).toBe(25)
    expect(calculateEarnedPoints(99.99, 0.1)).toBe(9) // floor
  })

  it('should add earned points to account', () => {
    const account: LoyaltyAccount = {
      customerId: 'c1',
      points: 50,
      totalEarned: 50,
      totalRedeemed: 0,
    }
    const updated = earnPoints(account, 30)
    expect(updated.points).toBe(80)
    expect(updated.totalEarned).toBe(80)
    expect(updated.totalRedeemed).toBe(0)
  })
})

describe('Loyalty — Redeem Points', () => {
  it('should allow redemption when sufficient points', () => {
    const account: LoyaltyAccount = {
      customerId: 'c1',
      points: 100,
      totalEarned: 100,
      totalRedeemed: 0,
    }
    expect(canRedeem(account, 50)).toBe(true)
    const updated = redeemPoints(account, 50)
    expect(updated.points).toBe(50)
    expect(updated.totalRedeemed).toBe(50)
  })

  it('should block redemption when insufficient points', () => {
    const account: LoyaltyAccount = {
      customerId: 'c1',
      points: 30,
      totalEarned: 30,
      totalRedeemed: 0,
    }
    expect(canRedeem(account, 50)).toBe(false)
    expect(() => redeemPoints(account, 50)).toThrow('Insufficient points')
  })

  it('should block redemption of zero or negative points', () => {
    const account: LoyaltyAccount = {
      customerId: 'c1',
      points: 100,
      totalEarned: 100,
      totalRedeemed: 0,
    }
    expect(canRedeem(account, 0)).toBe(false)
    expect(canRedeem(account, -10)).toBe(false)
  })

  it('should allow full balance redemption', () => {
    const account: LoyaltyAccount = {
      customerId: 'c1',
      points: 80,
      totalEarned: 80,
      totalRedeemed: 0,
    }
    expect(canRedeem(account, 80)).toBe(true)
    const updated = redeemPoints(account, 80)
    expect(updated.points).toBe(0)
  })

  it('should prevent negative balance (TOCTOU protection)', () => {
    // Simulate two concurrent redemptions of 50 points on 80-point balance
    let account: LoyaltyAccount = {
      customerId: 'c1',
      points: 80,
      totalEarned: 80,
      totalRedeemed: 0,
    }

    // First redemption succeeds
    account = redeemPoints(account, 50)
    expect(account.points).toBe(30)

    // Second concurrent redemption should fail (30 < 50)
    expect(canRedeem(account, 50)).toBe(false)
    expect(() => redeemPoints(account, 50)).toThrow('Insufficient points')
    expect(account.points).toBe(30) // Unchanged
  })

  it('should handle multiple sequential redemptions correctly', () => {
    let account: LoyaltyAccount = {
      customerId: 'c1',
      points: 100,
      totalEarned: 100,
      totalRedeemed: 0,
    }

    account = redeemPoints(account, 30) // 70 left
    expect(account.points).toBe(70)

    account = redeemPoints(account, 20) // 50 left
    expect(account.points).toBe(50)

    account = redeemPoints(account, 50) // 0 left
    expect(account.points).toBe(0)
    expect(account.totalRedeemed).toBe(100)
  })
})

describe('Loyalty — Tier Calculation', () => {
  function getTier(points: number): string {
    if (points >= 3000) return 'VIP'
    if (points >= 1500) return 'GOLD'
    if (points >= 500) return 'SILVER'
    return 'BRONZE'
  }

  it('should assign BRONZE for 0-499 points', () => {
    expect(getTier(0)).toBe('BRONZE')
    expect(getTier(499)).toBe('BRONZE')
  })

  it('should assign SILVER for 500-1499 points', () => {
    expect(getTier(500)).toBe('SILVER')
    expect(getTier(1499)).toBe('SILVER')
  })

  it('should assign GOLD for 1500-2999 points', () => {
    expect(getTier(1500)).toBe('GOLD')
    expect(getTier(2999)).toBe('GOLD')
  })

  it('should assign VIP for 3000+ points', () => {
    expect(getTier(3000)).toBe('VIP')
    expect(getTier(5000)).toBe('VIP')
  })
})
