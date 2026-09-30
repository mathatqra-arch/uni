// ============================================================
// ROLE LABELS & COLORS — Single Source of Truth
// ============================================================
// Previously these maps were duplicated across 4 files with
// inconsistent values:
//   - sidebar.tsx used WAREHOUSE='أمين مخزن'
//   - settings.tsx used INVENTORY='أمين مخزن' (wrong key)
//   - employees.tsx used PLATFORM_ADMIN (no longer exists)
//   - platform-admin.tsx used PLATFORM_ADMIN (no longer exists)
//
// This file is the only place to change role display names.
// All modules should import from here.
// ============================================================

import type { UserRole } from './types'

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'مالك',
  ADMIN: 'مدير النظام',
  MANAGER: 'مشرف',
  CASHIER: 'كاشير',
  WAREHOUSE: 'أمين مخزن',
  ACCOUNTANT: 'محاسب',
  PLATFORM: 'مدير المنصة',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  OWNER: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  ADMIN: 'bg-purple-100 text-purple-700 border-purple-200',
  MANAGER: 'bg-blue-100 text-blue-700 border-blue-200',
  CASHIER: 'bg-green-100 text-green-700 border-green-200',
  WAREHOUSE: 'bg-amber-100 text-amber-700 border-amber-200',
  ACCOUNTANT: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  PLATFORM: 'bg-red-100 text-red-700 border-red-200',
}

/** Get the Arabic label for a role. Falls back to the raw role string. */
export function getRoleLabel(role?: string | null): string {
  if (!role) return ''
  return ROLE_LABELS[role as UserRole] || role
}

/** Get the Tailwind color classes for a role badge. Falls back to a neutral style. */
export function getRoleColor(role?: string | null): string {
  if (!role) return 'bg-gray-100 text-gray-700 border-gray-200'
  return ROLE_COLORS[role as UserRole] || 'bg-gray-100 text-gray-700 border-gray-200'
}


/**
 * Desktop permission defaults — one source of truth for user creation and
 * role changes. Explicit custom permissions can still be supplied by the
 * employee-management UI; these are the defaults when none are provided.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly string[]> = {
  OWNER: ['all'],
  ADMIN: ['all'],
  MANAGER: [
    'sale.create', 'sale.refund', 'sale.discount',
    'product.edit', 'inventory.adjust',
    'report.view', 'profit.view', 'accounts.view', 'accounts.post', 'cash.open', 'cash.close',
    'customers.view', 'customers.create', 'customers.edit',
    'loyalty.view', 'loyalty.redeem', 'loyalty.create',
  ],
  CASHIER: [
    'sale.create', 'cash.open', 'cash.close',
    'customers.view', 'customers.create', 'loyalty.view', 'loyalty.redeem',
  ],
  WAREHOUSE: ['product.edit', 'inventory.adjust', 'purchase.create'],
  ACCOUNTANT: ['report.view', 'profit.view', 'accounts.view', 'accounts.post', 'expense.create', 'expense.view'],
  PLATFORM: ['all'],
}

export function getRolePermissions(role?: string | null): string[] {
  if (!role) return ['sale.create']
  return [...(ROLE_PERMISSIONS[role as UserRole] || ROLE_PERMISSIONS.CASHIER)]
}
