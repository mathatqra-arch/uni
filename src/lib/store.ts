'use client'

import { create } from 'zustand'

export interface HeldSale {
  items: CartItem[]
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  loyaltyPoints: number
  discountAmount: number
  discountType: 'FIXED' | 'PERCENT' | null
  note: string
  taxExempt: boolean
  timestamp: string
}
import { persist } from 'zustand/middleware'

// Remove credentials persisted by older desktop builds. The auth store below
// is session-only and will never write the token back to localStorage.
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('pos-auth')
}

// ============ AUTH STORE ============
interface AuthUser {
  id: string
  username: string
  name: string
  role: string
  permissions: string[]
  phone?: string
  pin?: string | null
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  login: (user: AuthUser, token: string) => void
  logout: () => void
}

// Authentication state is intentionally session-only. Persisting the auth
// token in localStorage lets any injected renderer script read it. The
// desktop app re-checks the active user against SQLite on every operation,
// so credentials do not need to survive an app restart.
export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  token: null,
  login: (user, token) => set({ user, token }),
  logout: () => {
    set({ user: null, token: null })
    // Do not carry a cashier's cart/held orders into the next login or
    // application restart. POS data must be scoped to the active session.
    useCartStore.setState({
      items: [], customerId: null, customerName: null, customerPhone: null,
      loyaltyPoints: 0, loyaltyRedeem: 0, discountAmount: 0, discountType: null,
      note: '', heldSales: [], taxExempt: false
    })
    // امسح حالة الخزنة المخزّنة محليًا — خلاف كده الـ beforeunload
    // guard ممكن يفضل يحذّر بعد ما المستخدم خرج بالفعل.
    useCashSessionStore.getState().setRegisterOpen(null)
  },
}))

// ============ POS CART STORE ============
export interface CartItem {
  productId: string
  name: string
  nameAr?: string
  barcode?: string
  sku: string
  price: number
  cost: number
  taxRate: number
  quantity: number
  stock: number
  image?: string
  // "استبدال بالنقاط" — true when this line was added for free in exchange
  // for loyalty points (see pos.tsx confirmRedeemProduct). pointsCost is
  // the points already deducted PER UNIT, so quantity on this line can be
  // re-validated against the customer's remaining balance instead of
  // growing without limit via the normal +/- stepper.
  isPointsItem?: boolean
  pointsCost?: number
}

export interface CartState {
  items: CartItem[]
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  loyaltyPoints: number
  loyaltyRedeem: number
  discountAmount: number
  discountType: 'FIXED' | 'PERCENT' | null
  note: string
  heldSales: HeldSale[]
  // Per-sale tax exemption toggle (زر "تعطيل الضريبة" في نقطة البيع) — when
  // true, calcTotals() in pos.tsx zeroes taxAmount for this cart only. Resets
  // with the rest of the cart on clearCart/checkout so it never silently
  // carries over to the next customer's sale.
  taxExempt: boolean

  addItem: (item: CartItem) => void
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, qty: number) => void
  setPrice: (productId: string, price: number) => void
  clearCart: () => void
  setCustomer: (id: string | null, name: string | null, phone: string | null, points?: number) => void
  setLoyaltyRedeem: (points: number) => void
  setDiscount: (amount: number, type: 'FIXED' | 'PERCENT') => void
  setNote: (note: string) => void
  setTaxExempt: (exempt: boolean) => void
  holdSale: () => void
  retrieveHeldSale: (index: number) => void
  removeHeldSale: (index: number) => void
}

export const useCartStore = create<CartState>()(
    (set, get) => ({
      items: [],
      customerId: null,
      customerName: null,
      customerPhone: null,
      loyaltyPoints: 0,
      loyaltyRedeem: 0,
      discountAmount: 0,
      discountType: null,
      note: '',
      heldSales: [],
      taxExempt: false,

      addItem: (item) => set((state) => {
        const existing = state.items.find(i => i.productId === item.productId)
        if (existing) {
          return {
            items: state.items.map(i =>
              i.productId === item.productId
                ? { ...i, quantity: i.quantity + item.quantity }
                : i
            )
          }
        }
        return { items: [...state.items, item] }
      }),

      removeItem: (productId) => set((state) => ({
        items: state.items.filter(i => i.productId !== productId)
      })),

      updateQuantity: (productId, qty) => set((state) => ({
        items: qty <= 0
          ? state.items.filter(i => i.productId !== productId)
          : state.items.map(i => i.productId === productId ? { ...i, quantity: qty } : i)
      })),

      setPrice: (productId, price) => set((state) => ({
        items: state.items.map(i => i.productId === productId ? { ...i, price } : i)
      })),

      clearCart: () => set({
        items: [], customerId: null, customerName: null, customerPhone: null,
        loyaltyPoints: 0, loyaltyRedeem: 0, discountAmount: 0, discountType: null, note: '',
        taxExempt: false
      }),

      setCustomer: (id, name, phone, points = 0) => set({
        customerId: id, customerName: name, customerPhone: phone,
        loyaltyPoints: points, loyaltyRedeem: 0
      }),

      setLoyaltyRedeem: (points) => set({ loyaltyRedeem: points }),

      setDiscount: (amount, type) => set({ discountAmount: amount, discountType: type }),

      setNote: (note) => set({ note }),

      setTaxExempt: (exempt) => set({ taxExempt: exempt }),

      holdSale: () => {
        const state = get()
        if (state.items.length === 0) return
        set({
          heldSales: [...state.heldSales, {
            items: state.items,
            customerId: state.customerId,
            customerName: state.customerName,
            customerPhone: state.customerPhone,
            loyaltyPoints: state.loyaltyPoints,
            discountAmount: state.discountAmount,
            discountType: state.discountType,
            note: state.note,
            taxExempt: state.taxExempt,
            timestamp: new Date().toISOString()
          }],
          items: [], customerId: null, customerName: null, customerPhone: null,
          loyaltyPoints: 0, loyaltyRedeem: 0, discountAmount: 0, discountType: null, note: '',
          taxExempt: false
        })
      },

      retrieveHeldSale: (index) => {
        const state = get()
        const held = state.heldSales[index]
        if (!held) return
        set({
          items: held.items,
          customerId: held.customerId,
          customerName: held.customerName,
          customerPhone: held.customerPhone,
          loyaltyPoints: held.loyaltyPoints,
          discountAmount: held.discountAmount,
          discountType: held.discountType,
          note: held.note,
          taxExempt: held.taxExempt || false,
          heldSales: state.heldSales.filter((_, i) => i !== index)
        })
      },

      removeHeldSale: (index) => set((state) => ({
        heldSales: state.heldSales.filter((_, i) => i !== index)
      })),
    })
)

// ============ UI STORE ============
interface UIState {
  activeModule: string
  theme: 'light' | 'dark'
  sidebarOpen: boolean
  setModule: (module: string) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebar: (open: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeModule: 'dashboard',
      theme: 'light',
      sidebarOpen: true,
      setModule: (module) => set({ activeModule: module }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebar: (open) => set({ sidebarOpen: open }),
    }),
    { name: 'pos-ui' }
  )
)

// ============ CASH SESSION STORE ============
// تتبع سريع (بدون شبكة) لحالة "الخزنة مفتوحة ولا لأ" — بيتحدّث كل
// مرة حد يجيب حالة الخزنة من السيرفر أو يفتحها/يقفلها. الهدف: نقدر
// نحذّر المستخدم لو حاول يقفل التاب/يعمل رفرش والخزنة لسه مفتوحة،
// وده لازم يكون تحقق فوري (sync) وقت "beforeunload" — مينفعش ننادي
// السيرفر وقتها لأن المتصفح مش بيستنى.
interface CashSessionState {
  registerOpen: boolean | null
  setRegisterOpen: (open: boolean | null) => void
}

export const useCashSessionStore = create<CashSessionState>()((set) => ({
  registerOpen: null,
  setRegisterOpen: (open) => set({ registerOpen: open }),
}))
