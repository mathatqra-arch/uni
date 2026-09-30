# Uni Kasher License Generator

أداة داخلية **لصاحب Uni Kasher فقط**. لا توزعها للعميل، ولا تضع ملف الـ private key داخل برنامج Uni Kasher أو Git.

## الاستخدام

```bash
cargo run --release -- unikasher-private.key DEVICE_ID DURATION [TRIAL|FULL] "Customer Name"
```

### المدد المتاحة

- `1h` — ساعة واحدة
- `1d` — يوم واحد
- `7d` — 7 أيام
- `30d` — 30 يومًا
- `1y` — سنة (365 يومًا)
- `lifetime` — مدى الحياة

### أمثلة

تجربة ساعة:

```bash
cargo run --release -- unikasher-private.key DEVICE_ID 1h TRIAL "Customer Name"
```

تجربة 7 أيام:

```bash
cargo run --release -- unikasher-private.key DEVICE_ID 7d TRIAL "Customer Name"
```

ترخيص سنة:

```bash
cargo run --release -- unikasher-private.key DEVICE_ID 1y FULL "Customer Name"
```

ترخيص مدى الحياة:

```bash
cargo run --release -- unikasher-private.key DEVICE_ID lifetime FULL "Customer Name"
```

> **مهم:** التراخيص الزمنية تبدأ عدّ المدة من لحظة تفعيل الكود على جهاز العميل، لأن `starts_at` يظل صفرًا والترخيص يستخدم `duration_seconds`.

## أمان المفتاح

- الـ private key هو مفتاحك الرئيسي؛ أي شخص يحصل عليه يقدر يصدر تراخيص صحيحة.
- لا تضعه داخل `src-tauri` ولا داخل `dist` ولا GitHub.
- احتفظ بنسخة احتياطية مشفرة منه.
- الترخيص هنا **Offline Signed License**: البرنامج لا يحتاج سيرفر بعد التفعيل.
- الترخيص مرتبط بـ Device ID، لذلك نفس الكود لن يعمل على جهاز آخر.


### Private key path
If `unikasher-private.key` is not in the current folder, pass the full Windows path, for example:
`unikasher-license-generator.exe "C:\\Users\\YourName\\Downloads\\unikasher-private.key" DEVICE_ID 1h TRIAL "Customer"`

The generator now reports a clear error instead of panicking when the key file is missing.
