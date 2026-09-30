'use client'

import { useAuthStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Lock, LogOut, AlertTriangle } from 'lucide-react'

export function SystemLockedScreen({ reason, userName }: { reason: string; userName: string }) {
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="min-h-screen flex items-center justify-center bg-destructive/5 p-4">
      <Card className="max-w-md w-full shadow-xl border-destructive/30">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <Lock className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold mb-2">النظام مقفل</h1>
          <p className="text-muted-foreground mb-4">
            عذراً {userName}، تم قفل النظام مؤقتاً من قبل مدير المنصة
          </p>

          {reason && (
            <div className="bg-amber-500/10 rounded-lg p-3 mb-6 flex items-start gap-2 text-right">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700">سبب القفل:</p>
                <p className="text-sm text-muted-foreground">{reason}</p>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground mb-6">
            لا يمكن إجراء عمليات البيع حالياً. يرجى المحاولة لاحقاً أو التواصل مع الإدارة.
          </p>

          <Button variant="outline" className="w-full" onClick={logout}>
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل الخروج
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
