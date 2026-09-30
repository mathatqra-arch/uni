// ============================================================
// DESKTOP RUNTIME DETECTION
// ============================================================
// Uni Kasher is distributed as a Tauri desktop application. Keeping
// this helper intentionally stays small so legacy runtime routing
// cannot leak back into the desktop product.
// ============================================================

let cachedDesktop: boolean | null = null

/**
 * Returns true when the React shell is running inside Tauri.
 * We check multiple Tauri v2 signals because dev and packaged builds
 * expose slightly different globals/protocol details.
 */
export function isDesktop(): boolean {
  if (cachedDesktop !== null) return cachedDesktop
  if (typeof window === 'undefined') return false

  const win = window as typeof window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
    __TAURI_OS__?: unknown
    __TAURI_INVOKE__?: unknown
  }

  if (win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_OS__) {
    cachedDesktop = true
    return true
  }

  if (typeof win.__TAURI_INVOKE__ === 'function') {
    cachedDesktop = true
    return true
  }

  const { hostname, protocol } = window.location
  // Do not cache a negative result. Tauri's injected internals can become
  // observable a moment after the first renderer tick; caching false would
  // permanently disable the SQLite data layer for the entire app session.
  return hostname === 'tauri.localhost' || protocol === 'tauri:'
}
