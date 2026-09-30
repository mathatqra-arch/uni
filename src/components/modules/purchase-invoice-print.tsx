'use client'

import { useState, useEffect } from 'react'
import { formatEGP, formatDateTime, apiFetch } from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Printer, FileText } from 'lucide-react'
import type { Purchase, PurchaseItem } from '@/lib/types'
import { toast } from 'sonner'

type InvoicePurchase = Omit<Purchase, 'items'> & {
  createdAt?: string
  user?: { name?: string } | null
  items?: Array<PurchaseItem & { name?: string; sku?: string; product?: { id?: string; name?: string; nameAr?: string | null; sku?: string } | null }>
}

// Printable purchase-invoice dialog — same 80mm thermal-receipt approach as
// ReceiptPrint (src/components/pos/receipt-print.tsx): store info pulled
// from Settings, printed via a hidden same-page <iframe> (works inside the
// Tauri desktop app's CSP and avoids popup-blocker issues in the browser
// build). Shown for a supplier instead of a customer, with purchase items
// instead of sale items, and adds paid/remaining like the purchases table.
export function PurchaseInvoicePrint({ purchase, onClose }: { purchase: InvoicePurchase; onClose: () => void }) {
  const [printed, setPrinted] = useState(false)
  const [storeInfo, setStoreInfo] = useState({
    name: '',
    address: '',
    phone: '',
  })

  useEffect(() => {
    apiFetch('/settings')
      .then((data) => {
        if (data?.flat) {
          const settings: Record<string, string> = {}
          data.flat.forEach((s) => { settings[s.key] = s.value })
          setStoreInfo(prev => ({
            name: settings['store.name'] || prev.name,
            address: settings['store.address'] || prev.address,
            phone: settings['store.phone'] || prev.phone,
          }))
        }
      })
      .catch(() => { /* use defaults */ })
  }, [])

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))

  const remaining = (purchase.total || 0) - (purchase.paidAmount || 0)

  const invoice = {
    invoiceNumber: purchase.invoiceNumber,
    date: purchase.createdAt,
    user: purchase.user?.name || 'المستخدم',
    supplier: purchase.supplier,
    store: storeInfo,
    items: purchase.items || [],
    subtotal: purchase.subtotal || 0,
    discountAmount: purchase.discountAmount || 0,
    taxAmount: purchase.taxAmount || 0,
    total: purchase.total || 0,
    paidAmount: purchase.paidAmount || 0,
    remaining,
    note: purchase.note,
  }

  const handlePrint = () => {
    const invoiceHTML = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <title>فاتورة شراء ${esc(invoice.invoiceNumber)}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', 'Tajawal', Arial, sans-serif; }
          body { width: 80mm; padding: 5mm; font-size: 12px; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .small { font-size: 10px; }
          .border-top { border-top: 1px dashed #000; margin-top: 5px; padding-top: 5px; }
          .border-bottom { border-bottom: 1px dashed #000; margin-bottom: 5px; padding-bottom: 5px; }
          .flex { display: flex; justify-content: space-between; }
          .item { margin-bottom: 3px; }
          @media print { @page { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size:16px;">${esc(invoice.store.name)}</div>
        <div class="center small">${esc(invoice.store.address)}</div>
        <div class="center small">ت: ${esc(invoice.store.phone)}</div>
        <div class="center bold" style="font-size:13px; margin-top:6px;">فاتورة شراء</div>
        <div class="border-top border-bottom center small">
          <div>رقم الفاتورة: <span class="bold">${esc(invoice.invoiceNumber)}</span></div>
          <div>${esc(formatDateTime(invoice.date))}</div>
          <div>المستخدم: ${esc(invoice.user)}</div>
          ${invoice.supplier ? `<div>المورد: ${esc(invoice.supplier.name || '')}</div>` : ''}
          ${invoice.supplier?.phone ? `<div>ت المورد: ${esc(invoice.supplier.phone)}</div>` : ''}
        </div>
        <div style="margin-top:5px;">
          ${invoice.items.map((item) => `
            <div class="item">
              <div class="flex">
                <span>${esc(item.product?.nameAr || item.product?.name || 'منتج')}</span>
                <span>${esc(item.quantity)}× ${esc(formatEGP(item.unitCost))}</span>
              </div>
              <div class="flex bold small">
                <span>المجموع:</span>
                <span>${esc(formatEGP(item.total))}</span>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="border-top">
          <div class="flex small"><span>المجموع الفرعي:</span><span>${esc(formatEGP(invoice.subtotal))}</span></div>
          ${invoice.discountAmount > 0 ? `<div class="flex small"><span>الخصم:</span><span>- ${esc(formatEGP(invoice.discountAmount))}</span></div>` : ''}
          <div class="flex small"><span>الضريبة:</span><span>${esc(formatEGP(invoice.taxAmount))}</span></div>
          <div class="flex bold" style="font-size:14px; margin-top:3px;"><span>الإجمالي:</span><span>${esc(formatEGP(invoice.total))}</span></div>
        </div>
        <div class="border-top small">
          <div class="flex"><span>المدفوع:</span><span>${esc(formatEGP(invoice.paidAmount))}</span></div>
          ${invoice.remaining > 0 ? `<div class="flex bold"><span>المتبقي للمورد:</span><span>${esc(formatEGP(invoice.remaining))}</span></div>` : `<div class="flex bold"><span>الحالة:</span><span>مدفوعة بالكامل</span></div>`}
        </div>
        ${invoice.note ? `<div class="border-top small"><div>ملاحظة: ${esc(invoice.note)}</div></div>` : ''}
        <div class="border-top center small" style="margin-top:5px;">
          <div>*** ${esc(invoice.invoiceNumber)} ***</div>
        </div>
      </body>
      </html>
    `

    let frame = document.getElementById('purchase-invoice-print-frame') as HTMLIFrameElement | null
    if (!frame) {
      frame = document.createElement('iframe')
      frame.id = 'purchase-invoice-print-frame'
      frame.style.position = 'fixed'
      frame.style.right = '-9999px'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      document.body.appendChild(frame)
    }

    const triggerPrint = () => {
      try {
        frame!.contentWindow?.focus()
        frame!.contentWindow?.print()
        setPrinted(true)
        toast.success('تم إرسال فاتورة الشراء للطباعة')
      } catch {
        toast.error('تعذر فتح نافذة الطباعة — تأكد من تعريف الطابعة على الجهاز')
      }
    }

    frame.onload = () => {
      setTimeout(triggerPrint, 150)
    }
    frame.srcdoc = invoiceHTML
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            طباعة فاتورة شراء
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Receipt preview — thermal style, mirrors ReceiptPrint's preview */}
          <div className="border-2 border-dashed border-border rounded-lg p-3 font-mono text-xs max-h-72 overflow-y-auto bg-white" dir="rtl">
            <div className="text-center font-bold">{invoice.store.name}</div>
            <div className="text-center text-[10px] text-gray-500">{invoice.store.address}</div>
            <div className="text-center text-[10px] text-gray-500">ت: {invoice.store.phone}</div>
            <div className="text-center font-bold text-[11px] mt-1">فاتورة شراء</div>
            <div className="border-t border-dashed my-2 pt-1">
              <div className="text-[10px]">رقم الفاتورة: {invoice.invoiceNumber}</div>
              <div className="text-[10px]">{formatDateTime(invoice.date)}</div>
              {invoice.supplier && <div className="text-[10px]">المورد: {invoice.supplier.name}</div>}
            </div>
            {invoice.items.map((item, i: number) => (
              <div key={i} className="text-[10px] flex justify-between">
                <span>{item.product?.nameAr || item.product?.name || 'منتج'} ×{item.quantity}</span>
                <span className="pos-number">{formatEGP(item.total)}</span>
              </div>
            ))}
            <div className="border-t border-dashed mt-2 pt-1">
              <div className="text-[10px] flex justify-between"><span>المجموع:</span><span className="pos-number">{formatEGP(invoice.subtotal)}</span></div>
              {invoice.discountAmount > 0 && <div className="text-[10px] flex justify-between text-orange-600"><span>الخصم:</span><span className="pos-number">- {formatEGP(invoice.discountAmount)}</span></div>}
              <div className="text-[10px] flex justify-between"><span>الضريبة:</span><span className="pos-number">{formatEGP(invoice.taxAmount)}</span></div>
              <div className="text-[10px] flex justify-between font-bold"><span>الإجمالي:</span><span className="pos-number">{formatEGP(invoice.total)}</span></div>
              <div className="text-[10px] flex justify-between text-green-600"><span>المدفوع:</span><span className="pos-number">{formatEGP(invoice.paidAmount)}</span></div>
              {invoice.remaining > 0 && <div className="text-[10px] flex justify-between font-bold text-orange-600"><span>المتبقي:</span><span className="pos-number">{formatEGP(invoice.remaining)}</span></div>}
            </div>
          </div>

          <Button onClick={handlePrint} className="w-full h-12 bg-brand-gradient hover:opacity-90">
            <Printer className="w-4 h-4 ml-2" />
            طباعة الفاتورة
          </Button>

          {printed && (
            <p className="text-xs text-center text-green-600">تم الإرسال للطابعة</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full">إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
