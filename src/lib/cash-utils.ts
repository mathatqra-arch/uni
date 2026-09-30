export type CashMovementType =
  | 'OPENING'
  | 'CLOSING'
  | 'SALE'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'EXPENSE'
  | 'REFUND'

export interface CashMovementLike {
  type: CashMovementType | string
  amount: number | string | null | undefined
}

/**
 * Calculate the cash physically expected in the drawer.
 *
 * `cash_sessions.opening_balance` is the authoritative opening amount.
 * The OPENING movement is an audit/display record of that same amount and
 * MUST NOT be added a second time. CLOSING is also informational and must
 * never affect the expected balance.
 *
 * Cash movement amounts are canonical positive magnitudes; abs() is retained
 * defensively for legacy rows so malformed historical signs cannot invert
 * the drawer calculation.
 */
export function calculateExpectedCash(
  openingBalance: number | string | null | undefined,
  movements: CashMovementLike[],
): number {
  const opening = Math.max(0, Number(openingBalance) || 0)

  const expected = movements.reduce((sum, movement) => {
    const amount = Math.abs(Number(movement.amount) || 0)
    switch (movement.type) {
      case 'SALE':
      case 'CASH_IN':
        return sum + amount
      case 'CASH_OUT':
      case 'EXPENSE':
      case 'REFUND':
        return sum - amount
      case 'OPENING':
      case 'CLOSING':
      default:
        return sum
    }
  }, opening)

  // A cash drawer must never report a negative expected balance.
  // Invalid historical rows are clamped at the accounting boundary rather
  // than allowing a negative balance to leak into the UI/reconciliation.
  return Math.max(0, Math.round((expected + Number.EPSILON) * 100) / 100)
}
