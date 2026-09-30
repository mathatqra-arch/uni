// ============================================================
// Shared thermal receipt template
// ============================================================
// This is the single source of truth for what a printed sales
// receipt looks like. It was previously duplicated inline inside
// src/components/pos/receipt-print.tsx — any other screen that
// wanted to reprint a sale (e.g. the Reports module) had no way to
// produce byte-for-byte the same layout without copy/pasting the
// whole template and letting the two copies drift apart.
//
// Both the POS post-sale dialog (receipt-print.tsx) and the Sales
// report's "reprint" button now call buildReceiptHTML() +
// printReceiptHTML() from here, so the paper that comes out of the
// printer is guaranteed identical no matter which screen triggered it.
// ============================================================

import { apiFetch, formatEGP, formatDateTime } from '@/lib/api'
import QRCode from 'qrcode'

export interface ReceiptData {
  invoiceNumber: string
  date: string | Date
  cashier: string
  customer?: { name?: string } | null
  store: {
    name: string
    address: string
    phone: string
    email?: string
    receiptFooter: string
    logo?: string
    showLogo?: boolean
    width?: '58' | '80'
  }
  items: Array<{
    quantity: number
    unitPrice: number
    total: number
    product?: { name?: string; nameAr?: string } | null
    productName?: string | null
  }>
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  paidAmount: number
  changeAmount: number
  paymentMethod: string
  loyaltyEarned: number
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
))

/** Builds the full printable HTML document for a thermal (80mm) sales receipt. */
export function buildReceiptHTML(receipt: ReceiptData, qrDataUrl?: string, qrCaption?: string): string {
  const width = receipt.store.width === '58' ? '58mm' : '80mm'
  const logo = receipt.store.showLogo && receipt.store.logo
    ? `<div class="logo-wrap"><img src="${esc(receipt.store.logo)}" alt="شعار المتجر" /></div>`
    : ''
  const paymentLabel = receipt.paymentMethod === 'CASH'
    ? 'نقدي'
    : receipt.paymentMethod === 'CARD'
      ? 'بطاقة'
      : receipt.paymentMethod === 'TRANSFER'
        ? 'تحويل'
        : esc(receipt.paymentMethod)

  return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="utf-8">
      <title>فاتورة ${esc(receipt.invoiceNumber)}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Alexandria', 'Cairo', 'Tahoma', Arial, sans-serif; }
        body { width: ${width}; padding: 4mm; color: #111; background: #fff; font-size: 11px; line-height: 1.55; }
        .center { text-align: center; }
        .bold { font-weight: 800; }
        .muted { color: #555; }
        .small { font-size: 9px; }
        .title { font-size: 18px; font-weight: 800; line-height: 1.25; }
        .logo-wrap { text-align: center; margin: 0 0 5px; }
        .logo-wrap img { max-width: 46mm; max-height: 25mm; object-fit: contain; display: inline-block; }
        .meta { margin: 8px 0; border-top: 1px dashed #222; border-bottom: 1px dashed #222; padding: 6px 0; }
        .meta-row, .line { display: flex; justify-content: space-between; gap: 8px; }
        .items-head { display: grid; grid-template-columns: 1fr 16mm 18mm; gap: 4px; padding: 5px 0; border-bottom: 1px solid #111; font-size: 9px; font-weight: 800; }
        .items-head span:nth-child(n+2), .num { text-align: left; direction: ltr; }
        .item { padding: 5px 0; border-bottom: 1px dotted #aaa; }
        .item-name { font-weight: 700; margin-bottom: 2px; }
        .item-sub { display: grid; grid-template-columns: 1fr 16mm 18mm; gap: 4px; font-size: 9px; align-items: center; }
        .totals { margin-top: 7px; padding-top: 6px; border-top: 1px dashed #222; }
        .total-main { margin-top: 5px; padding: 7px 6px; border: 2px solid #111; border-radius: 5px; font-size: 15px; font-weight: 800; }
        .payment { margin-top: 7px; padding-top: 6px; border-top: 1px dashed #222; }
        .qr { text-align: center; margin: 9px 0 3px; }
        .qr img { width: 28mm; height: 28mm; object-fit: contain; }
        .footer { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #222; text-align: center; }
        @media print { @page { size: ${width} auto; margin: 0; } body { width: ${width}; } }
      </style>
    </head>
    <body>
      ${logo}
      <div class="center title">${esc(receipt.store.name)}</div>
      ${receipt.store.address ? `<div class="center small muted">${esc(receipt.store.address)}</div>` : ''}
      ${receipt.store.phone ? `<div class="center small muted">هاتف: ${esc(receipt.store.phone)}</div>` : ''}
      ${receipt.store.email ? `<div class="center small muted">${esc(receipt.store.email)}</div>` : ''}

      <div class="meta small">
        <div class="meta-row"><span>رقم الفاتورة</span><span class="bold num">${esc(receipt.invoiceNumber)}</span></div>
        <div class="meta-row"><span>التاريخ</span><span>${esc(formatDateTime(receipt.date))}</span></div>
        <div class="meta-row"><span>الكاشير</span><span>${esc(receipt.cashier)}</span></div>
        ${receipt.customer ? `<div class="meta-row"><span>العميل</span><span>${esc(receipt.customer.name || '')}</span></div>` : ''}
      </div>

      <div class="items-head">
        <span>الصنف</span><span>الكمية</span><span>الإجمالي</span>
      </div>
      ${receipt.items.map((item) => `
        <div class="item">
          <div class="item-name">${esc(item.product?.nameAr || item.product?.name || item.productName || 'منتج')}</div>
          <div class="item-sub">
            <span></span>
            <span class="num">${esc(item.quantity)} × ${esc(formatEGP(item.unitPrice))}</span>
            <span class="num bold">${esc(formatEGP(item.total))}</span>
          </div>
        </div>
      `).join('')}

      <div class="totals small">
        <div class="line"><span>المجموع الفرعي</span><span class="num">${esc(formatEGP(receipt.subtotal))}</span></div>
        ${receipt.discountAmount > 0 ? `<div class="line"><span>الخصم</span><span class="num">- ${esc(formatEGP(receipt.discountAmount))}</span></div>` : ''}
        ${receipt.taxAmount > 0 ? `<div class="line"><span>الضريبة</span><span class="num">${esc(formatEGP(receipt.taxAmount))}</span></div>` : ''}
        <div class="line total-main"><span>الإجمالي</span><span class="num">${esc(formatEGP(receipt.total))}</span></div>
      </div>

      <div class="payment small">
        <div class="line"><span>طريقة الدفع</span><span>${paymentLabel}</span></div>
        <div class="line"><span>المدفوع</span><span class="num">${esc(formatEGP(receipt.paidAmount))}</span></div>
        ${receipt.changeAmount > 0 ? `<div class="line"><span>الباقي</span><span class="num">${esc(formatEGP(receipt.changeAmount))}</span></div>` : ''}
      </div>

      ${receipt.loyaltyEarned > 0 ? `<div class="center small" style="margin-top:6px;">النقاط المكتسبة: <strong>${esc(receipt.loyaltyEarned)}</strong></div>` : ''}
      ${qrDataUrl ? `<div class="qr"><img src="${esc(qrDataUrl)}" alt="QR" />${qrCaption ? `<div class="small muted">${esc(qrCaption)}</div>` : ''}</div>` : ''}
      <div class="footer small">
        ${receipt.store.receiptFooter ? `<div>${esc(receipt.store.receiptFooter)}</div>` : ''}
        <div style="margin-top:3px;">شكرًا لزيارتكم ❤️</div>
      </div>
    </body>
    </html>
  `
}

// ============================================================
// Reprint-from-report support
// ============================================================
// Rebuilds the exact same receipt (store info, live loyalty QR, layout)
// that would have printed at the register for a given sale, so a manager
// reprinting from the Sales report gets identical paper to what the
// customer originally received. Fetches store settings + (if the sale has
// a customer) that customer's *current* point balance, same as the POS
// post-sale dialog does.
// ============================================================

export async function printSaleReceipt(sale, onDone?: () => void, onError?: () => void) {
  let storeInfo: ReceiptData['store'] = {
    name: 'المتجر',
    address: '',
    phone: '',
    receiptFooter: '',
    logo: '',
    showLogo: true,
    width: '80' as const,
  }
  let egpPerPoint = 0.05
  try {
    const data = await apiFetch('/settings') as { flat?: Array<{ key: string; value: string }> } | null
    if (data?.flat) {
      const settings: Record<string, string> = {}
      data.flat.forEach((s) => { settings[s.key] = s.value })
      storeInfo = {
        name: settings['store.name'] || storeInfo.name,
        address: settings['store.address'] || storeInfo.address,
        phone: settings['store.phone'] || storeInfo.phone,
        receiptFooter: settings['receipt.footer'] || storeInfo.receiptFooter,
        logo: settings['store.logo'] || '',
        showLogo: settings['receipt.showLogo'] !== 'false',
        width: settings['receipt.width'] === '58' ? '58' : '80',
      }
      egpPerPoint = parseFloat(settings['loyalty.egpPerPoint']) || 0.05
    }
  } catch { /* use defaults */ }

  let customerPoints: number | null = null
  if (sale.customerId) {
    try {
      const c = await apiFetch(`/customers/${sale.customerId}`) as { loyaltyAccount?: { points?: number } } | null
      customerPoints = c?.loyaltyAccount?.points ?? 0
    } catch { customerPoints = null }
  }

  const receipt: ReceiptData = {
    invoiceNumber: sale.invoiceNumber,
    date: sale.createdAt,
    cashier: sale.user?.name || 'المستخدم',
    customer: sale.customer,
    store: storeInfo,
    items: sale.items || [],
    subtotal: sale.subtotal || 0,
    discountAmount: sale.discountAmount || 0,
    taxAmount: sale.taxAmount || 0,
    total: sale.total || 0,
    paidAmount: sale.paidAmount || 0,
    changeAmount: sale.changeAmount || 0,
    paymentMethod: sale.paymentMethod || 'CASH',
    loyaltyEarned: sale.loyaltyEarned || 0,
  }

  let qrText: string
  if (sale.customerId && customerPoints !== null) {
    const value = formatEGP(Math.round(customerPoints * egpPerPoint * 100) / 100)
    qrText = `${storeInfo.name}\nرصيدك من نقاط الولاء: ${customerPoints} نقطة (${value})\nاستخدمها كخصم في مشترياتك القادمة!`
  } else if (sale.customerId) {
    qrText = `${storeInfo.name}\nشكرًا لتسوقك معنا! فاتورة رقم ${receipt.invoiceNumber}`
  } else {
    qrText = `${storeInfo.name}\nسجّل حسابك واحصل على نقاط ولاء مع كل عملية شراء تقدر تستبدلها كخصم!\nاسأل الكاشير عن التسجيل.`
  }
  const qrCaption = sale.customerId ? 'امسح لعرض رصيد نقاطك' : 'امسح لتسجيل حساب واكتساب نقاط الولاء'

  let qrDataUrl: string | undefined
  try {
    qrDataUrl = await QRCode.toDataURL(qrText, {
      width: 150,
      margin: 1,
      color: { dark: '#1a1a1a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
  } catch { /* receipt still works without QR */ }

  const html = buildReceiptHTML(receipt, qrDataUrl, qrCaption)
  printReceiptHTML(html, onDone, onError)
}

// Reuse a single hidden iframe across prints instead of creating a new one
// every time (avoids leaking detached iframes into the DOM). Same technique
// used by the POS receipt dialog, and for the same reason: a same-page
// hidden <iframe> + iframe.contentWindow.print() works under the desktop
// app's `script-src 'self'` CSP and doesn't depend on popup-blocker/
// multi-window support, unlike window.open() + injected <script>.
export function printReceiptHTML(html: string, onDone?: () => void, onError?: () => void) {
  let frame = document.getElementById('receipt-print-frame') as HTMLIFrameElement | null
  if (!frame) {
    frame = document.createElement('iframe')
    frame.id = 'receipt-print-frame'
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
      onDone?.()
    } catch {
      onError?.()
    }
  }

  frame.onload = () => {
    // Small delay lets the browser finish layout/paint before printing —
    // calling print() the instant onload fires can produce a blank page on
    // some thermal-printer drivers.
    setTimeout(triggerPrint, 150)
  }
  frame.srcdoc = html
}
