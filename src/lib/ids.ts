/**
 * ID generation for the desktop app.
 *
 * Keep UUID creation separate from persistence. The old implementation lived
 * inside the browser/Dexie database module, which made a tiny pure helper
 * depend on a second database stack. Desktop code now uses SQLite as its
 * single source of truth, so ID generation has no database dependency.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}
