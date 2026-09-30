# Uni Kasher Key Manager (Tauri Desktop)

برنامج سطح مكتب حقيقي (Tauri 2) لتوليد وإدارة مفاتيح ترخيص Uni Kasher.

## التشغيل
1. ضع ملف `unikasher-private.key` بجوار `uni-kasher-key-manager.exe`
   (أو استخدم متغير البيئة `UK_PRIVATE_KEY` للمسار الكامل).
2. شغّل `uni-kasher-key-manager.exe`.

## البناء من المصدر
```powershell
cd tools\key-manager-tauri
cargo build --release
# الناتج: target\release\uni-kasher-key-manager.exe
```

## بناء مثبت NSIS (اختياري)
```powershell
cargo tauri build   # لو مثبت @tauri-apps/cli عالميًا
```

## الأمان
- المفتاح الخاص لا يُوزع مع النسخة ولا يُرفع لأي مكان.
- التوقيع Ed25519 بنفس المفتاح العام المدموج في uni-kasher-pos.exe.
- السجل: keys.db داخل AppData\com.unikasher.keymanager