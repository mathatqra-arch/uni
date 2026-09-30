import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface DataTableColumn<T> {
  key: string
  header: string
  align?: 'left' | 'center' | 'right'
  width?: string
  className?: string
  cellClassName?: string
  render?: (row: T, index: number) => React.ReactNode
}

export interface DataTableProps<T> {
  columns?: DataTableColumn<T>[]
  rows?: T[]
  rowKey?: (row: T) => string | number | null | undefined
  rowClassName?: string | ((row: T) => string)
  loading?: boolean
  skeletonRows?: number
  emptyMessage?: string
  emptyContent?: React.ReactNode
  maxHeight?: string
  minHeight?: string
  fillHeight?: boolean
  reserveHeight?: number
  minWidth?: string
  className?: string
  density?: 'comfortable' | 'compact'
  onRowClick?: (row: T) => void
}

/** Header and rows share one native table, guaranteeing aligned columns. */
export function DataTable<T extends object>({
  columns = [], rows = [], rowKey, rowClassName, loading = false, skeletonRows = 6,
  emptyMessage = 'لا توجد بيانات لعرضها', emptyContent, maxHeight = '420px',
  minHeight = '380px', fillHeight = false, reserveHeight = 330,
  minWidth = 'min-w-[720px]', className, density = 'comfortable', onRowClick,
}: DataTableProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  // Keep the table compact by default; horizontal scrolling starts only when
  // the current window genuinely cannot fit its columns.
  const minTableWidth = Math.max(560, columns.length * 118)
  const [scrollWidth, setScrollWidth] = useState(minTableWidth)
  const cellPad = density === 'compact' ? 'py-2.5' : 'py-3.5'

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => setScrollWidth(Math.max(minTableWidth, viewport.scrollWidth, viewport.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [minTableWidth, rows.length])

  const syncBottomScrollbar = () => {
    const viewport = viewportRef.current
    const scrollbar = scrollbarRef.current
    if (viewport && scrollbar && Math.abs(scrollbar.scrollLeft - viewport.scrollLeft) > 1) scrollbar.scrollLeft = viewport.scrollLeft
  }
  const syncDataViewport = () => {
    const viewport = viewportRef.current
    const scrollbar = scrollbarRef.current
    if (viewport && scrollbar && Math.abs(viewport.scrollLeft - scrollbar.scrollLeft) > 1) viewport.scrollLeft = scrollbar.scrollLeft
  }
  const getKey = useMemo(() => (row: T, index: number) => {
    const k = rowKey ? rowKey(row) : (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).key
    return (k === undefined || k === null ? index : k) as string | number
  }, [rowKey])
  const cardClass = cn('uk-grid-table-card mb-6 flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-[0_8px_30px_-20px_rgba(22,0,41,0.24)]', className)

  if (loading) return <div className={cardClass} style={{ minHeight }}><div className="space-y-2.5 p-4">{Array.from({ length: skeletonRows }).map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}</div></div>
  if (!rows.length) return <div className={cn(cardClass, 'justify-center')} style={{ minHeight }}><div className="py-14 text-center text-muted-foreground">{emptyContent ?? <p className="text-sm">{emptyMessage}</p>}</div></div>

  return (
    <div className={cardClass} style={{ minHeight }}>
      <div ref={viewportRef} onScroll={syncBottomScrollbar} className="uk-grid-table-viewport flex-1 min-h-0 min-w-0" style={{ maxHeight: fillHeight ? `calc(100dvh - ${reserveHeight}px)` : maxHeight }}>
        <table className={cn('uk-grid-table', minWidth)} style={{ minWidth: minTableWidth, maxWidth: 'none' }}>
          <thead><tr>{columns.map((column) => <th key={column.key} className={cn('uk-grid-table-head', cellPad, 'text-center', column.align === 'left' && 'text-left', column.align === 'right' && 'text-right', column.width, column.className)}>{column.header}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={getKey(row, index)} className={cn(typeof rowClassName === 'function' ? rowClassName(row) : rowClassName, onRowClick && 'uk-grid-table-row-action cursor-pointer')} onClick={onRowClick ? () => onRowClick(row) : undefined} onKeyDown={onRowClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRowClick(row) } } : undefined} tabIndex={onRowClick ? 0 : undefined} role={onRowClick ? 'button' : undefined}>
              {columns.map((column) => {
                const custom = column.render?.(row, index)
                const raw = (row as Record<string, unknown>)[column.key] as React.ReactNode
                const value = custom ?? (raw === undefined || raw === null ? '—' : typeof raw === 'string' || typeof raw === 'number' ? String(raw) : raw)
                return <td key={column.key} className={cn('uk-grid-table-cell', cellPad, 'text-center', column.align === 'left' && 'text-left', column.align === 'right' && 'text-right', column.width, column.cellClassName, column.className)}>{value}</td>
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div ref={scrollbarRef} onScroll={syncDataViewport} className="uk-grid-table-bottom-scroll" dir="rtl" aria-label="تمرير أفقي للجدول"><div aria-hidden="true" style={{ width: scrollWidth, height: 1 }} /></div>
    </div>
  )
}
