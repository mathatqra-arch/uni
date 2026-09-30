"use client"

import { useUIStore } from '@/lib/store'
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useUIStore((state) => state.theme)

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-left"
      dir="rtl"
      toastOptions={{
        style: {
          borderRadius: '0.9rem',
          border: '1px solid var(--uk-border-visible, rgba(119,35,68,.14))',
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }