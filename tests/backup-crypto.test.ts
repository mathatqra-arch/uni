import { describe, expect, it } from 'vitest'
import { encryptBackup, decryptBackup } from '@/lib/backup-crypto'

describe('backup encryption', () => {
  it('round-trips a snapshot and rejects the wrong password', async () => {
    const snapshot = { format: 'nexflow-backup', version: 3, tables: { products: [{ id: 'p1', name: 'Test' }] } }
    const encrypted = await encryptBackup(snapshot, 'correct horse battery')
    await expect(decryptBackup(encrypted, 'correct horse battery')).resolves.toEqual(snapshot)
    await expect(decryptBackup(encrypted, 'wrong password')).rejects.toThrow()
  })

  it('requires a reasonable backup password length', async () => {
    await expect(encryptBackup({}, '1234567')).rejects.toThrow()
  })
})
