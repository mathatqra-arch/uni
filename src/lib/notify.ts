'use client'

import { toast } from 'sonner'
import { logger } from './logger'

// ============================================================
// نظام إشعارات الأخطاء المركزي
// ============================================================
// كل الأخطاء في التطبيق (سواء من apiFetch أو desktop-api أو أي
// كود آخر) تمرّ من هنا. الهدف: المستخدم يشوف بوضوح إيه اللي
// حصل ولية — مش مجرد "حدث خطأ" مبهم.
//
// - notifyError()   → إشعار خطأ (أحمر) بعنوان يوضّح نوع المشكلة
//                      ووصف يوضّح التفاصيل الفعلية.
// - notifyWarning()  → إشعار تحذير (أصفر) لمشاكل غير حرجة.
// ============================================================

export type ErrorCategory =
  | 'auth'
  | 'permission'
  | 'network'
  | 'validation'
  | 'sync'
  | 'server'
  | 'unknown'

interface NotifyErrorOptions {
  /** وصف قصير للعملية اللي فشلت، مثال: "حفظ المنتج" أو "إتمام البيع" */
  context?: string
  /** زر "إعادة المحاولة" اختياري */
  retry?: () => void
  /** امنع تكرار نفس الإشعار لو ظهر قبل كده بثواني (مفيد للأخطاء المتكررة أوتوماتيك) */
  id?: string
}

/** يحوّل أي قيمة (Error, string, object غريب...) لرسالة نص مقروءة */
export function extractErrorMessage(error: unknown): string {
  if (!error) return 'حدث خطأ غير معروف'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || 'حدث خطأ غير معروف'
  if (typeof error === 'object') {
    const anyErr = error as Record<string, unknown>
    if (typeof anyErr.message === 'string' && anyErr.message) return anyErr.message
    if (typeof anyErr.error === 'string' && anyErr.error) return anyErr.error
    try {
      const s = JSON.stringify(error)
      if (s && s !== '{}') return s
    } catch {
      /* ignore */
    }
  }
  return 'حدث خطأ غير معروف'
}

/** يحدد نوع الخطأ من نص الرسالة عشان يبين عنوان واضح للمستخدم */
export function categorizeError(message: string): { category: ErrorCategory; title: string } {
  const m = message.toLowerCase()

  if (/جلسة انتهت|انتهت الجلسة|سجّل الدخول|unauthorized|401/.test(message) || /session|auth/.test(m)) {
    return { category: 'auth', title: 'انتهت جلستك' }
  }
  if (/صلاحية|غير مصرح|forbidden|403|ليس لديك/.test(message)) {
    return { category: 'permission', title: 'لا تملك الصلاحية الكافية' }
  }
  if (/لا يمكن الوصول للخادم|فشل الاتصال|تحقق من الإنترنت|network|failed to fetch|fetch failed/.test(m)) {
    return { category: 'network', title: 'مشكلة في الاتصال بالإنترنت' }
  }
  if (/مزامنة|sync/.test(m)) {
    return { category: 'sync', title: 'تعذّرت المزامنة' }
  }
  if (/مطلوب|غير صالح|يجب|مكرر|already exists|duplicate|لا يوجد|غير كافٍ|غير كافي|السعر|الكمية/.test(message)) {
    return { category: 'validation', title: 'تحقق من البيانات المُدخلة' }
  }
  if (/500|الخادم|server error|استجابة غير صالحة/.test(m)) {
    return { category: 'server', title: 'خطأ في الخادم' }
  }
  return { category: 'unknown', title: 'حدث خطأ غير متوقع' }
}

/**
 * يعرض إشعار خطأ واضح للمستخدم: عنوان يوضّح نوع المشكلة + وصف
 * يوضّح التفاصيل الفعلية (بدل ما يظهر الخطأ الخام بس).
 *
 * أمثلة:
 *   notifyError(e, { context: 'حفظ المنتج' })
 *   notifyError(e, { context: 'إتمام عملية البيع', retry: () => submitSale() })
 */
export function notifyError(error: unknown, options: NotifyErrorOptions = {}) {
  const message = extractErrorMessage(error)
  const { title } = categorizeError(message)

  // لا نطبع الـError object نفسه لأنه قد يحتوي على بيانات عميل أو تفاصيل SQL.
  logger.error(`[خطأ]${options.context ? ` ${options.context}:` : ''} ${message}`)

  const heading = options.context ? `تعذّر: ${options.context}` : title
  // لو الرسالة الفعلية مختلفة عن العنوان الفرعي، اعرضها كوصف عشان
  // المستخدم يعرف بالظبط هو عمل إيه غلط (مش مجرد تصنيف عام)
  const description = message && message !== heading ? message : undefined

  toast.error(heading, {
    description: description ? `${title} — ${description}` : title,
    duration: 6000,
    action: options.retry
      ? { label: 'إعادة المحاولة', onClick: options.retry }
      : undefined,
    id: options.id,
  })
}

/** إشعار تحذير (أصفر) — لمشاكل غير حرجة بس المستخدم لازم يعرفها */
export function notifyWarning(message: string, options: { context?: string } = {}) {
  logger.warn(`[تحذير]${options.context ? ` ${options.context}:` : ''} ${message}`)
  toast.warning(options.context ? `${options.context}` : 'تنبيه', {
    description: message,
    duration: 5000,
  })
}
