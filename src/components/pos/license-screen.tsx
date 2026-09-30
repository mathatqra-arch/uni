'use client'

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Copy, KeyRound, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type LicenseStatus = {
  licensed: boolean
  expired: boolean
  reason: string
  license_type?: string | null
  expires_at?: number | null
  days_remaining?: number | null
  seconds_remaining?: number | null
  device_id: string
}

type Props = {
  onActivated: () => void
}

export function LicenseScreen({ onActivated }: Props) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [copied, setCopied] = useState(false)

  const check = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await invoke<LicenseStatus>('license_status')
      setStatus(result)
      if (result.licensed) onActivated()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void check()
  }, [])

  const activate = async () => {
    if (!code.trim()) {
      setError('أدخل كود الترخيص أولاً')
      return
    }
    setActivating(true)
    setError('')
    try {
      const result = await invoke<LicenseStatus>('activate_license', { code: code.trim() })
      setStatus(result)
      onActivated()
    } catch (e) {
      setError(String(e))
    } finally {
      setActivating(false)
    }
  }

  const copyDevice = async () => {
    if (!status?.device_id) return
    await navigator.clipboard.writeText(status.device_id)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (loading && !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" dir="rtl">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="uk-auth-scene min-h-screen flex items-center justify-center p-6" dir="rtl">
      <Card className="w-full max-w-lg shadow-xl uk-release-state animate-fade-in-up">
        <CardHeader className="text-center">
          <div className="uk-logo-glow mx-auto mb-3 h-16 w-16 overflow-hidden rounded-2xl bg-[#F5EFE2] ring-1 ring-[#E8E5A4]/30"><img src="/icon-512.png" alt="Uni Kasher" className="h-full w-full object-cover" draggable={false} /></div>
          <CardTitle className="text-2xl text-[#160029]">تفعيل Uni Kasher</CardTitle>
          <CardDescription>
            النسخة محمية بترخيص رقمي مرتبط بالجهاز. التفعيل يتم مرة واحدة ويمكن للبرنامج العمل بدون إنترنت بعده.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-medium">معرّف الجهاز</p>
            <div className="flex gap-2">
              <Input value={status?.device_id || ''} readOnly dir="ltr" className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyDevice} title="نسخ معرّف الجهاز">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              ابعت المعرّف ده لك، وبعدها أنشئ كود الترخيص لهذا الجهاز من License Generator.
            </p>
            {copied && <p className="mt-1 text-xs text-primary">تم النسخ ✓</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">كود الترخيص</label>
            <div className="flex gap-2">
              <KeyRound className="mt-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="UNIKASHER1...."
                dir="ltr"
                className="font-mono text-xs"
                onKeyDown={e => { if (e.key === 'Enter') void activate() }}
              />
            </div>
          </div>

          {status?.reason && status.reason !== 'no_license' && !status.licensed && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {status.reason}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button className="w-full" onClick={() => void activate()} disabled={activating}>
            {activating ? 'جاري التحقق...' : 'تفعيل البرنامج'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            لو الترخيص منتهي أو الجهاز اتغير، لازم إصدار كود جديد مرتبط بالجهاز الحالي.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
