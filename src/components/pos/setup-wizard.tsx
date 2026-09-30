'use client'

import type { CSSProperties } from 'react'

// ============================================================
// SETUP WIZARD — Offline SQLite First-Run Setup
// ============================================================
// This component is shown on first launch when
// `system.needsSetup = 'true'` in the local SQLite database.
//
// It forces the user to set a custom admin password before
// login is allowed. This replaces the previous (insecure)
// default password `admin/123456` that was hardcoded in the
// seed function.
//
// Flow:
//   1. The desktop facade checks the local setup flag.
//   2. This wizard collects the initial store/admin settings.
//   3. The desktop API hashes the password and clears the setup flag.
//   4. onComplete() returns the user to the login screen.
// ============================================================

import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Loader2, Lock, Store, Eye, EyeOff, Check, X, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

interface SetupWizardProps {
  onComplete: () => void
}

// ─── Password strength meter ───
function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  let score = 0
  if (pwd.length >= 6) score++
  if (pwd.length >= 10) score++
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++
  if (/\d/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++

  const labels = ['ضعيفة جداً', 'ضعيفة', 'متوسطة', 'جيدة', 'قوية', 'ممتازة']
  const colors = ['#ef4444', '#ef4444', '#f59e0b', '#eab308', '#22c55e', '#16a34a']
  return { score, label: labels[score] || 'ضعيفة', color: colors[score] || '#ef4444' }
}

function Requirement({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {met ? (
        <Check className="w-3.5 h-3.5 text-green-600" />
      ) : (
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      )}
      <span className={met ? 'text-green-700' : 'text-muted-foreground'}>{label}</span>
    </div>
  )
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [storeName, setStoreName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const strength = getPasswordStrength(password)
  const passwordsMatch = password === confirmPassword
  const canSubmit =
    password.length >= 6 &&
    passwordsMatch &&
    storeName.trim().length > 0 &&
    !loading

  const handleSubmit = async () => {
    if (!canSubmit) {
      if (password.length < 6) {
        setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
      } else if (!passwordsMatch) {
        setError('كلمتا المرور غير متطابقتين')
      } else if (!storeName.trim()) {
        setError('اسم المتجر مطلوب')
      }
      return
    }

    setLoading(true)
    setError('')

    try {
      await apiFetch('/setup/complete', {
        method: 'POST',
        body: JSON.stringify({ password, storeName: storeName.trim() }),
      })
      toast.success('تم إعداد النظام بنجاح — يمكنك تسجيل الدخول الآن')
      // Small delay so the toast is visible
      setTimeout(() => onComplete(), 800)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'فشل إعداد النظام'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top_right,_rgba(232,229,164,0.45),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(212,77,92,0.12),_transparent_38%)] bg-background p-4">
      <div className="w-full max-w-lg">
        {/* Logo + title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl overflow-hidden bg-[#F5EFE2] mb-4 shadow-[0_18px_45px_-18px_rgba(119,35,68,0.55)] ring-1 ring-[#772344]/10"><img src="/icon-512.png" alt="Uni Kasher" className="w-full h-full object-cover" draggable={false} /></div>
          <h1 className="text-3xl font-bold tracking-tight">Uni Kasher</h1>
          <p className="text-muted-foreground mt-2">إدارة أعمالك. بسهولة.</p>
        </div>

        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              معالج الإعداد
            </CardTitle>
            <CardDescription>
              أنشئ كلمة مرور المدير واسم متجرك. ستُستخدم كلمة المرور لتسجيل الدخول كـ admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {/* Store name */}
              <div className="space-y-2">
                <Label htmlFor="storeName">
                  <Store className="inline w-4 h-4 ml-1" />
                  اسم المتجر
                </Label>
                <Input
                  id="storeName"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="مثال: متجر الأمل"
                  disabled={loading}
                />
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password">
                  <Lock className="inline w-4 h-4 ml-1" />
                  كلمة مرور المدير
                </Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className="pr-9 pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="6 أحرف على الأقل"
                    disabled={loading}
                    aria-describedby="pwd-strength"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Strength meter */}
                {password.length > 0 && (
                  <div id="pwd-strength" className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Progress
                        value={(strength.score / 5) * 100}
                        className="h-2 flex-1"
                        style={{ '--primary': strength.color } as CSSProperties}
                      />
                      <span className="text-xs font-medium" style={{ color: strength.color }}>
                        {strength.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <Requirement met={password.length >= 6} label="6 أحرف على الأقل" />
                      <Requirement met={password.length >= 10} label="10 أحرف أو أكثر" />
                      <Requirement met={/[A-Z]/.test(password) && /[a-z]/.test(password)} label="حروف كبيرة وصغيرة" />
                      <Requirement met={/\d/.test(password)} label="أرقام" />
                      <Requirement met={/[^A-Za-z0-9]/.test(password)} label="رموز خاصة" />
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">
                  <Lock className="inline w-4 h-4 ml-1" />
                  تأكيد كلمة المرور
                </Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    className={`pr-9 ${confirmPassword && !passwordsMatch ? 'border-destructive' : ''}`}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور"
                    disabled={loading}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  />
                </div>
                {confirmPassword && !passwordsMatch && (
                  <p className="text-xs text-destructive">كلمتا المرور غير متطابقتين</p>
                )}
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm text-center">
                  {error}
                </div>
              )}

              {/* Submit */}
              <Button
                className="w-full h-11"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                    جاري الإعداد...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 ml-2" />
                    إعداد النظام
                  </>
                )}
              </Button>

              {/* Help text */}
              <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                بعد الإعداد، سجّل الدخول بـ: <code className="px-1.5 py-0.5 bg-muted rounded font-mono" dir="ltr">admin</code>
                {' '}وكلمة المرور التي اخترتها.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
