'use client'

import { useState } from 'react'
import { useAuthStore } from '@/lib/store'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Eye, EyeOff, Loader2, Lock, User } from 'lucide-react'
import { toast } from 'sonner'

export function LoginScreen() {
  // Credentials are intentionally blank on every login screen load.
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)

  const [errorMsg, setErrorMsg] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    setErrorMsg('')

    if (!username.trim()) {
      setErrorMsg('ادخل اسم المستخدم')
      setLoading(false)
      return
    }
    if (!password.trim()) {
      setErrorMsg('ادخل كلمة المرور')
      setLoading(false)
      return
    }

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      login(data.user, data.token)
      toast.success(`مرحباً ${data.user.name}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'حدث خطأ'
      setErrorMsg(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="uk-auth-scene min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="uk-logo-glow inline-flex items-center justify-center w-20 h-20 rounded-3xl overflow-hidden bg-[#F5EFE2] mb-5 ring-1 ring-[#E8E5A4]/30"><img src="/icon-512.png" alt="Uni Kasher" className="w-full h-full object-cover" draggable={false} /></div>
          <h1 className="auth-brand-title text-4xl font-extrabold tracking-tight">Uni Kasher</h1>
          <p className="auth-brand-sub mt-2">إدارة أعمالك. بسهولة.</p>
        </div>

        <Card className="login-surface shadow-xl uk-release-state animate-fade-in-up">
          <CardHeader>
            <CardTitle className="text-center">تسجيل الدخول</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleLogin() }} noValidate>
              <div className="space-y-2">
                <Label htmlFor="username">اسم المستخدم</Label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoFocus
                    className="login-input pr-9 pl-10"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="اسم المستخدم"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="login-input pr-9 pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm text-center">
                  {errorMsg}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold"
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'دخول'}
              </Button>
            </form>
            <p className="mt-5 border-t pt-4 text-center text-[11px] leading-5 text-muted-foreground">يعمل Uni Kasher محليًا، وبياناتك التجارية محفوظة داخل قاعدة البيانات على هذا الجهاز.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
