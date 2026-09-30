'use client'

import { logger } from '../../lib/logger'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Printer, Download, QrCode } from 'lucide-react'
import { toast } from 'sonner'
import type { Product } from '@/lib/types'
import { printHtmlDocument } from '@/lib/print-utils'

  const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char] as string))

interface QRCodeDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  product: Product
}

export function QRCodeDialog({ open, onOpenChange, product }: QRCodeDialogProps) {
  const [qrUrl, setQrUrl] = useState<string>('')
  const [size, setSize] = useState(256)
  

  const generateQR = async () => {
    if (!product) return
    // QR data contains product info: barcode, name, price
    const qrData = JSON.stringify({
      type: 'BEAUTY_PRODUCT',
      id: product.id,
      barcode: product.barcode || product.sku,
      name: product.nameAr || product.name,
      price: product.sellingPrice,
      sku: product.sku,
    })

    try {
      const url = await QRCode.toDataURL(qrData, {
        width: size,
        margin: 2,
        color: { dark: '#1a1a1a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setQrUrl(url)
    } catch (e) {
      logger.error(`QR generation error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  useEffect(() => {
    if (open && product) {
      generateQR()
    }
  }, [open, product, size])

  const handleDownload = () => {
    if (!qrUrl) return
    const link = document.createElement('a')
    link.href = qrUrl
    link.download = `qr-${product?.sku || 'product'}.png`
    link.click()
    toast.success('تم تحميل QR Code')
  }

  const handlePrint = () => {
    if (!qrUrl || !product) return
    printHtmlDocument(`
      <html dir="rtl">
        <head>
          <title>QR Code - ${escapeHtml(product.nameAr || product.name)}</title>
          <style>
            * { font-family: Arial, sans-serif; }
            body { text-align: center; padding: 20px; }
            .product-name { font-size: 14px; font-weight: bold; margin: 10px 0; }
            .product-price { font-size: 18px; color: #e11d48; font-weight: bold; margin: 5px 0; }
            .product-barcode { font-size: 11px; color: #666; margin-top: 5px; }
            .product-sku { font-size: 10px; color: #999; }
            img { width: 200px; height: 200px; }
            @media print { @page { margin: 5mm; } }
          </style>
        </head>
        <body>
          <div class="product-name">${escapeHtml(product.nameAr || product.name)}</div>
          <img src="${escapeHtml(qrUrl)}" alt="QR Code" />
          <div class="product-price">${escapeHtml(product.sellingPrice.toFixed(2))} ج.م</div>
          <div class="product-barcode">${escapeHtml(product.barcode || '')}</div>
          <div class="product-sku">SKU: ${escapeHtml(product.sku)}</div>
        </body>
      </html>
    `)
  }

  if (!product) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            QR Code للمنتج
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Product info */}
          <div className="text-center bg-muted/30 rounded-lg p-3">
            <p className="font-bold">{product.nameAr || product.name}</p>
            <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
            <Badge className="mt-1">{product.sellingPrice.toFixed(2)} ج.م</Badge>
          </div>

          {/* QR Code display */}
          <div className="flex justify-center bg-white p-4 rounded-lg border">
            {qrUrl && (
              <img src={qrUrl} alt="QR Code" style={{ width: size, height: size }} />
            )}
          </div>

          {/* Size selector */}
          <div className="space-y-2">
            <Label>حجم QR Code</Label>
            <div className="flex gap-2">
              <Button
                variant={size === 200 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSize(200)}
                className="flex-1"
              >
                صغير
              </Button>
              <Button
                variant={size === 256 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSize(256)}
                className="flex-1"
              >
                متوسط
              </Button>
              <Button
                variant={size === 350 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSize(350)}
                className="flex-1"
              >
                كبير
              </Button>
            </div>
          </div>

          {/* Barcode info */}
          {product.barcode && (
            <div className="text-center text-sm text-muted-foreground">
              الباركود: <span className="font-mono pos-number">{product.barcode}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleDownload} className="ml-2">
            <Download className="w-4 h-4 ml-1" />
            تحميل
          </Button>
          <Button onClick={handlePrint} className="flex-1">
            <Printer className="w-4 h-4 ml-1" />
            طباعة QR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Bulk QR code generation for multiple products
export function BulkQRDialog({ open, onOpenChange, products }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  products: Product[]
}) {
  const handleBulkPrint = async () => {
    if (products.length === 0) return
    const qrPromises = products.map(async (p) => {
      const qrData = JSON.stringify({
        type: 'BEAUTY_PRODUCT',
        id: p.id,
        barcode: p.barcode || p.sku,
        name: p.nameAr || p.name,
        price: p.sellingPrice,
      })
      const url = await QRCode.toDataURL(qrData, { width: 200, margin: 2 })
      return { product: p, url }
    })

    const results = await Promise.all(qrPromises)

    printHtmlDocument(`
      <html dir="rtl">
        <head><title>QR Codes - Bulk Print</title>
          <style>
            * { font-family: Arial, sans-serif; }
            body { padding: 10px; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .card { text-align: center; border: 1px solid #ddd; padding: 10px; page-break-inside: avoid; }
            .name { font-size: 12px; font-weight: bold; margin: 5px 0; }
            .price { font-size: 16px; color: #e11d48; font-weight: bold; }
            .barcode { font-size: 10px; color: #666; }
            img { width: 150px; height: 150px; }
            @media print { @page { margin: 5mm; } }
          </style>
        </head>
        <body>
          <div class="grid">
            ${results.map(r => `
              <div class="card">
                <div class="name">${escapeHtml(r.product.nameAr || r.product.name)}</div>
                <img src="${escapeHtml(r.url)}" alt="QR Code" />
                <div class="price">${escapeHtml(r.product.sellingPrice.toFixed(2))} ج.م</div>
                <div class="barcode">${escapeHtml(r.product.barcode || r.product.sku)}</div>
              </div>
            `).join('')}
          </div>
        </body>
      </html>
    `)
    toast.success(`تم توليد ${products.length} QR Code`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            طباعة QR Codes متعددة
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground text-center">
            سيتم توليد QR Code لـ <span className="font-bold text-foreground">{products.length}</span> منتج
          </p>
          <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1">
            {products.slice(0, 10).map(p => (
              <div key={p.id} className="text-xs flex justify-between">
                <span className="truncate">{p.nameAr || p.name}</span>
                <span className="text-muted-foreground pos-number">{p.sellingPrice.toFixed(0)}</span>
              </div>
            ))}
            {products.length > 10 && (
              <p className="text-xs text-center text-muted-foreground">+{products.length - 10} المزيد...</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleBulkPrint} className="w-full">
            <Printer className="w-4 h-4 ml-1" />
            طباعة الكل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
