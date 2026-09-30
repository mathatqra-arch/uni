"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const scrollbarRef = React.useRef<HTMLDivElement>(null)
  const [scrollWidth, setScrollWidth] = React.useState(0)

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => setScrollWidth(Math.max(viewport.scrollWidth, viewport.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const syncBottom = () => {
    const viewport = viewportRef.current
    const scrollbar = scrollbarRef.current
    if (viewport && scrollbar && Math.abs(scrollbar.scrollLeft - viewport.scrollLeft) > 1) scrollbar.scrollLeft = viewport.scrollLeft
  }
  const syncViewport = () => {
    const viewport = viewportRef.current
    const scrollbar = scrollbarRef.current
    if (viewport && scrollbar && Math.abs(viewport.scrollLeft - scrollbar.scrollLeft) > 1) viewport.scrollLeft = scrollbar.scrollLeft
  }

  return (
    <div
      data-slot="table-container"
      className="uk-table-container uk-shared-table relative flex w-full min-w-0 flex-col"
    >
      <div ref={viewportRef} onScroll={syncBottom} className="uk-shared-table-viewport min-w-0">
        <table
          data-slot="table"
          className={cn("uk-grid-table w-full min-w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
      <div ref={scrollbarRef} onScroll={syncViewport} className="uk-shared-table-bottom-scroll" dir="rtl" aria-label="تمرير أفقي للجدول">
        <div aria-hidden="true" style={{ width: scrollWidth, height: 1 }} />
      </div>
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_th]:bg-muted/50", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/45 data-[state=selected]:bg-accent/40 border-b transition-colors duration-150",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "uk-grid-table-head text-foreground h-12 px-4 text-left align-middle font-semibold text-xs whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "uk-grid-table-cell px-4 py-3.5 align-middle whitespace-nowrap text-left [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
