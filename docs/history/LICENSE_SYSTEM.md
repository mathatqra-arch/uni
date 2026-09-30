# NexFlow POS — نظام الترخيص Offline License

تمت إضافة نظام ترخيص رقمي للـ Tauri Desktop.

## الفكرة

`React/Tauri UI → Rust License Gate → Signed License → Device Binding`

البرنامج لا يعتمد على JavaScript وحده في قرار الترخيص؛ التحقق الأساسي يتم داخل Rust.

### الحماية الموجودة

- Ed25519 digital signature.
- Public key فقط داخل البرنامج.
- Private key خارج المشروع ويستخدمه صاحب NexFlow لإصدار التراخيص.
- Device ID مشتق من Windows MachineGuid.
- ربط الترخيص بالجهاز.
- تخزين الترخيص في Windows Registry تحت `HKCU\Software\NexFlow\POS\License`.
- اكتشاف إرجاع ساعة الجهاز للخلف.
- انتهاء صلاحية الترخيص.
- شاشة تفعيل قبل Login/Setup.
- Trial و Full licenses.
- البرنامج يظل Offline بعد التفعيل.

## الاستخدام

### العميل

1. يفتح البرنامج.
2. ينسخ Device ID من شاشة التفعيل.
3. يرسل Device ID لصاحب NexFlow.
4. يستلم License Code.
5. يلصق الكود ويضغط تفعيل.

### صاحب NexFlow

استخدم أداة `tools/license-generator`.

```bash
cd tools/license-generator
cargo run --release -- ../../../../nexflow-private.key DEVICE_ID 30 TRIAL "Customer Name"
```

لترخيص كامل لمدة سنة:

```bash
cargo run --release -- ../../../../nexflow-private.key DEVICE_ID 365 FULL "Customer Name"
```

> عدّل مسار private key حسب مكانه على جهازك.

## أهم قاعدة أمنية

**لا تضع `nexflow-private.key` داخل ZIP الخاص بالبرنامج، ولا داخل GitHub، ولا داخل `src-tauri`.**

لو تسرب الـ private key، يمكن لأي شخص إنشاء تراخيص صحيحة. لو فقدته، التراخيص الجديدة تحتاج مفتاحاً جديداً وسيجب تحديث الـ public key داخل التطبيق.

## ملاحظة

هذه النسخة هي Offline Signed Licensing. لا يوجد حالياً سيرفر Check-in أو Revocation Online. إضافة Online Verification يمكن عملها لاحقاً بدون تغيير فكرة التوقيع الأساسية.
