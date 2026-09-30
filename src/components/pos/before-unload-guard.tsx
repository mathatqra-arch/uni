'use client'

import { useEffect } from 'react'
import { useCashSessionStore } from '@/lib/store'

// ============================================================
// BEFORE-UNLOAD GUARD — تحذير عند إغلاق التاب/عمل رفرش والخزنة مفتوحة
// ============================================================
// لازم يكون تحقق فوري (sync) لأن المتصفح مش بيستنى أي كود async
// جوه beforeunload، فبنقرأ الحالة المخزّنة أصلاً في useCashSessionStore
// (اللي بتتحدّث أول ما نعرف حالة الخزنة من السيرفر — راجع sidebar.tsx،
// cash.tsx، pos.tsx). لو الخزنة مفتوحة، المتصفح هيعرض تأكيد افتراضي
// (النص المخصص مش بيظهر في كل المتصفحات الحديثة، لكن التحذير نفسه
// بيظهر دايمًا).
// ============================================================

export function BeforeUnloadGuard() {
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      const isRegisterOpen = useCashSessionStore.getState().registerOpen === true
      if (!isRegisterOpen) return
      event.preventDefault()
      // بعض المتصفحات لسه بتحترم returnValue القديم
      event.returnValue = 'الخزنة لسه مفتوحة! لو خرجت دلوقتي من غير ما تقفلها، الرصيد مش هيتحسب. متأكد إنك عايز تكمل؟'
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return null
}
