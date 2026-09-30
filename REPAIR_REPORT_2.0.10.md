# Uni Kasher 2.0.10 — Repair Report

نطاق هذا الإصدار: إصلاحات فقط، بدون أي ميزة أو موديول جديد. تم اكتشاف كل بند هنا عبر تشغيل فعلي لـ `typecheck` و`lint` و`test` على الكود، وليس تخمينًا.

## 1. باج بصري مؤكد — Duplicate `className` على 3 أزرار

في `customers.tsx` (بطاقة العميل)، `inventory.tsx` (تسوية المخزون)، `suppliers.tsx` (بطاقة المورد)، كان الزر يحمل خاصية `className` مرتين:

```jsx
<Button className="ux-action-btn" ... className="w-full mt-3" ...>
```

في JSX، الخاصية الأخيرة تُلغي الأولى بالكامل — فكانت كلاس `ux-action-btn` (المسؤولة عن التناسق البصري الموحّد للأزرار في التطبيق) تُمحى فعليًا من هذه الأزرار الثلاثة. تم دمج الكلاسين في خاصية واحدة في الملفات الثلاثة.

## 2. ثغرات Type-Safety (12 موقع، صفر تغيير في السلوك الفعلي)

| الملف | المشكلة | الإصلاح |
|---|---|---|
| `dashboard.tsx` | 3 حقول (`salesByCategory`, `oldestInventory`, `deadStockCount`) يرجعها الـ backend فعليًا لكنها غير معرّفة في `interface DashboardData` | أُضيفت للـ interface — أي تغيير مستقبلي في شكل الاستجابة سيُكتشف الآن وقت الـ build |
| `desktop-app.tsx` | حالة `'error'` تُستخدم في `setSetupStatus('error')` وشاشة كاملة لعرضها، لكن نوع الـ state لم يشملها | أُضيفت `'error'` لاتحاد النوع |
| `desktop-api.ts` | `dbInitPromise` معرّف كـ `Promise<SQLiteDatabase>` رغم أن دالة التهيئة ترجع `null` صراحة عند فشل الاتصال (fallback حقيقي، ليس افتراضًا) | صُحّح النوع إلى `Promise<SQLiteDatabase \| null>` |
| `desktop-api.ts` | الوصول لـ `mod.Database` كـ fallback دفاعي غير موجود في تعريفات النوع للمكتبة | استخدم cast آمن بدون تغيير المنطق |
| `backup-crypto.ts` | توافق أنواع `Uint8Array`/`BufferSource` (تشديد TypeScript الحديث) في تشفير/فك تشفير النسخ الاحتياطية | casts آمنة، السلوك الفعلي للتشفير لم يتغير |
| `logger.ts` + `tsconfig.json` | `import.meta.env.DEV` غير معروف لغياب أنواع `vite/client`؛ و`Array.prototype.findLastIndex` يحتاج `ES2023.Array` | أُضيف `"types": ["vite/client"]` و`"ES2023.Array"` لـ `tsconfig.json` |

## 3. أخطاء Lint في ملفات `scripts/verify-*.mjs` (9 أخطاء → 0)

- إزالة escape غير ضروري لعلامة `"` داخل regex literals وtemplate literals (`verify-atomicity.mjs`, `verify-uiux-phase7.mjs`, `verify-uiux-phase8.mjs`)
- استبدال أنماط `شرط ? فعل : فعل` المستخدمة كجملة مستقلة (unused expression) بـ `if/else` مكافئ تمامًا في السلوك (`verify-idempotency-recovery.mjs`, `verify-production-hardening.mjs`)

## النتيجة النهائية

```
npx tsc --noEmit     → 0 أخطاء (كانت 12)
npx eslint .          → 0 أخطاء (كانت 9)، 776 تحذير no-explicit-any لم تُمس (تنظيف تدريجي منفصل، ليس عاجلاً)
npx vitest run        → 75/75 اختبار ناجح (بدون تغيير)
npm run build         → ناجح
```

## ملاحظة مهمة

هذا الريبو تم بناؤه (`vite build`) داخل بيئة Linux بدون Rust/Tauri toolchain، لذلك تم التأكد من نجاح بناء واجهة Vite فقط. **لم يُبنَ ملف EXE/NSIS** — لعمل ذلك يجب تشغيل:

```powershell
npm install
npm run verify:release
npm run tauri:build:windows
```

على جهاز Windows به Node.js وRust وأدوات بناء Windows وWebView2، كما هو موضح في `UNI_KASHER_RELEASE.md`.
