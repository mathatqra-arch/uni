'use client'

import { useState, useEffect } from 'react'
import { formatEGP, formatDateTime, apiFetch } from '@/lib/api'
import { buildReceiptHTML, printReceiptHTML, type ReceiptData } from '@/lib/receipt-template'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Printer, CheckCircle, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import QRCode from 'qrcode'

type ReceiptDataSale = {
  invoiceNumber?: string
  date?: string | Date
  createdAt?: string | Date
  customer?: { name?: string } | null
  customerId?: string | null
  user?: { name?: string } | null
  cashier?: string
  items: Array<{ quantity: number; unitPrice: number; total: number; product?: { name?: string; nameAr?: string | null } | null; productName?: string | null }>
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
  paidAmount: number
  changeAmount: number
  paymentMethod: string
  loyaltyEarned: number
}

export function ReceiptPrint({ sale, onClose }: { sale: ReceiptDataSale; onClose: () => void }) {
  const [printed, setPrinted] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [egpPerPoint, setEgpPerPoint] = useState(0.05)
  const [storeInfo, setStoreInfo] = useState({
    name: '',
    address: '',
    phone: '',
    receiptFooter: '',
    logo: '',
    showLogo: true,
    width: '80' as '58' | '80',
  })

  // Fetch real store info from settings — via apiFetch, which routes to
  // Receipt settings are read from local SQLite through desktopApiFetch().
  // Tauri desktop app there is no such server, so this silently failed on
  // every single printed receipt and always fell back to the hardcoded
  // defaults above — the real store name/address/phone/footer from
  // Settings never made it onto a printed invoice.
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
            receiptFooter: settings['receipt.footer'] || prev.receiptFooter,
            logo: settings['store.logo'] || '',
            showLogo: settings['receipt.showLogo'] !== 'false',
            width: settings['receipt.width'] === '58' ? '58' : '80',
          }))
          setEgpPerPoint(parseFloat(settings['loyalty.egpPerPoint']) || 0.05)
        }
      })
      .catch(() => { /* use defaults */ })
  }, [])

  // Current loyalty point balance for the QR code below — fetched fresh
  // (not read off `sale`) so it reflects points earned by *this* sale,
  // which is only known after handleCreateSale has already run.
  const [customerPoints, setCustomerPoints] = useState<number | null>(null)
  useEffect(() => {
    if (!sale.customerId) { setCustomerPoints(null); return }
    apiFetch(`/customers/${sale.customerId}`)
      .then((c) => setCustomerPoints(c?.loyaltyAccount?.points ?? 0))
      .catch(() => setCustomerPoints(null))
  }, [sale.customerId])

  // Build receipt data from the sale object
  const receipt: ReceiptData = {
    invoiceNumber: sale.invoiceNumber ?? '',
    date: sale.createdAt ?? new Date(),
    cashier: sale.user?.name || 'المستخدم',
    customer: sale.customer,
    store: storeInfo,
    items: (sale.items || []) as ReceiptData['items'],
    subtotal: sale.subtotal || 0,
    discountAmount: sale.discountAmount || 0,
    taxAmount: sale.taxAmount || 0,
    total: sale.total || 0,
    paidAmount: sale.paidAmount || 0,
    changeAmount: sale.changeAmount || 0,
    paymentMethod: sale.paymentMethod || 'CASH',
    loyaltyEarned: sale.loyaltyEarned || 0,
  }

  // Caption shown under the printed QR code — kept in sync with what the
  // in-dialog preview below shows, and passed through to buildReceiptHTML
  // so the printed paper matches this screen exactly.
  const qrCaption = sale.customerId ? 'امسح لعرض رصيد نقاطك' : 'امسح لتسجيل حساب واكتساب نقاط الولاء'

  // Generate the receipt's QR code.
  // FIX: this used to always encode a JSON verification payload
  // ({type, invoice, total, date, store}) — plain data with no purpose for
  // the customer scanning it with a phone camera; nothing in this app
  // exposes a web page for such a link to point to (it's a fully offline
  // desktop app, there's no server to visit). Now the QR encodes plain,
  // human-readable text that a normal camera QR scanner shows directly:
  //  - registered customer → their current point balance and EGP value
  //  - no customer on the sale → an invitation to sign up with the cashier
  // so scanning the receipt is actually useful either way.
  useEffect(() => {
    let qrText: string
    if (sale.customerId && customerPoints !== null) {
      const value = formatEGP(Math.round(customerPoints * egpPerPoint * 100) / 100)
      qrText = `${receipt.store.name}\nرصيدك من نقاط الولاء: ${customerPoints} نقطة (${value})\nاستخدمها كخصم في مشترياتك القادمة!`
    } else if (sale.customerId) {
      // customerId present but the points fetch hasn't resolved yet — fall
      // back to a generic thank-you rather than showing a stale/wrong number.
      qrText = `${receipt.store.name}\nشكرًا لتسوقك معنا! فاتورة رقم ${receipt.invoiceNumber}`
    } else {
      qrText = `${receipt.store.name}\nسجّل حسابك واحصل على نقاط ولاء مع كل عملية شراء تقدر تستبدلها كخصم!\nاسأل الكاشير عن التسجيل.`
    }
    QRCode.toDataURL(qrText, {
      width: 150,
      margin: 1,
      color: { dark: '#1a1a1a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(url => setQrDataUrl(url))
      .catch(() => { /* QR generation failed — receipt still works without it */ })
  }, [receipt.invoiceNumber, receipt.store.name, sale.customerId, customerPoints, egpPerPoint])

  const handlePrint = () => {
    // Template + iframe-print mechanism now live in src/lib/receipt-template.ts
    // (see FIX notes there) so every screen that reprints a sale — this
    // dialog, and the Sales report's reprint button — produces the exact
    // same layout instead of maintaining separate copies that can drift.
    const receiptHTML = buildReceiptHTML(receipt, qrDataUrl, qrCaption)
    printReceiptHTML(
      receiptHTML,
      () => { setPrinted(true); toast.success('تم إرسال الإيصال للطباعة') },
      () => toast.error('تعذر فتح نافذة الطباعة — تأكد من تعريف الطابعة على الجهاز')
    )
  }

  const handleOpenDrawer = () => {
    // Most thermal printers with attached cash drawer open it automatically
    // as part of every print job (hardware/driver feature).
    toast.info('أغلب الطابعات الحرارية بتفتح الدرج تلقائيًا مع كل عملية طباعة')
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-brand-purple">
            <CheckCircle className="w-6 h-6 text-green-500" />
            تمت الفاتورة بنجاح
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Success banner — branded gradient */}
          <div className="text-center p-4 bg-brand-gradient rounded-xl text-primary-foreground">
            <p className="font-bold text-xl pos-number">{receipt.invoiceNumber}</p>
            <p className="text-sm opacity-90 pos-number">{formatEGP(receipt.total)}</p>
            {receipt.loyaltyEarned > 0 && (
              <p className="text-xs mt-1 opacity-80">+ {receipt.loyaltyEarned} نقطة ولاء</p>
            )}
          </div>

          {/* QR code preview */}
          {qrDataUrl && (
            <div className="flex justify-center">
              <div className="text-center">
                <img src={qrDataUrl} alt="QR Code" className="w-24 h-24 mx-auto border border-border rounded-lg" />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {sale.customerId ? 'امسح لعرض رصيد نقاطك' : 'امسح لتسجيل حساب واكتساب نقاط الولاء'}
                </p>
              </div>
            </div>
          )}

          {/* Receipt preview — mirrors the printable thermal layout */}
          <div className="border-2 border-dashed border-border rounded-2xl p-4 max-h-72 overflow-y-auto bg-white text-black" dir="rtl">
            {receipt.store.showLogo && receipt.store.logo && (
              <div className="flex justify-center mb-3">
                <img src={receipt.store.logo} alt="شعار المتجر" className="max-w-[140px] max-h-[70px] object-contain" />
              </div>
            )}
            <div className="text-center font-extrabold text-lg">{receipt.store.name}</div>
            {receipt.store.address && <div className="text-center text-[10px] text-gray-500 mt-0.5">{receipt.store.address}</div>}
            {receipt.store.phone && <div className="text-center text-[10px] text-gray-500">هاتف: {receipt.store.phone}</div>}
            <div className="border-y border-dashed border-gray-400 my-3 py-2 text-[10px] space-y-1">
              <div className="flex justify-between"><span>رقم الفاتورة</span><span className="font-bold pos-number">{receipt.invoiceNumber}</span></div>
              <div className="flex justify-between"><span>التاريخ</span><span>{formatDateTime(receipt.date)}</span></div>
              <div className="flex justify-between"><span>الكاشير</span><span>{receipt.cashier}</span></div>
              {receipt.customer && <div className="flex justify-between"><span>العميل</span><span>{receipt.customer.name}</span></div>}
            </div>
            <div className="grid grid-cols-[1fr_55px_70px] gap-1 text-[9px] font-bold border-b border-black pb-1">
              <span>الصنف</span><span className="text-left">الكمية</span><span className="text-left">الإجمالي</span>
            </div>
            <div className="divide-y divide-dotted divide-gray-300">
              {receipt.items.map((item, i: number) => (
                <div key={i} className="py-1.5">
                  <div className="text-[10px] font-bold truncate">{item.product?.nameAr || item.product?.name || item.productName || 'منتج'}</div>
                  <div className="grid grid-cols-[1fr_55px_70px] gap-1 text-[9px]">
                    <span></span><span className="text-left pos-number">{item.quantity} × {formatEGP(item.unitPrice)}</span><span className="text-left pos-number font-bold">{formatEGP(item.total)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-[10px] space-y-1">
              <div className="flex justify-between"><span>المجموع الفرعي</span><span className="pos-number">{formatEGP(receipt.subtotal)}</span></div>
              {receipt.discountAmount > 0 && <div className="flex justify-between text-green-600"><span>الخصم</span><span className="pos-number">- {formatEGP(receipt.discountAmount)}</span></div>}
              {receipt.taxAmount > 0 && <div className="flex justify-between"><span>الضريبة</span><span className="pos-number">{formatEGP(receipt.taxAmount)}</span></div>}
              <div className="flex justify-between font-extrabold text-sm border-2 border-black rounded px-2 py-1.5"><span>الإجمالي</span><span className="pos-number">{formatEGP(receipt.total)}</span></div>
            </div>
            <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-[10px]">
              <div className="flex justify-between"><span>طريقة الدفع</span><span>{receipt.paymentMethod === 'CASH' ? 'نقدي' : receipt.paymentMethod === 'CARD' ? 'بطاقة' : receipt.paymentMethod}</span></div>
              <div className="flex justify-between"><span>المدفوع</span><span className="pos-number">{formatEGP(receipt.paidAmount)}</span></div>
              {receipt.changeAmount > 0 && <div className="flex justify-between"><span>الباقي</span><span className="pos-number">{formatEGP(receipt.changeAmount)}</span></div>}
            </div>
            {receipt.store.receiptFooter && <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-center text-[9px] text-gray-500">{receipt.store.receiptFooter}</div>}
          </div>

          {/* Action buttons — branded */}
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handlePrint} className="h-12 bg-brand-gradient hover:opacity-90">
              <Printer className="w-4 h-4 ml-2" />
              طباعة الإيصال
            </Button>
            <Button variant="outline" onClick={handleOpenDrawer} className="h-12 hover:border-primary hover:text-primary">
              <Wallet className="w-4 h-4 ml-2" />
              فتح الدرج
            </Button>
          </div>

          {printed && (
            <p className="text-xs text-center text-green-600 flex items-center justify-center gap-1">
              <CheckCircle className="w-3 h-3" />
              تم الإرسال للطابعة الحرارية
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full hover:border-primary hover:text-primary">
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
