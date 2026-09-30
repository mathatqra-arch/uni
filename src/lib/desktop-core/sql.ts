/**
 * Shared SQLite helpers for the desktop data layer.
 *
 * These functions are deliberately infrastructure-only: they know how to
 * format SQLite statements safely and run an atomic batch, but they do not
 * know anything about sales, cash, products, or accounting rules.
 */

import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '../desktop-mode'

export function sqlErrorMsg(error: unknown): string {
  if (!error) return 'unknown SQL error'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  const text = String(error)
  return text && text !== '[object Object]' ? text : 'unknown SQL error'
}

/** Escape one value for use in an atomic multi-statement SQLite batch. */
export function sqlEsc(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0'
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

export function sqlVals(values: unknown[]): string {
  return `(${values.map(sqlEsc).join(', ')})`
}

/** Round monetary values to piastres so UI totals and stored totals agree. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Run related writes as one SQL batch.
 *
 * tauri-plugin-sql may use pooled connections, so BEGIN/COMMIT calls split
 * across multiple execute() calls are unsafe. Keeping the whole transaction
 * in one execute() gives us one atomic batch and the rollback below prevents
 * a failed operation from leaving the connection inside a transaction.
 */
export async function atomicExec(db, statements: string[]): Promise<void> {
  if (statements.length === 0) return

  // In the packaged desktop app, execute the entire transaction through the
  // Rust command so BEGIN/COMMIT/ROLLBACK all live on one concrete SQLite
  // connection. This is the definitive fix for pooled-connection transaction
  // leakage (`cannot start a transaction within a transaction`).
  if (isDesktop()) {
    await invoke('execute_sqlite_transaction', { statements })
    return
  }

  // Browser/unit-test fallback: keep the previous one-batch behaviour. It is
  // never used by the packaged desktop runtime because isDesktop() is true.
  const body = statements.map((statement) => statement.trim().replace(/;$/, '')).join(';\n')
  await db.execute(`BEGIN IMMEDIATE;\n${body};\nCOMMIT;`)
}

/**
 * Upsert a record by its primary key, optionally reconciling a second unique
 * identity such as SKU or customer phone during sync.
 */
export async function upsert(
  db: { execute: (sql: string, values?: unknown[]) => Promise<void> },
  table: string,
  columns: string[],
  values: unknown[],
  secondaryConflictCol?: string,
): Promise<void> {
  const updateCols = columns.filter((column) => column !== 'id')
  const primarySet = updateCols.length
    ? `DO UPDATE SET ${updateCols.map((column) => `${column} = excluded.${column}`).join(', ')}`
    : 'DO NOTHING'

  let sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(id) ${primarySet}`

  if (secondaryConflictCol && columns.includes(secondaryConflictCol)) {
    const secondaryUpdateCols = columns.filter((column) => column !== secondaryConflictCol)
    const secondarySet = secondaryUpdateCols.length
      ? `DO UPDATE SET ${secondaryUpdateCols.map((column) => `${column} = excluded.${column}`).join(', ')}`
      : 'DO NOTHING'
    sql += `\n     ON CONFLICT(${secondaryConflictCol}) ${secondarySet}`
  }

  await db.execute(sql, values)
}
