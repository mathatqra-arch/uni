// ============================================================
// DESKTOP ENTRY POINT — TAURI APPLICATION
// ============================================================
// This is the only frontend entry point shipped in the desktop build.
// Business data is handled by the local SQLite data layer; there is no
// ============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import './globals.css'
import './table-v4.css'
import { createPortal } from 'react-dom'
import { Toaster as SonnerToaster } from '@/components/ui/sonner'
import { ErrorBoundary } from '@/components/error-boundary'
import { GlobalErrorListener } from '@/components/global-error-listener'
import App from './desktop-app'

function RootFallback({ error, retry }: { error: Error; retry: () => void }) {
  const details = error.message || 'Unknown error'
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6" dir="rtl">
      <div className="uk-release-state w-full max-w-lg rounded-3xl border bg-card p-7 text-center shadow-xl">
        <div className="mx-auto mb-5 h-16 w-16 overflow-hidden rounded-2xl bg-[#F5EFE2] ring-1 ring-[#772344]/10 shadow-lg">
          <img src="/icon-512.png" alt="Uni Kasher" className="h-full w-full object-cover" draggable={false} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">Uni Kasher</p>
        <h1 className="mt-2 text-xl font-bold">تعذر إكمال التشغيل</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">تم إيقاف الشاشة الحالية لحماية بياناتك. أعد المحاولة، وإذا استمرت المشكلة احتفظ برقم الخطأ للدعم.</p>
        {details && (
          <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-right">
            <p className="text-xs font-semibold text-destructive">مرجع الخطأ</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground" dir="ltr">{details}</p>
          </div>
        )}
        <button className="mt-5 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:-translate-y-0.5 hover:shadow-md" onClick={retry}>إعادة المحاولة</button>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={RootFallback}>
      <GlobalErrorListener />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">تخطي إلى المحتوى الرئيسي</a>
      <App />
      {/* Toasts portal to document.body: #root has isolation:isolate, which
          would trap any in-root z-index below body-level Radix portals.
          Body-level mounting + max z-index = notifications always on top. */}
      {createPortal(<SonnerToaster position="top-center" richColors />, document.body)}
    </ErrorBoundary>
  </React.StrictMode>
)
