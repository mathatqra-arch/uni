'use client'

import { logger } from '../lib/logger'

import React from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// ============================================================
// ERROR BOUNDARY — Prevents white-screen crashes
// ============================================================
// Wraps the entire app. If any component throws during render,
// this boundary catches it and shows a friendly error screen
// instead of a blank white page.
//
// The cashier can retry, which remounts the tree.
// ============================================================

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorId: string | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorId: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Generate a unique error ID for support/debugging
    const errorId = `ERR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    return { hasError: true, error, errorId }
  }

  componentDidCatch(error: Error, _errorInfo: React.ErrorInfo) {
    // Log to console for debugging (server logs in production)
    logger.error(`[ErrorBoundary] Caught error: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  retry = () => {
    this.setState({ hasError: false, error: null, errorId: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        const Fallback = this.props.fallback
        return <Fallback error={this.state.error} retry={this.retry} />
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4" dir="rtl">
          <div className="error-surface max-w-md w-full rounded-2xl border p-8 shadow-lg text-center">
            <div className="error-icon mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h2 className="mb-2 text-xl font-bold text-foreground">حدث خطأ غير متوقع</h2>
            <p className="mb-1 text-sm text-muted-foreground">
              النظام واجه مشكلة. يمكنك المحاولة مرة أخرى.
            </p>
            {this.state.errorId && (
              <p className="mb-4 font-mono text-xs text-muted-foreground">
                رقم الخطأ: {this.state.errorId}
              </p>
            )}
            <Button onClick={this.retry} className="w-full">
              <RefreshCw className="ml-2 h-4 w-4" />
              إعادة المحاولة
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// ============================================================
// MODULE ERROR BOUNDARY — For individual modules
// ============================================================
// Wraps a single module (e.g. POS, Products). If that module
// crashes, only it shows the error — the rest of the app works.
// ============================================================

export function ModuleErrorBoundary({ children, moduleName }: { children: React.ReactNode; moduleName: string }) {
  return (
    <ErrorBoundary
      fallback={({ retry }) => (
        <div className="flex min-h-[400px] items-center justify-center p-4" dir="rtl">
          <div className="error-surface max-w-md w-full rounded-2xl border p-6 shadow text-center">
            <div className="error-icon error-icon-warning mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-foreground">
              خطأ في وحدة {moduleName}
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">
              حدث خطأ أثناء تحميل هذه الوحدة. يمكنك المحاولة مرة أخرى.
            </p>
            <Button onClick={retry} variant="outline">
              <RefreshCw className="ml-2 h-4 w-4" />
              إعادة المحاولة
            </Button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
