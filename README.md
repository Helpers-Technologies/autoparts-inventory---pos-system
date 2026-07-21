# AutoParts Inventory & Sales System

[![CI](https://github.com/amrhanygomaa/Inv_system/actions/workflows/ci.yml/badge.svg)](https://github.com/amrhanygomaa/Inv_system/actions/workflows/ci.yml)

تطبيق Windows Desktop مستقل لمحلات وتجار قطع غيار السيارات. يدير كتالوج السيارات وتوافق القطع والبدائل والمخزون والفواتير، ويعمل أوفلاين بقاعدة SQLite محلية مشفرة.

**Package version:** `7.0.0`

## نظرة عامة

`AutoParts Inventory & Sales System` نسخة مستقلة مملوكة لـ Helpers Technologies وموجهة لمحلات قطع غيار السيارات، وليست مشاركة في التخزين أو الترخيص مع نظام المخازن العام.

التطبيق يغطي دورة العمل من أول تعريف المنتجات والعملاء والموردين، مرورا بفواتير البيع والشراء والمرتجعات والخزينة، وصولا للتقارير والتحليلات والنسخ الاحتياطي والتراخيص.

## المميزات الأساسية

| المجال | المميزات |
| --- | --- |
| كتالوج السيارات | 387 ماركة بشعارات أوفلاين، 3,781 موديل، وتصنيف بلد/سوق المنشأ مع تخصيص نشاط المحل حسب الدول أو الماركات |
| قطع الغيار | Part Number، أرقام OEM متعددة، ماركة وجودة وحالة القطعة، مكان التركيب، الضمان، موقع الرف والبدائل |
| التوافق | ربط القطعة بأكثر من ماركة/موديل/جيل/محرك ومدى سنوات، مع دليل بحث حسب السيارة |
| المنتجات والمخزون | أسعار شراء وجملة وتجزئة، قطع وأطقم، حد أدنى، كمية إعادة طلب، وحركات مخزون |
| الاسكان | مسح موحد للباركود أو Part Number أو OEM في الكاشير والمشتريات والاستلام والجرد وإضافة المنتج |
| المبيعات | فواتير بيع، كاش وآجل، خصم، طرق دفع متعددة، رصيد دائن، دفعات لاحقة، طباعة و PDF وواتساب |
| المشتريات | فواتير شراء، سداد موردين، رصيد دائن، تحديث مخزون تلقائي، وطباعة |
| المرتجعات | مرتجعات بيع وشراء مع تحديث تلقائي للمخزون والفواتير والحسابات |
| العملاء والموردون | بيانات اتصال، أرصدة، كشوف حساب، سجل فواتير، وأرشفة واستعادة |
| السائقون | إدارة السائقين وربطهم بفواتير البيع |
| الخزينة | وارد وصادر، رصيد افتتاحي، تحصيلات، مدفوعات، وإضافات أو مصروفات يدوية |
| المستحقات | متابعة ما على العملاء وما للموردين، أرصدة دائنة، وتسويات |
| عروض الأسعار | إنشاء وتعديل وطباعة عروض أسعار وتحويلها إلى فواتير |
| الجرد الدوري | جرد كامل للمخزون، إدخال الكميات الفعلية، واعتماد الفروقات |
| التقارير | مبيعات، مشتريات، مخزون، أرصدة، عمولات، أرباح، وتصدير Excel |
| التحليلات المتقدمة | ABC، دوران المخزون، المخزون الراكد، ربحية العملاء، واتجاه المبيعات |
| المستخدمون | مالك وموظفون، صلاحيات تفصيلية، عمولات وتارجت شهري |
| النسخ الاحتياطي | نسخ يدوية وتلقائية ومشفرة بصيغة `.hwbak`، واستعادة آمنة |
| التراخيص | سيريال موقّع مرتبط بالجهاز، باقات مميزات، وتجديد أو ترقية من داخل التطبيق |

## المميزات القابلة للترخيص

توجد طبقتان للتحكم في المميزات:

1. سقف الباقة داخل السيريال الموقّع (`features`).
2. إعدادات المالك لإظهار أو إخفاء الوحدات المسموحة.

مفاتيح المميزات الحالية:

```text
salesInvoices, purchaseInvoices, quotations, returns, products, inventory,
stocktakes, alerts, customers, suppliers, drivers, cashbox, dues, reports,
employeesReport, advancedAnalytics, whatsappIntegration, darkMode, activityLog,
offlineEmployees, advancedAlerts, advancedSecurity, barcodeSystem,
multiSalePrices, creditPayment, creditSales, expiryTracking
```

## نموذج الأمان

| الطبقة | التنفيذ |
| --- | --- |
| قاعدة البيانات | SQLCipher عبر `better-sqlite3-multiple-ciphers` |
| كلمات المرور | Argon2id داخل Electron main process |
| التراخيص | Ed25519 signed tokens مرتبطة بـ machine hash |
| النسخ الاحتياطي | AES-256-GCM لملفات `.hwbak` |
| Electron | Context isolation, sandbox, no nodeIntegration, CSP, restricted preload API |
| التخزين | مفاتيح داخلية محمية، وإخفاء `passwordHash` عن الواجهة والتصدير |
| الحزمة | ASAR packaging و Electron fuses |
| الحماية من التخمين | Rate limiting لتسجيل الدخول وأكواد الدعم |

راجع [SECURITY.md](SECURITY.md) للتفاصيل والملفات التي لا يجب رفعها.

## التقنية

| الطبقة | التقنية |
| --- | --- |
| Desktop shell | Electron 39 |
| Renderer | React 19 + TypeScript 6 |
| Styling | Tailwind CSS + Radix UI + lucide-react |
| Routing | React Router v6 |
| Database | Encrypted SQLite |
| Native modules | `argon2`, `better-sqlite3-multiple-ciphers` |
| Charts | Recharts |
| Build | Vite 8 + electron-builder |
| Tests | Vitest + Playwright |

## المتطلبات

- Windows 10/11 64-bit للتطبيق النهائي.
- Node.js 22 أو أحدث للتطوير المحلي المفضل.
- npm 10 أو أحدث.
- ملف `electron/license-public-key.cjs` في بيئة التطوير أو البناء.

## التشغيل المحلي

ثبت الاعتماديات:

```bash
npm install
```

جهز مفتاح الترخيص العام المحلي:

```powershell
copy electron\license-public-key.example.cjs electron\license-public-key.cjs
```

شغل الواجهة فقط:

```bash
npm run dev
```

شغل التطبيق كاملا داخل Electron:

```bash
npm run electron:dev
```

## أوامر التطوير

```bash
npm run dev              # Vite renderer فقط
npm run electron:dev     # Vite + Electron
npm run dev:live         # تشغيل تطوير مساعد
npm run build            # TypeScript build + Vite build
npm run lint             # ESLint
npm run test             # Vitest
npm run test:watch       # Vitest watch
npm run test:coverage    # Coverage
npm run test:e2e         # Playwright E2E
npm run test:smoke:e2e   # E2E smoke subset
npm run dist:win         # Windows NSIS installer
```

## البناء النهائي

```bash
npm run dist:win
```

الناتج يظهر داخل:

```text
release/
```

اسم المثبت يعتمد على `productName` و `version` في `package.json`:

```text
AutoParts Inventory & Sales System-7.0.0-Setup.exe
```

البناء يستخدم:

- `scripts/prepare-dist-win.cjs`
- `electron-builder`
- `scripts/electron-builder-after-pack.cjs`
- `scripts/sign-win.cjs`
- شهادة توقيع Windows ببصمة `E950B2D3C22831B0EDE52E0F69D7C0C422BCBE02`

## License Studio

أدوات التفعيل موجودة في المشروع المرافق:

```text
../autoparts-license-studio/
```

أوامر متاحة من هنا:

```bash
npm run license:studio
npm run license:generate -- --help
npm run license:init
```

مثال إصدار سيريال بباقة:

```powershell
npm run license:generate -- ^
  --machine APW-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX ^
  --months 12 ^
  --warranty-months 12 ^
  --plan pro ^
  --features salesInvoices,purchaseInvoices,products,inventory,customers,suppliers,cashbox,returns,reports,dues
```

> توليد زوج مفاتيح جديد يبطّل السيريالات القديمة ويتطلب تحديث المفتاح العام وإعادة بناء التطبيق.

## بنية المشروع

```text
autoparts-inventory-system/
├── .github/      GitHub Actions و PR/Issue templates
├── build/        أيقونات التطبيق والمثبت
├── docs/         توثيق تركيب العميل
├── electron/     Electron main/preload/print/license/storage/backup
├── public/       أصول ثابتة للواجهة
├── scripts/      سكربتات البناء والتوقيع
├── src/          كود React/TypeScript
├── tests/        Unit + component + integration + e2e
└── package.json  الاعتماديات والسكريبتات وإعداد electron-builder
```

الكتالوج يُحدّث بالأمر `npm run catalog:sync`. راجع
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) لمصادر بيانات السيارات والشعارات،
و[`docs/AUTOPARTS_IMPLEMENTATION_PLAN_AR.md`](docs/AUTOPARTS_IMPLEMENTATION_PLAN_AR.md)
لخطة المنتج وقواعد القبول.

### ملفات محورية

| الملف | الغرض |
| --- | --- |
| `src/App.tsx` | تدفق التفعيل، الإعداد الأول، الدخول، والصفحات |
| `src/types/index.ts` | نماذج البيانات الرئيسية |
| `src/store/AppContext.tsx` | عمليات البيانات والحسابات والتخزين |
| `src/store/_pure.ts` | دوال حسابية خالصة ومختبرة |
| `src/lib/features.ts` | تعريف المميزات والباقات |
| `src/lib/permissions.ts` | صلاحيات المستخدمين |
| `src/lib/analytics.ts` | التحليلات المتقدمة |
| `src/lib/xlsx.ts` | كاتب Excel داخلي بدون مكتبات خارجية |
| `electron/main.cjs` | قاعدة البيانات، الترخيص، المصادقة، IPC، الطباعة، والنسخ الاحتياطي |
| `electron/preload.cjs` | `window.desktopAPI` المسموح للواجهة |

## الاختبارات

```bash
npm run lint
npm run build
npm run test
npm run test:coverage
npm run test:e2e
```

تصنيفات الاختبارات:

- `tests/unit/`: دوال `src/lib` و `src/store/_pure.ts`.
- `tests/component/`: مكونات وصفحات React داخل JSDOM.
- `tests/integration/`: تدفقات بيانات كاملة عبر الـ store و IPC mocks.
- `tests/e2e/`: تشغيل Electron عبر Playwright.

## CI

يوجد Workflow أساسي:

- `.github/workflows/ci.yml`: lint + build + coverage.
- `.github/workflows/nightly.yml`: regression suite يومي + E2E smoke.

## تركيب العميل

الدليل العربي للفنيين:

```text
docs/client-installation-guide-ar.md
```

حزمة التسليم الميداني تتضمن عادة:

- مثبت Windows.
- شهادة الناشر.
- سكربت تثبيت الشهادة.
- دليل تثبيت وتفعيل.

## ملفات حساسة

لا ترفع أو توزع عشوائيا:

- `electron/license-public-key.cjs` الحقيقي إذا كان خاصا بالتوزيع.
- `.license/`
- `*.pfx`, `*.p12`, `*.pem`, `*.key`
- قواعد بيانات العملاء.
- ملفات backup.
- سيريالات العملاء.
- `release/`, `dist/`, `coverage/`, `test-results/`.

## أول تشغيل

لا توجد بيانات دخول افتراضية. عند أول تشغيل:

1. يجب تفعيل النسخة بسيريال صالح.
2. يتم إنشاء حساب المدير.
3. يتم ضبط بيانات الشركة والخزينة ومجلدات النسخ الاحتياطي والفواتير.
4. بعدها يبدأ الاستخدام من لوحة التحكم.

## توثيق إضافي

- [../SYSTEM_OVERVIEW.md](../SYSTEM_OVERVIEW.md): وصف شامل للمنظومة كلها.
- [SECURITY.md](SECURITY.md): تفاصيل الأمان.
- [docs/client-installation-guide-ar.md](docs/client-installation-guide-ar.md): دليل تركيب العميل.
- [../autoparts-license-studio/README.md](../autoparts-license-studio/README.md): أداة التفعيل والترخيص المنفصلة.

## التواصل

| البند | التفاصيل |
| --- | --- |
| الشركة | Helpers Technologies |
| واتساب | [+201118445625](https://wa.me/201118445625) |
| الموقع | [helpers-tech.com](https://helpers-tech.com) |

## الترخيص

Proprietary. All rights reserved by Helpers Technologies.
