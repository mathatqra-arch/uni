# Uni Kasher 2.0.9 — Production Release Guide

## الهوية

- الاسم: **Uni Kasher**
- المعرف: `com.unikasher.pos`
- حزمة Rust: `uni-kasher-pos`
- نظام التشغيل المستهدف: Windows Desktop / Tauri 2

### ألوان العلامة

- `#F5EFE2` — Cream / الخلفية الأساسية
- `#E8E5A4` — Soft Yellow / إبراز ثانوي
- `#D44D5C` — Coral / الإجراء الأساسي
- `#772344` — Burgundy / اللون العميق
- `#160029` — Plum / التباين والـSidebar

## أوامر الإنتاج على Windows

من مجلد المشروع:

```powershell
npm install
npm run typecheck
npm run lint
npm run test
npm run verify
npm run verify:sqlite
npm run verify:atomicity
npm run verify:cash-integrity
npm run verify:idempotency-recovery
npm run verify:runtime-integrity
npm run build
```

ثم بناء برنامج Tauri/NSIS:

```powershell
npm run tauri:build:windows
```

أو بشكل مباشر:

```powershell
npx tauri build --bundles nsis
```

إذا كان الجهاز يستخدم أكثر من Rust target، يمكن تحديد Windows MSVC صراحة:

```powershell
npx tauri build --bundles nsis --target x86_64-pc-windows-msvc
```

## مكان الـEXE

بعد نجاح البناء، ابحث عن ملف التثبيت تحت:

```text
src-tauri\target\release\bundle\nsis\
```

ويكون عادةً اسم الملف قريبًا من:

```text
Uni Kasher_2.0.9_x64-setup.exe
```

استخدم اسم الملف الفعلي الناتج من مجلد `bundle/nsis` ولا تعتمد على الاسم كمُعرّف ثابت.

## فحص ما قبل المشاركة

1. ثبّت الـEXE على جهاز Windows نظيف أو مستخدم Windows جديد.
2. شغّل البرنامج وتأكد من ظهور **Uni Kasher** في العنوان والاختصار وواجهة التفعيل.
3. اختبر: Register → فتح الخزنة بصفر → بيع → مرتجع → سحب/إيداع → شراء → إغلاق الخزنة → Backup → Restore.
4. أغلق البرنامج وأعد فتحه، وتأكد أن البيانات موجودة ولم تتكرر أي عملية.
5. احتفظ بنسخة من الـEXE وSHA-256 لكل إصدار منشور.

## ملاحظة الترخيص

الهوية الجديدة تستخدم `com.unikasher.pos` و`UNIKASHER1` وتخزين Windows Registry جديد تحت `Software\UniKasher\POS\License`. لذلك أكواد ترخيص NexFlow القديمة لن تُقبل تلقائيًا في Uni Kasher؛ يجب إصدار أكواد Uni Kasher الجديدة لنفس نظام التوقيع.


## Licensing

Public-key SHA-256 fingerprint for Uni Kasher 2.0.9: `1217f66343bf03adb537b99c3951cc42a3a5fc7639b9049f4aa23f06221af784`. Keep the private signing key outside the release tree.
