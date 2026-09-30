import { describe, expect, it } from 'vitest'
import { autoJournalStatements } from '@/lib/desktop-core/accounting'

describe('automatic ledger builder', () => {
  it('rejects an unbalanced journal before SQL execution', () => {
    expect(() => autoJournalStatements({
      entryId: 'e1', clientTxnId: 't1', entryNo: 'E-1', entryDate: '2026-09-12T00:00:00Z',
      description: 'test', referenceType: 'Test', referenceId: 'r1', userId: 'u1',
      lines: [{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 90 }],
    })).toThrow()
  })

  it('builds balanced journal SQL', () => {
    const sql = autoJournalStatements({
      entryId: 'e1', clientTxnId: 't1', entryNo: 'E-1', entryDate: '2026-09-12T00:00:00Z',
      description: 'test', referenceType: 'Test', referenceId: 'r1', userId: 'u1',
      lines: [{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 100 }],
    })
    expect(sql).toHaveLength(3)
  })
})
