/**
 * "What's New" changelog — shown to the user once after the installed app
 * version changes (offline-friendly: it only compares the built-in
 * {@link __APP_VERSION__} against the last version the user has acknowledged,
 * stored locally). No network access involved.
 *
 * To announce a release: add an entry at the TOP of {@link RELEASES} with the
 * new version, date, and a few highlights. Keep the newest first.
 */

export type ReleaseTone = "feature" | "fix" | "improvement";

export interface ReleaseHighlight {
  /** Short headline (Arabic). */
  title: string;
  /** One-line explanation (Arabic). */
  description: string;
  /** Visual category — drives the badge colour/label. */
  tone: ReleaseTone;
}

export interface Release {
  /** Semver string, e.g. "3.3.4". Must match package.json at ship time. */
  version: string;
  /** Display date (Arabic month is fine). */
  date: string;
  highlights: ReleaseHighlight[];
}

/** Newest release first. */
export const RELEASES: Release[] = [
  {
    version: "6.0.2",
    date: "يونيو 2026",
    highlights: [
      {
        title: "تبسيط مميزات الفواتير",
        description: "تم إزالة خيارات مكررة من المميزات مثل نوع السعر لكل صنف وتخصيص طباعة الفواتير، مع إبقاء اختيار نوع السعر العام ونص ذيل الفاتورة بشكل مباشر.",
        tone: "improvement",
      },
      {
        title: "تنظيف License Studio",
        description: "قائمة مفاتيح التراخيص أصبحت أوضح بعد حذف المميزات غير المستخدمة من الباقات.",
        tone: "improvement",
      },
    ],
  },
  {
    version: "6.0.1",
    date: "يونيو 2026",
    highlights: [
      {
        title: "تحسين حفظ الفواتير PDF",
        description: "نسخة PDF أصبحت تعتمد على نفس تخطيط الطباعة الحالي للحفاظ على المقاسات والهوامش واتجاه العربية.",
        tone: "fix",
      },
      {
        title: "تحديث نظام الباقات المدفوعة",
        description: "تم ربط مميزات واتساب، التحليلات، الموظفين، التنبيهات المتقدمة، الأمان، الباركود، أسعار البيع، تخصيص الطباعة، والصلاحية بالترخيص.",
        tone: "improvement",
      },
      {
        title: "تحديث License Studio",
        description: "مولّد التراخيص الخارجي أصبح يحتوي نفس مفاتيح المميزات الموجودة داخل التطبيق عند إصدار السيريالات.",
        tone: "improvement",
      },
    ],
  },
  {
    version: "6.0.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "الإصدار المستقر السادس للبرنامج (Stable Release v6)",
        description: "إصدار مستقر مُختبَر بالكامل: 740 اختبار وحدة وتكامل كلها ناجحة — أعلى مستوى استقرار حتى الآن.",
        tone: "feature",
      },
      {
        title: "جميع المميزات قابلة للتحكّم من الإعدادات",
        description: "كل ميزة في النظام (واتساب، تخصيص التنبيهات، الوضع المظلم، التحليلات، وغيرها) أصبحت مدفوعة وقابلة للتفعيل/الإيقاف بحسب باقة العميل.",
        tone: "feature",
      },
      {
        title: "إرسال الفواتير عبر واتساب بقالب قابل للتخصيص",
        description: "تقدر ترسل أي فاتورة للعميل أو المورد عبر واتساب برسالة جاهزة — والقالب قابل للتعديل بالكامل من الإعدادات مع وسوم ذكية (اسم العميل، الإجمالي، المتبقي...).",
        tone: "feature",
      },
      {
        title: "تخصيص بطاقات صفحة التنبيهات",
        description: "صفحة التنبيهات بقت قابلة للتخصيص: اختر البطاقات اللي تهمك (نفاد مخزون، فواتير متأخرة، رصيد دائن...) ورتّبها بالسحب والإفلات.",
        tone: "feature",
      },
      {
        title: "نظام باقات وتراخيص متكامل",
        description: "كل ميزة مربوطة بباقة الترخيص — الأساسية، الاحترافية، أو الكاملة. المالك يقدر يتحكم في الوحدات الظاهرة من شاشة الإعدادات.",
        tone: "feature",
      },
      {
        title: "نسخ احتياطي تلقائي عند إغلاق البرنامج",
        description: "ميزة جديدة تحفظ نسخة احتياطية كاملة تلقائياً في المجلد المحدد قبل إغلاق التطبيق — بياناتك دائماً في أمان.",
        tone: "feature",
      },
      {
        title: "قفل الجلسة التلقائي عند عدم النشاط",
        description: "تقدر تحدد وقت (5 / 10 / 15 / 30 / 60 دقيقة) وبعدها النظام يقفل الشاشة تلقائياً لحماية بياناتك.",
        tone: "feature",
      },
      {
        title: "نص ذيل الفاتورة المخصّص",
        description: "أضف نص مخصّص يظهر أسفل كل فاتورة مطبوعة — ملاحظات، شروط، أو شكر للعميل.",
        tone: "improvement",
      },
      {
        title: "تحسين واجهة إعدادات الاشتراك والضمان",
        description: "بطاقات الاشتراك والضمان أصبحت أوضح مع عرض تفصيلي للأيام المتبقية، والباقة الحالية، ونسخ كود الجهاز بضغطة واحدة.",
        tone: "improvement",
      },
      {
        title: "تجديد الاشتراك أو ترقية الباقة من داخل البرنامج",
        description: "نافذة مخصّصة لتجديد الاشتراك أو تفعيل الضمان أو الترقية — أرسل طلبك عبر واتساب والصق السيريال الجديد مباشرة.",
        tone: "improvement",
      },
    ],
  },
  {
    version: "5.0.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "الإصدار المستقر الخامس للبرنامج (Stable Release v5)",
        description: "إصدار مستقر مُختبَر بالكامل: 701 اختبار وحدة وتكامل + 5 اختبارات شاملة (E2E) كلها ناجحة.",
        tone: "feature",
      },
      {
        title: "الدفع بالرصيد الدائن ضمن وسائل الدفع",
        description: "رصيد العميل الدائن بقى يظهر كزر مباشر ضمن وسائل الدفع في فاتورة البيع — اضغطه ليُخصم تلقائياً من قيمة الفاتورة.",
        tone: "improvement",
      },
      {
        title: "إدارة الموظفين بدون حسابات نظام + كشف حساب مطبوع",
        description: "شاشة جديدة لإضافة الموظفين (الاسم، رقم البطاقة، الراتب الأساسي) وتسجيل الرواتب والسلف والحوافز والخصومات، مع كشف حساب تفصيلي قابل للطباعة والتصدير لـ Excel ومتابعة السلف المعلَّقة.",
        tone: "feature",
      },
      {
        title: "إعادة تصميم كشف الحساب وصندوق مبالغ الفاتورة",
        description: "كشف حساب العملاء والموردين بمصطلحات أوضح (على العميل / للعميل) بدل مدين/دائن، وصندوق مبالغ الفاتورة بات يعرض الخصم والمرتجعات والدفعات والمتبقي بشكل مفصَّل.",
        tone: "improvement",
      },
      {
        title: "تنبيه قابل للضبط لقرب انتهاء الصلاحية",
        description: "تقدر تحدد عدد الأيام قبل انتهاء صلاحية المنتج لظهور التنبيه (7 / 14 / 30 / 60 / 90 يوم) من الإعدادات بدل الرقم الثابت السابق.",
        tone: "improvement",
      },
      {
        title: "إصلاح الشاشة البيضاء بعد استرداد البيانات",
        description: "تم حل مشكلة تعليق النظام (شاشة بيضاء) بعد استرداد نسخة احتياطية، مع دعم استرداد ملفات .hwbak المشفّرة.",
        tone: "fix",
      },
    ],
  },
  {
    version: "4.0.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "الإصدار المستقر الرابع للبرنامج (Stable Release v4)",
        description: "تحسينات شاملة وتجربة مستخدم أفضل.",
        tone: "feature",
      },
      {
        title: "تحسينات سجل النشاط والمخزون",
        description: "تغيير مسمى سجل التدقيق إلى سجل النشاط (ميزة إضافية). وتم إضافة فلاتر جديدة في المخزون (صالح ومتوفر).",
        tone: "improvement",
      },
      {
        title: "الوضع الليلي متاح الآن كإضافة مدفوعة",
        description: "تم إضافة الوضع المظلم كـ Feature يمكن تفعيلها للعملاء عن طريق الـ License Studio.",
        tone: "feature",
      },
      {
        title: "إصلاحات في الوضع المظلم وتحسينات واجهة المستخدم",
        description: "إصلاح ألوان بطاقات الاشتراك والتحليلات وإضافة أيقونات التواصل للشركة بشكل متناسق مع الوضع المظلم.",
        tone: "fix",
      },
    ],
  },
  {
    version: "3.8.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "الوضع الليلي (Dark Mode)",
        description: "وضع ليلي احترافي كامل للنظام مع 3 خيارات: فاتح، داكن، أو تلقائي حسب إعدادات الجهاز. كل الشاشات والمكونات تدعم الوضع الليلي بألوان مريحة للعين.",
        tone: "feature",
      },
      {
        title: "نظام ألوان ذكي (Design Tokens)",
        description: "تحويل كامل لنظام الألوان إلى رموز ذكية (tokens) تضمن تناسق الألوان في كل الشاشات — والطباعة تبقى دائماً بالوضع الفاتح.",
        tone: "improvement",
      },
    ],
  },
  {
    version: "3.7.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "صفحة المساعدة والأسئلة الشائعة",
        description: "صفحة مساعدة جديدة بتشرح استخدام كل جزء في النظام، مع بحث سريع ومرجع لمعاني التنبيهات والأخطاء وحلولها — وزر تواصل مباشر مع الدعم.",
        tone: "feature",
      },
    ],
  },
  {
    version: "3.6.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "لوحة التحليلات المتقدمة",
        description: "تحليلات احترافية جديدة: تصنيف ABC للأصناف، معدّل دوران المخزون، المنتجات الراكدة، ربحية العملاء، واتجاه المبيعات الشهري. (ميزة ضمن الباقات المدفوعة)",
        tone: "feature",
      },
      {
        title: "توحيد مصطلح الدفع إلى «كاش»",
        description: "تم استبدال «نقدي/نقداً» بكلمة «كاش» في كل شاشات الدفع والمرتجعات لتوضيح أكبر ومنع اللبس.",
        tone: "improvement",
      },
    ],
  },
  {
    version: "3.5.1",
    date: "يونيو 2026",
    highlights: [
      {
        title: "فصل تعديل الفاتورة عن التحصيل",
        description: "تعديل فاتورة البيع بعد الدفع أصبح يحتفظ بالمبلغ المدفوع كما هو — أي فرق يُحصَّل عبر «تسجيل دفعة» بشكل مستقل.",
        tone: "improvement",
      },
      {
        title: "تطبيع تلقائي للقطع عند الحفظ",
        description: "لو كمية القطع المفردة تساوي كرتونة أو أكثر، النظام يحوّلها لكراتين تلقائياً ويُشعرك بالتفاصيل.",
        tone: "improvement",
      },
      {
        title: "تصحيح رصيد العميل عند الإلغاء",
        description: "إلغاء فاتورة مدفوعة كاش كان يترك رصيداً خاطئاً على حساب العميل — تم تصحيحه.",
        tone: "fix",
      },
      {
        title: "تحسينات على دقة الحسابات المالية",
        description: "تحسينات تضمن دقة أرصدة الموردين والمدفوعات وكميات المخزون في كل العمليات.",
        tone: "fix",
      },
    ],
  },
  {
    version: "3.5.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "بحث شامل سريع (Ctrl+K)",
        description: "ابحث في المنتجات والعملاء والموردين والفواتير وعروض الأسعار من أي مكان في النظام بضغطة واحدة.",
        tone: "feature",
      },
      {
        title: "حماية النسخ الاحتياطية بالتشفير",
        description: "ملفات النسخ الاحتياطية أصبحت مشفّرة بالكامل — بياناتك آمنة حتى لو وصل أحد للملف.",
        tone: "feature",
      },
    ],
  },
  {
    version: "3.4.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "نافذة \"ما الجديد\"",
        description: "بعد كل تحديث، النظام بيعرض لك أهم المميزات والإصلاحات الجديدة تلقائياً.",
        tone: "feature",
      },
      {
        title: "عرض سجل التحديثات في أي وقت",
        description: "اضغط على رقم الإصدار أسفل صفحة الإعدادات لمراجعة كل التحديثات السابقة.",
        tone: "improvement",
      },
    ],
  },
  {
    version: "3.3.4",
    date: "يونيو 2026",
    highlights: [
      {
        title: "رصيد العميل المتبقّي على الفاتورة",
        description: "الفاتورة وتقاريرها بتوضّح المتبقّي على العميل بشكل مباشر وأوضح.",
        tone: "feature",
      },
      {
        title: "تصحيح حساب المرتجعات التراكمي",
        description: "اتظبط حساب الإجمالي والمتبقّي بعد المرتجعات في كل المسارات.",
        tone: "fix",
      },
      {
        title: "منع إعادة استخدام رقم الفاتورة",
        description: "النظام بيرفض تكرار رقم فاتورة اتحذف قبل كده — حماية من التعارض.",
        tone: "fix",
      },
    ],
  },
  {
    version: "3.2.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "تطوير شامل للتقارير",
        description: "ملخص مبيعات الفترة (صافي/محصّل/متبقّي/ربح) وبطاقات إجمالية للمخزون.",
        tone: "improvement",
      },
      {
        title: "إصلاح المرتجعات عند التعديل",
        description: "المرتجع مابيخرّبش حسابات الفاتورة عند تعديلها بعد كده.",
        tone: "fix",
      },
    ],
  },
  {
    version: "3.1.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "حزم الترخيص وتخصيص الوحدات",
        description: "التحكم في الوحدات المتاحة لكل عميل، وإظهار/إخفاء أي وحدة من الإعدادات.",
        tone: "feature",
      },
      {
        title: "تجديد وترقية الاشتراك من داخل البرنامج",
        description: "تنبيه مبكر قبل انتهاء الاشتراك مع تفعيل الترقية مباشرة.",
        tone: "feature",
      },
    ],
  },
  {
    version: "3.0.0",
    date: "يونيو 2026",
    highlights: [
      {
        title: "معالج الإعداد الأولي",
        description: "5 خطوات لتجهيز النظام من أول تشغيل، مع شاشة ترحيب.",
        tone: "feature",
      },
      {
        title: "نسخ مخصّصة للعملاء",
        description: "اسم الشركة والشعار مجهّزين مسبقاً في المثبّت لكل عميل.",
        tone: "feature",
      },
    ],
  },
];

/**
 * Compare two semver-ish strings ("3.3.4"). Returns >0 if a>b, <0 if a<b, 0 if
 * equal. Missing/extra segments are treated as 0, and non-numeric junk is
 * ignored so a malformed stored value can never throw.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? "0", 10) || 0;
    const nb = parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Releases strictly newer than {@param sinceVersion} (exclusive). When
 * {@param sinceVersion} is null/empty (fresh install) returns [] — nothing to
 * announce on a first run. Order preserved (newest first).
 */
export function releasesSince(sinceVersion: string | null): Release[] {
  if (!sinceVersion) return [];
  return RELEASES.filter((r) => compareVersions(r.version, sinceVersion) > 0);
}
