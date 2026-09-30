'use client'

import { useMemo } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'
import type { Product } from '@/lib/types'

// Code 128 patterns (values 0-106). We use Code 128-B so normal product
// barcodes/SKUs containing ASCII characters can be printed without another
// dependency. Each pattern is 11 modules except the stop pattern (13).
const CODE128_PATTERNS = [
  '11011001100','11001101100','11001100110','10010011000','10010001100','10001001100','10011001000','10011000100','10001100100','11001001000',
  '11001000100','11000100100','10110011100','10011011100','10011001110','10111001100','10011101100','10011100110','11001110010','11001011100',
  '11001001110','11011100100','11001110100','11101101110','11101001100','11100101100','11100100110','11101100100','11100110100','11100110010',
  '11011011000','11011000110','11000110110','10100011000','10001011000','10001000110','10110001000','10001101000','10001100010','11010001000',
  '11000101000','11000100010','10110111000','10110001110','10001101110','10111011000','10111000110','10001110110','11101110110','11010001110',
  '11000101110','11011101000','11011100010','11011101110','11101011000','11101000110','11100010110','11101101000','11101100010','11100011010',
  '11101111010','11001000010','11110001010','10100110000','10100001100','10010110000','10010000110','10000101100','10000100110','10110010000',
  '10110000100','10011010000','10011000010','10000110100','10000110010','11000010010','11001010000','11110111010','11000010100','10001111010',
  '10100111100','10010111100','10010011110','10111100100','10011110100','10011110010','11110100100','11110010100','11110010010','11011011110',
  '11011110110','11110110110','10101111000','10100011110','10001011110','10111101000','10111100010','11110101000','11110100010','10111011110',
  '10111101110','11101011110','11110101110','11111010110','11111010010','11111011010','11011000010'
]

function code128B(value: string): string {
  const text = value || ''
  if (!text) return ''
  if ([...text].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126)) return ''
  const values = [...text].map(ch => ch.charCodeAt(0) - 32)
  let checksum = 104
  values.forEach((v, i) => { checksum += v * (i + 1) })
  return [104, ...values, checksum % 103, 106].map(v => CODE128_PATTERNS[v]).join('')
}

export function barcodeSvg(value: string, width = 320, height = 90): string {
  const bits = code128B(value)
  if (!bits) return ''
  const quiet = 12
  const moduleWidth = width / (bits.length + quiet * 2)
  let x = quiet * moduleWidth
  const bars: string[] = []
  let inBar = false
  let start = x
  for (const bit of bits) {
    if (bit === '1' && !inBar) { start = x; inBar = true }
    if (bit === '0' && inBar) { bars.push(`<rect x="${start.toFixed(2)}" y="8" width="${(x-start).toFixed(2)}" height="58"/>`); inBar = false }
    x += moduleWidth
  }
  if (inBar) bars.push(`<rect x="${start.toFixed(2)}" y="8" width="${(x-start).toFixed(2)}" height="58"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(value)}"><rect width="100%" height="100%" fill="white"/>${bars.join('')}<text x="50%" y="82" text-anchor="middle" font-family="Arial, sans-serif" font-size="14">${escapeHtml(value)}</text></svg>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] || c))
}

function printProducts(products: Product[], copies = 1) {
  const printable = products.filter(p => (p.barcode || p.sku)?.trim())
  if (!printable.length) { toast.error('لا يوجد باركود أو SKU صالح للطباعة'); return }
  const labels = printable.flatMap(p => Array.from({ length: Math.max(1, copies) }, () => p))
  const cards = labels.map(p => {
    const value = (p.barcode || p.sku).trim()
    return `<div class="label"><div class="name">${escapeHtml(p.nameAr || p.name || '')}</div>${barcodeSvg(value, 330, 92)}<div class="price">${Number(p.sellingPrice || 0).toFixed(2)} ج.م</div></div>`
  }).join('')

  // Tauri desktop/WebView may block window.open(). Use a hidden same-page
  // iframe instead, which is also the printing method used by receipts.
  let frame = document.getElementById('barcode-print-frame') as HTMLIFrameElement | null
  if (!frame) {
    frame = document.createElement('iframe')
    frame.id = 'barcode-print-frame'
    frame.style.position = 'fixed'
    frame.style.right = '-9999px'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    document.body.appendChild(frame)
  }

  const html = `<html dir="rtl"><head><title>طباعة باركود المنتجات</title><style>body{font-family:Arial,sans-serif;margin:8mm}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}.label{text-align:center;border:1px dashed #bbb;padding:4mm;break-inside:avoid}.name{font-size:13px;font-weight:700;margin-bottom:2mm}.price{font-size:13px;font-weight:700;margin-top:1mm}@media print{@page{margin:5mm}.label{border:none}}</style></head><body><div class="grid">${cards}</div></body></html>`

  frame.onload = () => {
    setTimeout(() => {
      try {
        frame?.contentWindow?.focus()
        frame?.contentWindow?.print()
        toast.success(`تم تجهيز ${labels.length} ملصق باركود للطباعة`)
      } catch {
        toast.error('تعذر فتح نافذة الطباعة')
      }
    }, 150)
  }
  frame.srcdoc = html
}

export function BarcodeDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (v: boolean) => void; product: Product | null }) {
  const value = product?.barcode || product?.sku || ''
  const svg = useMemo(() => value ? barcodeSvg(value, 330, 100) : '', [value])
  const svgUrl = useMemo(() => svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '', [svg])
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>طباعة باركود المنتج</DialogTitle></DialogHeader><div className="space-y-4"><div className="text-center font-bold">{product?.nameAr || product?.name}</div><div className="rounded border bg-white p-3 flex justify-center overflow-hidden">{svgUrl ? <img src={svgUrl} alt={`باركود ${value}`} className="max-w-full h-auto" /> : <p className="text-sm text-muted-foreground">الباركود غير صالح</p>}</div><p className="text-center text-sm text-muted-foreground font-mono">{value}</p></div><DialogFooter><Button className="w-full" onClick={() => printProducts(product ? [product] : [])} disabled={!value}><Printer className="w-4 h-4 ml-1"/>طباعة الباركود</Button></DialogFooter></DialogContent></Dialog>
}

export function BulkBarcodeDialog({ open, onOpenChange, products }: { open: boolean; onOpenChange: (v: boolean) => void; products: Product[] }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>طباعة باركود المنتجات</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm text-muted-foreground text-center">سيتم طباعة باركود للمنتجات المعروضة التي لديها باركود أو SKU.</p><p className="text-center font-bold">{products.filter(p => p.barcode || p.sku).length} منتج</p></div><DialogFooter><Button className="w-full" onClick={() => printProducts(products)}><Printer className="w-4 h-4 ml-1"/>طباعة الكل</Button></DialogFooter></DialogContent></Dialog>
}
