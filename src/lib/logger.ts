/**
 * Tiny production-safe logger.
 * Debug/info output is development-only so the shipped desktop build does not
 * expose SQL, payloads, or internal state in DevTools. Errors/warnings retain
 * a short, human-readable message for local diagnostics without dumping raw
 * objects that may contain customer or transaction data.
 */
export const logger = {
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.debug(...args)
  },
  info: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.info(...args)
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn(...args)
  },
  error: (message: string) => {
    console.error(message)
  },
}
