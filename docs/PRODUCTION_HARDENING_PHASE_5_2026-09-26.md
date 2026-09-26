# سجل هندسي — المرحلة 5: اتساق عقد المنتج

التاريخ: 2026-09-26
الفرع الرئيسي: `repair/production-hardening-2026-09`

## النتيجة

**PASS** — أُغلقت A06 وA07 وA08، وأصبح عقد الترخيص والباقات والإضافات المستقلة متسقًا بين تطبيق سطح المكتب وبوابة الترخيص وLicense Studio.

## المشكلات وإعادة الإثبات

### A06 — عقد نتيجة تفعيل الترخيص

- كان تدفق الواجهة المدقق يقرأ `success` بينما العقد الفعلي بين طبقة التطبيق وIPC هو `{ ok, status }`.
- أصبح مسار شاشة الترخيص يستخدم `result.ok` ويعرض `result.status.message` عند الرفض.
- أُضيف اختبار مكوّن كامل يغطي نتيجتي النجاح والفشل من الضغط على زر التطبيق حتى رسالة الواجهة.

### A07 — سلوك موعد النسخ الاحتياطي التلقائي

- النسخة الداخلية كانت تفحص الاستحقاق عند التشغيل وكل 30 دقيقة.
- النسخة إلى المجلد الخارجي كانت تفحص مرة واحدة فقط عند بدء الجلسة؛ إذا حل الموعد أثناء بقاء البرنامج مفتوحًا فلن تُنفذ النسخة.
- لا يوجد في المنفذ وعد بساعة يومية محددة؛ العقد الحقيقي هو مدة منقضية منذ آخر نسخة ناجحة.

التنفيذ:

- توحيد مؤقت الفحص في `startAutoBackupChecks`؛ فحص فوري ثم كل 30 دقيقة.
- تطبيق المؤقت نفسه على النسختين الداخلية والخارجية.
- منع تشغيل نسختين خارجيتين متداخلتين.
- إظهار التكرار الشهري المدعوم فعليًا، وشرح معنى الجدولة في الواجهة.

### A08 — اختلافات الباقات وحراسة المميزات

الإثبات قبل الإصلاح:

- `/alerts` والقائمة والجرس كانت محروسة بـ `advancedAlerts` رغم أن `alerts` ضمن Basic.
- استيراد CSV كان يفحص صلاحية الموظف فقط، ولا يفحص `dataImport` ضمن الترخيص.
- شاشة النسخ والاسترداد كانت ظاهرة عبر الرابط المباشر لغير المالك رغم أن القائمة تصنفها `ownerOnly`.
- تطبيق سطح المكتب والبوابة كانا يصنفان `mobileCompanion` و`cloudBackup` ضمن Full، بينما عقد التسعير الحالي والاستوديو يعاملانهما كإضافتين مستقلتين.

التنفيذ:

- نموذج صريح واحد داخل سطح المكتب: `basic | pro | full | standalone`.
- المصفوفة المثبتة بالاختبارات: Basic = 16، Pro = 32، Full = 42، إضافات مستقلة = 2.
- Full لا يمنح الهاتف أو السحابة؛ يجب إضافتهما صراحة إلى السيريال.
- تحديث drift guards في البوابة والاستوديو لتفشل إذا تسربت إضافة مستقلة إلى أي باقة.
- تحديث واجهة إدارة التراخيص في البوابة لعرض مجموعة «إضافات مستقلة» في الإصدار والترقية والتفاصيل.
- فتح صفحة التنبيهات الأساسية بـ `alerts` مع إبقاء أرصدة وفواتير التنبيهات المتقدمة خلف `advancedAlerts`.
- حراسة استيراد CSV في العرض وفي handlers نفسها بـ `dataImport`، وحراسة النسخ والاسترداد للمالك على مستوى المسار.
- رسائل الترقية تميز الإضافة المستقلة عن الترقية إلى باقة Full.

## الملفات الرئيسية

- `src/lib/features.ts`
- `src/lib/backupSchedule.ts`
- `src/store/AppContext.tsx`
- `src/App.tsx`
- `src/pages/AlertsPage.tsx`
- `src/pages/BackupAndRestorePage.tsx`
- `src/components/layout/ProtectedShell.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/Topbar.tsx`
- `src/components/PaidFeatureNotice.tsx`
- `tests/unit/lib/features.test.ts`
- `tests/unit/lib/backupSchedule.test.ts`
- `tests/component/LicenseAndUpdatesPage.test.tsx`
- `tests/component/BackupAndRestorePageBackupRestore.test.tsx`
- `../autoparts-license-portal/src/lib/feature-keys.cjs`
- `../autoparts-license-portal/scripts/check-features.cjs`
- `../autoparts-license-portal/src/public/app.js`
- `../autoparts-license-studio/scripts/feature-keys.cjs`
- `../autoparts-license-studio/scripts/check-features.cjs`

## إصلاح اعتمادية ظهر أثناء التحقق

اختبارات بوابة الترخيص كانت تنهي جميع assertions ثم تنهار في native cleanup على Node `24.19.0` بسبب `better-sqlite3` 11.x. تم تحديثها إلى 12.11.1، وإضافة إغلاق صريح لاتصال SQLite عند نهاية العملية. بعد الإصلاح مرت المجموعة كاملة 52/52 بدل خروج العملية بانهيار native.

## الاختبارات والأوامر

| المستودع | الأمر | النتيجة |
|---|---|---|
| Desktop | `npm run build` | PASS — Vite build؛ تحذير حجم chunk فقط |
| Desktop | `npm run typecheck:tests` | PASS |
| Desktop | `npm run lint` | PASS — 0 errors، 21 warnings معروفة |
| Desktop | `npm test` | PASS — 91 files، 1238 tests |
| Desktop | `npm run test:e2e` | PASS — 7 passed، 9 opt-in skipped |
| Portal | `npm run check-features` | PASS — 44 مفتاحًا متطابقًا |
| Portal | `npm test` | PASS — 52 tests |
| Studio | `npm run check-features` | PASS — 44 مفتاحًا متطابقًا |
| Studio | `npm run self-test` | PASS |

## أدلة الانحدار

- نجاح وفشل تفعيل السيريال: `tests/component/LicenseAndUpdatesPage.test.tsx`.
- Basic/Pro/Full والإضافات المستقلة: `tests/unit/lib/features.test.ts` و`../autoparts-license-portal/tests/package-entitlements.test.js`.
- الفحص الفوري والمتكرر للنسخ: `tests/unit/lib/backupSchedule.test.ts`.
- واجهة الجدولة وحجب CSV عند غياب الترخيص: `tests/component/BackupAndRestorePageBackupRestore.test.tsx`.
- حراسة المسارات عند غياب الميزة: `tests/component/ProtectedShell.test.tsx`.

## الـ commits

- Desktop: `0367962 fix(product): align licensing backup and route contracts`
- Portal: `9bef2d0 fix(licensing): align package and add-on contracts`
- License Studio: `45e76f0 fix(licensing): keep standalone add-ons outside packages`
- توثيق المرحلة: يُسجل SHA في commit التوثيق التالي.

## المخاطر المتبقية

- الفحص الدوري يعني أن النسخة المستحقة قد تتأخر حتى 30 دقيقة أثناء جلسة مفتوحة؛ هذا هو العقد المعروض والمختبر.
- build ما زال يبلغ عن chunk أكبر من 500 kB، وسينتقل قياس وتحسين التحميل إلى مرحلة الأداء.
- توجد 21 ملاحظة lint بلا أخطاء؛ لم تُخفَ أو تُعطّل أي قاعدة.
