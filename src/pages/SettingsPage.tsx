import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Dialog } from "../components/ui/Dialog";
import { useApp } from "../store/AppContext";
import { useToast } from "../components/ui/Toast";
import { lsGet } from "../lib/storage";
import { FEATURES, defaultFeatureState, isAllowedByLicense, type FeatureKey } from "../lib/features";
import { Save, Printer, Eye, Download, Upload, Database, FileSpreadsheet, ShieldCheck, Clock, Image as ImageIcon, Trash2, FolderOpen, Boxes, Lock, Copy, KeyRound, MessageCircle } from "lucide-react";
import {
  DEFAULT_INVOICE_WHATSAPP_TEMPLATE,
  WHATSAPP_INVOICE_TAGS,
} from "../lib/whatsappTemplate";

const SUPPORT_WHATSAPP = "201118445625";

const PLAN_LABELS: Record<string, string> = {
  basic: "الباقة الأساسية",
  pro: "الباقة الاحترافية",
  full: "الباقة الكاملة",
  custom: "باقة مخصّصة",
};

function subscriptionDurationLabel(type: string, months: number): string {
  if (type === "lifetime") return "مدى الحياة";
  const m = Number(months) || 0;
  if (m <= 0) return "غير محددة";
  if (m % 12 === 0) {
    const y = m / 12;
    return y === 1 ? "سنة كاملة" : y === 2 ? "سنتان" : `${y} سنوات`;
  }
  return `${m} شهر`;
}

function LicenseCell({
  label,
  value,
  valueClass,
  children,
}: {
  label: string;
  value?: string;
  valueClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] text-ink-faint uppercase font-bold mb-1.5 tracking-wide">{label}</div>
      {children ?? <div className={`text-sm font-bold text-ink ${valueClass ?? ""}`}>{value}</div>}
    </div>
  );
}

function planDisplayLabel(license?: { plan?: string; features?: string[] } | null): string {
  if (!license) return "—";
  if (license.plan && PLAN_LABELS[license.plan]) return PLAN_LABELS[license.plan];
  const f = license.features;
  if (Array.isArray(f) && f.length > 0) return `${f.length} ميزة مفعّلة`;
  return "الباقة الكاملة";
}

export function SettingsPage() {
  const { settings, updateSettings, exportBackup, importBackup, backupToPath, exportToExcel, licenseStatus, activateLicense } = useApp();
  const toast = useToast();
  const [form, setForm] = useState(settings);
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [newSerial, setNewSerial] = useState("");
  const [applyingSerial, setApplyingSerial] = useState(false);
  // Transient secret for password-protected MANUAL export/restore. Never
  // persisted — lives only for the current Settings view.
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"invoice" | "whatsapp">("invoice");
  const whatsappTemplateRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setForm(settings), [settings]);

  async function copyMachineCode() {
    const code = licenseStatus?.machineCode;
    if (!code) return toast.error("كود الجهاز غير متاح");
    await navigator.clipboard.writeText(code);
    toast.success("تم نسخ كود الجهاز");
  }

  function buildLicenseRequest() {
    const code = licenseStatus?.machineCode ?? "غير متاح";
    const sub = subscriptionDurationLabel(form.subscriptionType, form.subscriptionMonths);
    const plan = planDisplayLabel(licenseStatus?.license);
    const subLeft =
      form.subscriptionType === "limited"
        ? Math.max(0, getRemainingDays(form.subscriptionStartDate, form.subscriptionMonths)) + " يوم"
        : "—";
    const war =
      form.warrantyType === "none"
        ? "بدون ضمان"
        : Math.max(0, getRemainingDays(form.warrantyStartDate, form.warrantyMonths)) + " يوم";
    return [
      "طلب تجديد / ترقية ترخيص — AutoParts Inventory & Sales System",
      "العميل: " + (form.companyNameAr || form.companyName || "—"),
      "كود الجهاز: " + code,
      "مدة الاشتراك: " + sub,
      "الباقة الحالية: " + plan,
      "المتبقي في الاشتراك: " + subLeft,
      "حالة الضمان: " + war,
      "",
      "المطلوب: (تجديد اشتراك / تمديد ضمان / ترقية باقة)",
    ].join("\n");
  }

  function openLicenseRequestWhatsapp() {
    const url = "https://wa.me/" + SUPPORT_WHATSAPP + "?text=" + encodeURIComponent(buildLicenseRequest());
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function insertWhatsappTag(tag: string) {
    const current = form.whatsappInvoiceTemplate ?? DEFAULT_INVOICE_WHATSAPP_TEMPLATE;
    const el = whatsappTemplateRef.current;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + tag + current.slice(end);

    setForm({ ...form, whatsappInvoiceTemplate: next });
    requestAnimationFrame(() => {
      const target = whatsappTemplateRef.current;
      if (!target) return;
      const cursor = start + tag.length;
      target.focus();
      target.setSelectionRange(cursor, cursor);
    });
  }

  async function applyNewSerial() {
    const serial = newSerial.trim();
    if (!serial) return toast.error("الصق السيريال أولاً");
    setApplyingSerial(true);
    const result = await activateLicense(serial);
    setApplyingSerial(false);
    if (result.ok) {
      toast.success("تم تحديث الترخيص", "تم تطبيق السيريال الجديد — الاشتراك/الضمان/الباقة محدّثة");
      setNewSerial("");
      setLicenseDialogOpen(false);
      return;
    }
    const messages: Record<string, string> = {
      expired: "السيريال منتهي الصلاحية",
      machine_mismatch: "هذا السيريال مخصص لجهاز آخر",
      clock_tampered: "تم اكتشاف تغيير غير آمن في تاريخ الجهاز",
      inactive: "السيريال غير صالح",
    };
    toast.error("فشل تطبيق السيريال", messages[result.status.state] || "السيريال غير صالح");
  }

  function save() {
    if (!form.companyNameAr?.trim()) {
      toast.error("بيانات غير مكتملة", "اسم الشركة بالعربية مطلوب");
      return;
    }
    if (!form.ownerName?.trim()) {
      toast.error("بيانات غير مكتملة", "اسم صاحب الشركة / المحل مطلوب");
      return;
    }
    if (!form.ownerPhone?.trim()) {
      toast.error("بيانات غير مكتملة", "رقم موبايل صاحب الشركة / المحل مطلوب");
      return;
    }

    const derivedLogoText = form.companyNameAr?.trim()
      ? form.companyNameAr.trim().slice(0, 2)
      : (form.companyName?.trim()
        ? form.companyName.trim().slice(0, 2).toUpperCase()
        : "AP");
    
    const updatedForm = {
      ...form,
      logoText: derivedLogoText
    };
    
    updateSettings(updatedForm);
    setForm(updatedForm);
    toast.success("تم حفظ الإعدادات");
  }

  async function backupNow() {
    const dir = form.backupPath?.trim();
    if (!dir) {
      toast.error("لم يتم تحديد مجلد", "اختر مجلد النسخ الاحتياطي أولاً");
      return;
    }
    if (dir !== settings.backupPath) updateSettings({ ...settings, backupPath: dir });
    const result = await backupToPath(dir);
    if (result.ok) {
      toast.success("تم النسخ الاحتياطي", result.path ?? dir);
      return;
    }
    const messages: Record<string, string> = {
      no_path: "لم يتم تحديد مجلد النسخ الاحتياطي",
      not_desktop: "هذه الميزة متاحة في تطبيق سطح المكتب فقط",
      path_not_found: "المجلد غير موجود أو غير متاح",
      not_authorized: "غير مصرح — سجّل الدخول كمالك",
      invalid_input: "بيانات غير صالحة",
      write_failed: "فشل الكتابة إلى المجلد",
    };
    toast.error("فشل النسخ الاحتياطي", messages[result.error ?? ""] ?? "حدث خطأ غير متوقع");
  }

  const license = licenseStatus?.license ?? null;
  const featureChecked = (key: FeatureKey) => form.features?.[key] ?? defaultFeatureState(key, license);
  const featureOn = (key: FeatureKey) => isAllowedByLicense(key, license) && featureChecked(key);
  const excelExportEnabled = featureOn("excelExport");
  const toggleFeature = (key: FeatureKey, value: boolean) =>
    setForm({ ...form, features: { ...(form.features ?? {}), [key]: value } });

  function getRemainingDays(startDate: string, months: number) {
    if (!startDate || months <= 0) return 0;
    const start = new Date(startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    const diff = end.getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  return (
    <>
      <PageHeader
        title="الإعدادات"
        description="خيارات الشركة، الطباعة، والعملة"
        actions={
          <Button onClick={save}>
            <Save className="w-4 h-4" /> حفظ الإعدادات
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="بيانات الشركة" subtitle="تظهر في الفواتير وأعلى التطبيق" />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-6 mb-4">
              <div className="relative group/logo">
                <div
                  className={`w-20 h-20 rounded-2xl border-4 border-surface shadow-lg overflow-hidden flex items-center justify-center text-2xl ${
                    form.logoImage ? "bg-surface" : "bg-gradient-to-br from-brand-600 to-brand-800 text-white font-bold"
                  }`}
                >
                  {form.logoImage ? (
                    <img src={form.logoImage} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    form.logoText || "HD"
                  )}
                </div>
                {form.logoImage && (
                  <button
                    onClick={() => setForm({ ...form, logoImage: "" })}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full shadow-md flex items-center justify-center opacity-0 group-hover/logo:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="text-sm font-bold text-ink">شعار الشركة</div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setForm({ ...form, logoImage: reader.result as string });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" className="gap-2">
                      <ImageIcon className="w-4 h-4" /> رفع صورة
                    </Button>
                  </div>
                  {!form.logoImage && (
                    <div className="text-[10px] text-ink-faint">
                      سيتم استخدام الحرفين الأولين من اسم الشركة في حال عدم رفع صورة
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="اسم الشركة بالعربية" required>
                <Input
                  value={form.companyNameAr}
                  onChange={(e) => setForm({ ...form, companyNameAr: e.target.value })}
                />
              </Field>
              <Field label="اسم الشركة بالإنجليزية">
                <Input
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="اسم صاحب الشركة / المحل" required>
                <Input
                  value={form.ownerName || ""}
                  onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                />
              </Field>
              <Field label="رقم موبايل صاحب الشركة / المحل" required>
                <Input
                  value={form.ownerPhone || ""}
                  onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="الإعدادات العامة" subtitle="العملة والتنبيهات" />
          <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4 space-y-0 items-start">
            <Field
              label="الحد الأدنى الافتراضي للمخزون"
              hint="يُستخدم كقيمة افتراضية عند إضافة منتج جديد"
            >
              <Input
                type="number"
                min={0}
                value={form.lowStockThreshold}
                onChange={(e) =>
                  setForm({ ...form, lowStockThreshold: Number(e.target.value) })
                }
              />
            </Field>

            {featureOn("creditSales") && (
              <Field
                label="مدة تنبيه تأخر السداد"
                hint="المدة التي يُعتبر بعدها المورد متأخراً في السداد فتظهر تنبيهاته"
              >
                <Select
                  value={String(form.paymentTermDays ?? 7)}
                  onChange={(e) => setForm({ ...form, paymentTermDays: Number(e.target.value) })}
                >
                  <option value="7">أسبوع (7 أيام)</option>
                  <option value="14">أسبوعين (14 يوم)</option>
                  <option value="30">شهر (30 يوم)</option>
                  <option value="60">شهرين (60 يوم)</option>
                  <option value="90">ثلاثة أشهر (90 يوم)</option>
                </Select>
              </Field>
            )}

            {featureOn("expiryTracking") ? (
              <Field
                label="تنبيه قرب انتهاء الصلاحية"
                hint="عدد الأيام قبل انتهاء الصلاحية لعرض تنبيه — ينطبق على صفحة التنبيهات"
              >
                <Select
                  value={String(form.expiryAlertDays ?? 14)}
                  onChange={(e) => setForm({ ...form, expiryAlertDays: Number(e.target.value) })}
                >
                  <option value="7">7 أيام</option>
                  <option value="14">14 يوم (افتراضي)</option>
                  <option value="30">30 يوم</option>
                  <option value="60">60 يوم</option>
                  <option value="90">90 يوم</option>
                </Select>
              </Field>
            ) : (
              <PaidFeatureNotice title="متابعة صلاحية المنتجات" />
            )}

            {featureOn("advancedSecurity") ? (
              <Field label="قفل الجلسة بعد عدم النشاط" hint="عدد الدقائق قبل قفل الشاشة تلقائياً — 0 لتعطيل الميزة">
                <Select
                  value={String(form.idleLockMinutes ?? 0)}
                  onChange={(e) => setForm({ ...form, idleLockMinutes: Number(e.target.value) })}
                >
                  <option value="0">معطّل</option>
                  <option value="5">5 دقائق</option>
                  <option value="10">10 دقائق</option>
                  <option value="15">15 دقيقة</option>
                  <option value="30">30 دقيقة</option>
                  <option value="60">ساعة كاملة</option>
                </Select>
              </Field>
            ) : (
              <PaidFeatureNotice title="قفل الشاشة والأمان المتقدم" />
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4 text-brand-600" />
                <span>المميزات والوحدات</span>
              </div>
            }
            subtitle="تحكّم في الوحدات الظاهرة للعميل — الوحدات المقفولة في الباقة لا يمكن تفعيلها"
          />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {FEATURES.map((f) => {
                const allowed = isAllowedByLicense(f.key, license);
                const checked = allowed && featureChecked(f.key);
                return (
                  <label
                    key={f.key}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      allowed
                        ? "border-line hover:bg-surface-muted cursor-pointer"
                        : "border-line-soft bg-surface-muted/60 cursor-not-allowed"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      disabled={!allowed}
                      onChange={(e) => toggleFeature(f.key, e.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                        {f.label}
                        {!allowed && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded px-1.5 py-0.5">
                            <Lock className="w-3 h-3" /> غير متاح في الباقة
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-faint mt-0.5">{f.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-ink-faint">
              إخفاء وحدة هنا يزيلها من القائمة الجانبية ويمنع الوصول إليها. الباقة المرتبطة بالسيريال
              تحدّد الوحدات المتاحة أصلاً، ولا يمكن تجاوزها من هنا.
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="إعدادات الفاتورة" subtitle="تنسيق الفاتورة ومشاركتها" />
          <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="مقاس الورق">
              <Select
                value={form.printPaperSize}
                onChange={(e) =>
                  setForm({ ...form, printPaperSize: e.target.value as "A4" | "A5" })
                }
              >
                <option value="A4">A4</option>
                <option value="A5">A5</option>
              </Select>
            </Field>

            <Field label="مجلد حفظ الفواتير (PDF)" className="md:col-span-2">
              <div className="flex gap-2">
                <Input
                  value={form.invoicesSavePath}
                  readOnly
                  placeholder="اختر مجلداً..."
                  className="bg-surface-muted"
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (window.desktopAPI?.setup?.selectDirectory) {
                      const path = await window.desktopAPI.setup.selectDirectory();
                      if (path) setForm({ ...form, invoicesSavePath: path });
                    }
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </Field>
            
            <Field label="نص ذيل الفاتورة" className="md:col-span-3">
              <Textarea
                rows={3}
                value={form.invoiceFooter}
                onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })}
              />
            </Field>
            
            {featureOn("whatsappIntegration") ? (
              <Field
                label="قالب رسالة واتساب للفواتير"
                hint="اضغط على أي وسم لإضافته داخل الرسالة في مكان المؤشر"
                className="md:col-span-3"
              >
                <Textarea
                  ref={whatsappTemplateRef}
                  rows={7}
                  dir="rtl"
                  value={form.whatsappInvoiceTemplate ?? DEFAULT_INVOICE_WHATSAPP_TEMPLATE}
                  onChange={(e) => setForm({ ...form, whatsappInvoiceTemplate: e.target.value })}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {WHATSAPP_INVOICE_TAGS.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => insertWhatsappTag(item.tag)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-muted hover:border-brand-300 hover:text-brand-700 dark:hover:text-brand-300"
                      title={`إضافة ${item.label}`}
                    >
                      <span>{item.label}</span>
                      <code dir="ltr" className="font-mono text-[10px] text-ink">
                        {item.tag}
                      </code>
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ ...form, whatsappInvoiceTemplate: DEFAULT_INVOICE_WHATSAPP_TEMPLATE })}
                  >
                    استعادة القالب الافتراضي
                  </Button>
                </div>
              </Field>
            ) : (
              <div className="md:col-span-3">
                <PaidFeatureNotice title="التكامل مع واتساب" />
              </div>
            )}

            <div className="md:col-span-3 flex justify-start gap-2 pt-3 border-t border-line-soft">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="w-4 h-4" /> معاينة الفاتورة ورسالة الواتساب
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="إعدادات النسخ الاحتياطي التلقائي" subtitle="جدولة حفظ البيانات تلقائياً" />
          <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {!featureOn("advancedSecurity") && (
              <div className="md:col-span-3">
                <PaidFeatureNotice title="النسخ الاحتياطي التلقائي والأمان المتقدم" />
              </div>
            )}
            <Field label="تفعيل النسخ التلقائي">
              <label className="flex items-center gap-2 h-9 text-sm">
                <input
                  type="checkbox"
                  checked={featureOn("advancedSecurity") && form.autoBackupEnabled}
                  disabled={!featureOn("advancedSecurity")}
                  onChange={(e) => setForm({ ...form, autoBackupEnabled: e.target.checked })}
                />
                نعم، قم بالحفظ تلقائياً
              </label>
            </Field>
            <Field label="تكرار النسخ">
              <Select
                value={form.autoBackupFrequency}
                disabled={!featureOn("advancedSecurity") || !form.autoBackupEnabled}
                onChange={(e) =>
                  setForm({
                    ...form,
                    autoBackupFrequency: e.target.value as typeof form.autoBackupFrequency,
                  })
                }
              >
                <option value="daily">يومي</option>
                <option value="weekly">أسبوعي</option>
                <option value="monthly">شهري</option>
              </Select>
            </Field>
            <Field label="نسخة احتياطية عند إغلاق البرنامج" hint="يحفظ نسخة كاملة تلقائياً في المجلد المحدد قبل إغلاق التطبيق">
              <label className="flex items-center gap-2 h-9 text-sm">
                <input
                  type="checkbox"
                  checked={featureOn("advancedSecurity") && (form.backupOnClose ?? true)}
                  disabled={!featureOn("advancedSecurity")}
                  onChange={(e) => setForm({ ...form, backupOnClose: e.target.checked })}
                />
                نعم، احفظ نسخة عند الإغلاق
              </label>
            </Field>
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-lg p-3">
              <div className="text-xs text-blue-700 dark:text-blue-400 font-bold mb-1">آخر نسخة احتياطية:</div>
              <div className="text-sm text-blue-900 dark:text-blue-300 font-mono">
                {settings.lastBackupDate ? new Date(settings.lastBackupDate).toLocaleString("ar-EG") : "لم يتم الحفظ بعد"}
              </div>
            </div>
            <Field label="مجلد النسخ الاحتياطي (محلي / خارجي / شبكة)" className="md:col-span-2">
              <div className="flex gap-2">
                <Input
                  value={form.backupPath}
                  readOnly
                  placeholder="اختر مجلداً..."
                  className="bg-surface-muted font-mono text-xs"
                />
                <Button
                  variant="outline"
                  disabled={!featureOn("advancedSecurity")}
                  onClick={async () => {
                    if (window.desktopAPI?.backup?.selectDirectory) {
                      const path = await window.desktopAPI.backup.selectDirectory();
                      if (path) setForm({ ...form, backupPath: path });
                    } else {
                      toast.error("متاح في تطبيق سطح المكتب فقط");
                    }
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
            </Field>
            <Field label="نسخ احتياطي فوري">
              <Button
                variant="outline"
                onClick={backupNow}
                disabled={!featureOn("advancedSecurity") || !form.backupPath?.trim()}
                className="w-full justify-center"
              >
                <Database className="w-4 h-4" /> نسخ احتياطي الآن
              </Button>
            </Field>
            <div className="md:col-span-3 text-xs text-ink-faint">
              يتم حفظ نسخة كاملة من البيانات (بصيغة JSON) في المجلد المحدد. يمكن استعادتها لاحقاً عبر "استيراد نسخة احتياطية".
              عند التفعيل، تُحفظ نسخة تلقائياً عند فتح البرنامج حسب التكرار المختار.
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2 relative group">
          <CardHeader title="بيانات الاشتراك والضمان" subtitle="تفاصيل الترخيص والدعم الفني الفعلي للنسخة" />
          <CardBody className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ── Subscription ── */}
            <section className="rounded-xl bg-surface border border-brand-100 dark:border-brand-500/20 shadow-sm p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-brand-700 dark:text-brand-300 font-bold">
                  <ShieldCheck className="w-5 h-5" />
                  <span>حالة الاشتراك</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-2.5 py-1 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  نشط ومفعل
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <LicenseCell label="مدة الاشتراك" value={subscriptionDurationLabel(form.subscriptionType, form.subscriptionMonths)} />
                <LicenseCell label="الباقة الحالية" value={planDisplayLabel(licenseStatus?.license)} valueClass="text-brand-700 dark:text-brand-400" />
                <LicenseCell label="تاريخ التفعيل" value={form.subscriptionStartDate ? new Date(form.subscriptionStartDate).toLocaleDateString("ar-EG") : "غير محدد"} />
                {form.subscriptionType === "limited" && (
                  <LicenseCell label="الأيام المتبقية" valueClass="text-brand-600 dark:text-brand-400">
                    <span className="inline-flex items-center gap-1.5 text-sm font-mono font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20 px-2 py-0.5 rounded">
                      <Clock className="w-3 h-3" />
                      {Math.max(0, getRemainingDays(form.subscriptionStartDate, form.subscriptionMonths))} يوم
                    </span>
                  </LicenseCell>
                )}
              </div>

              <button
                type="button"
                onClick={copyMachineCode}
                title="اضغط لنسخ كود الجهاز"
                className="mt-auto flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-muted/60 px-3 py-2 text-[11px] font-mono text-ink-muted hover:border-brand-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
              >
                <span className="flex items-center gap-1.5 not-italic font-sans font-bold text-ink-faint">
                  <Copy className="w-3.5 h-3.5" /> كود الجهاز
                </span>
                <span dir="ltr" className="truncate">{licenseStatus?.machineCode ?? "—"}</span>
              </button>
            </section>

            {/* ── Warranty ── */}
            <section className="rounded-xl bg-surface border border-indigo-100 dark:border-indigo-500/20 shadow-sm p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold">
                  <Clock className="w-5 h-5" />
                  <span>حالة الضمان والصيانة</span>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border ${form.warrantyType === "none"
                  ? "text-ink-faint bg-surface-muted border-line-soft"
                  : "text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20"}`}>
                  <span className={`w-2 h-2 rounded-full ${form.warrantyType === "none" ? "bg-slate-400" : "bg-indigo-500"}`} />
                  {form.warrantyType === "none" ? "غير مفعل" : "تحت الضمان الساري"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <LicenseCell label="مدة الضمان" value={form.warrantyType === "none" ? "بدون ضمان" : `${form.warrantyMonths} شهر (صيانة برمجية)`} />
                {form.warrantyType === "limited" && (
                  <LicenseCell label="تاريخ البدء" value={form.warrantyStartDate ? new Date(form.warrantyStartDate).toLocaleDateString("ar-EG") : "غير محدد"} />
                )}
                <LicenseCell label="نوع الدعم" value={form.warrantyType === "none" ? "—" : "صيانة برمجية"} />
                <LicenseCell label="الأيام المتبقية">
                  <span className={`inline-flex items-center gap-1.5 text-sm font-mono font-bold px-2 py-0.5 rounded border ${form.warrantyType === "limited" && form.warrantyStartDate
                    ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20"
                    : "text-ink-faint bg-surface-muted border-line-soft"}`}>
                    <Clock className="w-3 h-3" />
                    {!form.warrantyStartDate && form.warrantyType === "limited" ? "تاريخ غير محدد" : (form.warrantyType === "limited" ? Math.max(0, getRemainingDays(form.warrantyStartDate, form.warrantyMonths)) : 0) + " يوم"}
                  </span>
                </LicenseCell>
              </div>
            </section>
          </CardBody>
          <div className="px-6 py-3 bg-surface-muted border-t border-line flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-ink-faint dark:text-slate-400">
              * هذه البيانات رسمية وموثقة من قبل <strong>Helpers Technologies</strong> ولا يمكن تعديلها من قبل المستخدم.
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-[10px] h-7 px-3 gap-1"
                onClick={copyMachineCode}
              >
                <Copy className="w-3 h-3" /> نسخ كود الجهاز
              </Button>
              <Button
                size="sm"
                className="text-[10px] h-7 px-3 gap-1"
                onClick={() => setLicenseDialogOpen(true)}
              >
                <KeyRound className="w-3 h-3" /> تجديد / ترقية / تفعيل ضمان
              </Button>
            </div>
          </div>
        </Card>

        <Dialog
          open={licenseDialogOpen}
          onClose={() => setLicenseDialogOpen(false)}
          title="تجديد أو ترقية أو تمديد الترخيص"
          subtitle="جدّد اشتراكك أو فعّل ضمانك أو ارقِ باقتك بدون إعادة تثبيت أو فقدان بياناتك"
          width="lg"
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-line bg-surface-muted dark:bg-surface-muted/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-ink-muted">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px]">1</span>
                أرسل كود جهازك للمطوّر
              </div>
              <Field label="كود الجهاز">
                <div className="flex gap-2">
                  <Input value={licenseStatus?.machineCode ?? "—"} readOnly dir="ltr" className="font-mono text-left" />
                  <Button type="button" variant="outline" onClick={copyMachineCode}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </Field>
              <Button
                type="button"
                className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                onClick={openLicenseRequestWhatsapp}
              >
                <MessageCircle className="w-4 h-4" /> إرسال الطلب عبر واتساب (كود الجهاز مرفق تلقائياً)
              </Button>
              <p className="text-[11px] text-ink-faint leading-relaxed">
                ستصلك رسالة بالكود والحالة جاهزة — يكفي إرسالها. سيرسل لك المطوّر سيريالاً جديداً
                يجدّد الاشتراك أو يفعّل الضمان أو يفتح مميزات الباقة الأعلى.
              </p>
            </div>

            <div className="rounded-xl border border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/10 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-brand-700 dark:text-brand-300">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-brand-600 text-white text-[10px]">2</span>
                الصق السيريال الجديد وفعّله
              </div>
              <Field label="السيريال الجديد">
                <Textarea
                  rows={3}
                  value={newSerial}
                  onChange={(e) => setNewSerial(e.target.value)}
                  placeholder="APLIC..."
                  dir="ltr"
                  className="font-mono text-left"
                />
              </Field>
              <Button
                type="button"
                size="lg"
                className="w-full gap-2"
                onClick={applyNewSerial}
                disabled={applyingSerial || !newSerial.trim()}
              >
                <KeyRound className="w-4 h-4" />
                {applyingSerial ? "جارٍ التطبيق..." : "تطبيق السيريال وتحديث الترخيص"}
              </Button>
              <p className="text-[11px] text-ink-faint leading-relaxed">
                يتم التطبيق فوراً على هذا الجهاز دون أي تأثير على بياناتك. يمكنك التجديد في أي وقت —
                حتى قبل انتهاء الاشتراك — فلن يتوقف العمل.
              </p>
            </div>
          </div>
        </Dialog>

        <Card className="lg:col-span-1">
          <CardHeader title="النسخة الاحتياطية" subtitle="حفظ واستعادة كل بيانات النظام" />
          <CardBody className="space-y-4">
            <div className="flex flex-col gap-2">
              <Input
                type="password"
                value={backupPassphrase}
                onChange={(e) => setBackupPassphrase(e.target.value)}
                placeholder="كلمة سر النسخة (اختياري — للتصدير/الاستعادة اليدوية)"
                className="text-xs"
                autoComplete="new-password"
              />
              <Button
                onClick={() => exportBackup(backupPassphrase.trim() || undefined)}
                variant="outline"
                className="w-full justify-start"
              >
                <Download className="w-4 h-4" /> تصدير نسخة احتياطية (Backup)
              </Button>
              <div className="relative">
                <input
                  type="file"
                  accept=".json,.hwbak"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ""; // allow re-selecting the same file after an error
                    if (!file) return;
                    const pass = backupPassphrase.trim() || undefined;
                    // Peek the envelope so we can give a precise message and skip
                    // a pointless decrypt when a passphrase is required but empty.
                    let isProtected = false;
                    try {
                      const head = JSON.parse(await file.text());
                      isProtected = head?.enc === "aes-256-gcm" && head?.v === 2;
                    } catch {
                      /* plain or non-JSON — importBackup handles it */
                    }
                    if (isProtected && !pass) {
                      toast.error("هذه النسخة محمية بكلمة سر — اكتبها في الحقل أعلاه ثم أعد الاستيراد");
                      return;
                    }
                    const ok = await importBackup(file, pass);
                    if (ok) {
                      toast.success("تم الاستعادة — جاري إعادة التشغيل...");
                      setTimeout(() => window.location.reload(), 900);
                    } else {
                      toast.error(
                        isProtected
                          ? "تعذر فك النسخة — تأكد من كلمة السر"
                          : "فشل استيراد الملف، تأكد من صحته"
                      );
                    }
                  }}
                />
                <Button variant="outline" className="w-full justify-start">
                  <Upload className="w-4 h-4" /> استيراد نسخة احتياطية (Restore)
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-ink-faint">
              يتم تصدير ملف يحتوي على كافة الفواتير، المنتجات، والعملاء. لو كتبت كلمة سر
              فستُشفَّر النسخة بها ولن تُستعاد إلا بنفس الكلمة — احفظها في مكان آمن.
            </p>
            <div className="pt-2 border-t border-line-soft">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20"
                onClick={() => {
                  const data = lsGet<unknown | null>("inventory_auto_backup_internal", null);
                  if (data) {
                    const file = new File([JSON.stringify(data)], "internal_backup.json", { type: "application/json" });
                    importBackup(file).then(ok => {
                      if (ok) {
                        toast.success("تم الاستعادة — جاري إعادة التشغيل...");
                        setTimeout(() => window.location.reload(), 900);
                      }
                    });
                  } else {
                    toast.error("لا توجد نسخة تلقائية مخزنة حالياً");
                  }
                }}
              >
                <Database className="w-3.5 h-3.5" /> استعادة من النسخة التلقائية الداخلية
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader title="تصدير البيانات (Excel)" subtitle="تصدير جداول البيانات إلى ملفات Excel منفصلة" />
          <CardBody className="grid grid-cols-2 gap-2">
            {!excelExportEnabled && (
              <div className="col-span-2">
                <PaidFeatureNotice title="تصدير البيانات إلى Excel" />
              </div>
            )}
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("products")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> المنتجات
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("customers")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> العملاء
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("suppliers")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> الموردين
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("sales")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> المبيعات
            </Button>
            <Button disabled={!excelExportEnabled} onClick={() => exportToExcel("purchases")} variant="outline" size="sm" className="justify-start">
              <FileSpreadsheet className="w-4 h-4" /> المشتريات
            </Button>
          </CardBody>
        </Card>
        <Dialog
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title="معاينة مظهر الفاتورة والرسائل"
          subtitle="مظهر تجريبي للفاتورة والرسالة عند الطباعة أو المشاركة"
          width="xl"
        >
          <div className="flex flex-col gap-4">
            {/* Tabs */}
            <div className="flex border-b border-line">
              <button
                type="button"
                onClick={() => setPreviewTab("invoice")}
                className={cn(
                  "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
                  previewTab === "invoice"
                    ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400"
                    : "border-transparent text-ink-muted hover:text-ink"
                )}
              >
                معاينة الفاتورة المطبوعة ({form.printPaperSize})
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab("whatsapp")}
                className={cn(
                  "px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors",
                  previewTab === "whatsapp"
                    ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400"
                    : "border-transparent text-ink-muted hover:text-ink"
                )}
              >
                معاينة رسالة واتساب للفاتورة
              </button>
            </div>

            {/* Tab content */}
            <div className="min-h-[300px]">
              {previewTab === "invoice" ? (
                <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-6 flex justify-center overflow-x-auto">
                  {/* Mock Paper A4/A5 size */}
                  <div
                    className={cn(
                      "bg-white text-slate-900 p-8 shadow-md border border-slate-200 rounded text-xs select-none",
                      form.printPaperSize === "A4" ? "w-[595px]" : "w-[420px]"
                    )}
                    dir="rtl"
                  >
                    {/* Header */}
                    <div className="flex justify-between items-start border-b border-slate-300 pb-4 mb-4">
                      <div>
                        <div className="font-bold text-base text-slate-800">{form.companyNameAr || "اسم الشركة بالعربية"}</div>
                        {form.companyName && (
                          <div className="text-[10px] text-slate-500 font-mono" dir="ltr">{form.companyName}</div>
                        )}
                        <div className="text-[10px] text-slate-600 mt-1">صاحب المحل: {form.ownerName || "عمر أحمد"}</div>
                        <div className="text-[10px] text-slate-600">الموبايل: {form.ownerPhone || "01118445625"}</div>
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-slate-800">فاتورة مبيعات مبسطة</div>
                        <div className="text-[10px] text-slate-500">الرقم: INV-2026-0042</div>
                        <div className="text-[10px] text-slate-500">التاريخ: 2026-07-21</div>
                      </div>
                    </div>

                    {/* Customer Info */}
                    <div className="mb-4 bg-slate-50 p-2 rounded border border-slate-100 flex justify-between">
                      <div>
                        <span className="font-bold text-slate-700">العميل:</span> جلال محمد
                      </div>
                      <div>
                        <span className="font-bold text-slate-700">طريقة الدفع:</span> نقدي
                      </div>
                    </div>

                    {/* Table */}
                    <table className="w-full text-[10px] text-right border-collapse mb-4">
                      <thead>
                        <tr className="border-b border-slate-300 font-bold text-slate-700 bg-slate-50">
                          <th className="py-1 px-1">#</th>
                          <th className="py-1 px-1">البيان</th>
                          <th className="py-1 px-1 text-center">الكمية</th>
                          <th className="py-1 px-1 text-left">السعر</th>
                          <th className="py-1 px-1 text-left">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-slate-100">
                          <td className="py-1 px-1">1</td>
                          <td className="py-1 px-1">تيل فرامل خلفي كوري</td>
                          <td className="py-1 px-1 text-center">1</td>
                          <td className="py-1 px-1 text-left">450.00 ج.م</td>
                          <td className="py-1 px-1 text-left">450.00 ج.م</td>
                        </tr>
                        <tr className="border-b border-slate-100">
                          <td className="py-1 px-1">2</td>
                          <td className="py-1 px-1">طنبورة فرامل أمامية ياباني</td>
                          <td className="py-1 px-1 text-center">2</td>
                          <td className="py-1 px-1 text-left">400.00 ج.م</td>
                          <td className="py-1 px-1 text-left">800.00 ج.م</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Totals */}
                    <div className="flex justify-end mb-6">
                      <div className="w-1/2 space-y-1 text-[10px]">
                        <div className="flex justify-between border-b border-slate-100 pb-0.5">
                          <span className="text-slate-500">الإجمالي الفرعي:</span>
                          <span>1,250.00 ج.م</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 pb-0.5 font-bold text-slate-800">
                          <span>الإجمالي النهائي:</span>
                          <span>1,250.00 ج.م</span>
                        </div>
                        <div className="flex justify-between text-emerald-600">
                          <span>المدفوع:</span>
                          <span>1,250.00 ج.م</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>المتبقي:</span>
                          <span>0.00 ج.م</span>
                        </div>
                      </div>
                    </div>

                    {/* Footer Text */}
                    {form.invoiceFooter && (
                      <div className="border-t border-slate-200 pt-3 text-center text-[10px] text-slate-500 font-medium whitespace-pre-line">
                        {form.invoiceFooter}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-6 flex justify-center">
                  {/* Mock WhatsApp Chat */}
                  <div className="w-full max-w-md bg-[#efeae2] dark:bg-[#0b141a] rounded-xl shadow-inner border border-line overflow-hidden flex flex-col h-[380px]">
                    {/* Header */}
                    <div className="bg-[#008069] dark:bg-[#1f2c34] text-white px-4 py-3 flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-300 dark:bg-slate-700 rounded-full flex items-center justify-center font-bold text-slate-600 dark:text-slate-300">
                        {form.companyNameAr?.trim() ? form.companyNameAr.trim().slice(0, 2) : "AP"}
                      </div>
                      <div>
                        <div className="font-bold text-sm">{form.companyNameAr || "اسم الشركة"}</div>
                        <div className="text-[10px] opacity-80">متصل الآن</div>
                      </div>
                    </div>

                    {/* Messages Body */}
                    <div className="flex-1 p-4 overflow-y-auto flex flex-col justify-end">
                      <div
                        className="bg-white dark:bg-[#202c33] text-slate-800 dark:text-slate-200 p-3 rounded-lg shadow-sm max-w-[85%] self-start relative text-xs whitespace-pre-wrap leading-relaxed"
                        dir="rtl"
                      >
                        {(() => {
                          const companyName = form.companyNameAr?.trim() || "اسم الشركة";
                          const ownerPhone = form.ownerPhone?.trim() || "رقم الموبايل";
                          const mockValues = {
                            "{partyName}": "جلال محمد",
                            "{invoiceNumber}": "INV-2026-0042",
                            "{invoiceType}": "مبيعات",
                            "{date}": "2026-07-21",
                            "{total}": "1,250.00",
                            "{paid}": "1,250.00",
                            "{remaining}": "0.00",
                            "{companyName}": companyName,
                            "{phone}": ownerPhone,
                            "{driverName}": "أحمد علي",
                            "{priceType}": "تجزئة",
                            "{paymentMethod}": "نقدي",
                            "{partyLabel}": "العميل",
                            "{status}": "مدفوع"
                          };
                          
                          let text = form.whatsappInvoiceTemplate || DEFAULT_INVOICE_WHATSAPP_TEMPLATE;
                          Object.entries(mockValues).forEach(([tag, val]) => {
                            const regex = new RegExp(tag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
                            text = text.replace(regex, val);
                          });
                          
                          return text;
                        })()}
                        <div className="text-[9px] text-slate-400 dark:text-slate-500 text-left mt-1">١٢:٠٠ م</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog>
      </div>
    </>
  );
}