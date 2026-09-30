'use client'

import { useEffect, type ReactNode } from 'react'
import { useUIStore } from '@/lib/store'

/**
 * Desktop theme bridge.
 *
 * Uni Kasher uses one persisted theme source: useUIStore. The app is a Tauri desktop
 * app and the theme is already persisted by useUIStore. Keeping one source
 * of truth avoids a second persistence layer and removes a web-only runtime
 * dependency from the desktop shell.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUIStore((state) => state.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
  }, [theme])

  return <>{children}</>
}
