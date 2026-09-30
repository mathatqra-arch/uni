/**
 * Desktop API facade.
 *
 * React screens call apiFetch() so they do not know whether an operation is
 * GET/POST/PUT/DELETE internally. The facade resolves every operation to the
 * local SQLite-backed desktop API. There is intentionally one data path:
 * the Tauri renderer talks to the local SQLite orchestrator.
 */

import { desktopApiFetch } from './desktop-api'

export async function apiFetch(path: string, options: RequestInit = {}) {
  try {
    return await desktopApiFetch(path, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'حدث خطأ غير معروف')
    throw new Error(message)
  }
}

export function formatEGP(amount: number | undefined | null): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0) + ' ج.م'
}

export function formatNumber(num: number | undefined | null): string {
  return new Intl.NumberFormat('ar-EG').format(num || 0)
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(d)
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d)
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('ar-EG', {
    hour: '2-digit', minute: '2-digit',
  }).format(d)
}
