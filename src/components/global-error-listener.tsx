'use client'

import { useEffect, useRef } from 'react'
import { notifyError } from '@/lib/notify'

// ============================================================
// GLOBAL ERROR LISTENER
// ============================================================
// يلقط أي خطأ ما اتمسكش بـ try/catch (مثلاً خطأ جوه promise
// مش متابع، أو خطأ async مش متوقع) ويعرض إشعار للمستخدم بدل
// ما يفضل الخطأ صامت في الكونسول بس.
//
// ملحوظة: أخطاء الـ render بتتلقط بمعرفة <ErrorBoundary /> في
// layout.tsx، مش هنا — الاتنين مكملين بعض.
// ============================================================

// شوية رسائل معروفة إنها ضوضاء (browser quirks) مش لازم تتعرض للمستخدم
const IGNORED_PATTERNS = [
  'ResizeObserver loop',
  'Non-Error promise rejection captured',
  'Script error.',
]

function isIgnored(message: string) {
  return IGNORED_PATTERNS.some((p) => message.includes(p))
}

export function GlobalErrorListener() {
  // منع إظهار نفس الخطأ عدة مرات خلال ثانية واحدة (لو حصل في لوب مثلاً)
  const lastShownRef = useRef<{ message: string; at: number } | null>(null)

  useEffect(() => {
    function shouldShow(message: string) {
      if (isIgnored(message)) return false
      const now = Date.now()
      const last = lastShownRef.current
      if (last && last.message === message && now - last.at < 3000) return false
      lastShownRef.current = { message, at: now }
      return true
    }

    function handleWindowError(event: ErrorEvent) {
      const message = event.error?.message || event.message || 'حدث خطأ غير متوقع'
      if (!shouldShow(message)) return
      notifyError(event.error || message, { context: 'خطأ في التطبيق' })
    }

    function handleRejection(event: PromiseRejectionEvent) {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === 'string'
            ? event.reason
            : 'حدث خطأ غير متوقع'
      if (!shouldShow(message)) return
      notifyError(event.reason, { context: 'خطأ في التطبيق' })
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  return null
}
