import { useAuthStore } from '@/lib/store'
import { sqlErrorMsg } from './sql'

import { logger } from '../logger'
export interface AuthenticatedDesktopUser {
  id: string
  username: string
  role: string
  name: string
  permissions: string[]
}

/**
 * Resolve the active renderer session and immediately re-check it in SQLite.
 * The renderer state tells us who is signed in; SQLite remains authoritative
 * for whether that account is still active and which permissions it has.
 */
export async function getAuthenticatedUser(db): Promise<AuthenticatedDesktopUser | null> {
  const authState = useAuthStore.getState()
  const user = authState.user
  if (!user?.id) return null

  try {
    const rows = await db.select(
      'SELECT id, username, role, name, permissions, active FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [user.id],
    )
    const dbUser = rows[0]
    if (!dbUser || !dbUser.active || dbUser.active === 0 || dbUser.active === 'false') return null

    let permissions: string[] = []
    try {
      const raw = JSON.parse(dbUser.permissions || '[]')
      permissions = Array.isArray(raw)
        ? raw.filter((permission: unknown): permission is string => typeof permission === 'string')
        : []
    } catch {
      // Corrupt permission JSON must fail closed instead of granting access.
      permissions = []
    }

    return {
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      name: dbUser.name,
      permissions,
    }
  } catch (error) {
    logger.warn(`[Desktop Auth] Local user verification failed: ${sqlErrorMsg(error)}`)
    return null
  }
}

export async function requireUser(db): Promise<AuthenticatedDesktopUser> {
  const user = await getAuthenticatedUser(db)
  if (!user) throw new Error('جلسة انتهت — سجّل الدخول مرة أخرى')
  return user
}

export async function requirePermission(db, permission: string): Promise<AuthenticatedDesktopUser> {
  const user = await requireUser(db)
  if (
    user.role === 'OWNER' ||
    user.role === 'ADMIN' ||
    user.permissions.includes('all') ||
    user.permissions.includes(permission)
  ) return user

  throw new Error(`ليس لديك صلاحية: ${permission}`)
}
