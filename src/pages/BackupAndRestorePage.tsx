import { useRef, useState, useEffect } from "react";
import {
  Download, Upload, Database, FileSpreadsheet, KeyRound,
  CloudUpload, CloudDownload, CheckCircle, AlertCircle, FileUp
} from "lucide-react";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Field, Input, Select } from "../components/ui/Input";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useApp } from "../store/AppContext";
import { useCatalog } from "../store/CatalogContext";
import { useToast } from "../components/ui/Toast";
import { lsGet } from "../lib/storage";
import { PaidFeatureNotice } from "../components/PaidFeatureNotice";
import { parseCsv, readFileAsText, downloadCsv } from "../lib/csvImport";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";
import type { FeatureKey } from "../lib/features";
import type { Settings } from "../types";

// ── Product import ────────────────────────────────────────────────────────────

const PRODUCT_HEADERS = [
  "الكود", "رقم القطعة", "أرقام OEM", "الباركود", "الاسم", "ماركة القطعة", "الفئة", "الوحدة",
  "سعر الشراء", "سعر الجملة", "سعر التجزئة",
  "أدنى مخزون", "الكمية الأولية", "موقع الرف", "الضمان بالشهور", "الجودة", "الحالة",
];

interface ProductRow {
  code: string;
  partNumber: string;
  oemNumbers: string[];
  barcode: string;
  name: string;
  partBrand: string;
  category: string;
  unit: string;
  purchasePrice: number;
  wholesalePrice: number;
  retailPrice: number;
  minStock: number;
  quantity: number;
  rackLocation: string;
  warrantyMonths: number | undefined;
  qualityGrade: "genuine" | "oem" | "aftermarket-premium" | "aftermarket-economy";
  condition: "new" | "used" | "remanufactured";
  error?: string;
}

function parseProductRows(rows: string[][]): ProductRow[] {
  const automotiveTemplate = rows[0]?.some((cell) => cell.trim() === "رقم القطعة");
  return rows.slice(1).map((row) => {
    const cells = row.map((c) => c.trim());
    const [code, partNumber, oemRaw, barcode, name, partBrand, category, unit, pp, wp, rp, ms, qty, rackLocation, warrantyRaw, qualityRaw, conditionRaw] = automotiveTemplate
      ? cells
      : [cells[0], cells[0], "", "", cells[1], "", cells[2], cells[3], cells[4], cells[5], cells[6], cells[7], cells[8], "", "", "aftermarket-premium", "new"];
    const err: string[] = [];
    if (!name) err.push("الاسم مطلوب");
    if (!partNumber) err.push("رقم القطعة مطلوب");
    if (!unit) err.push("الوحدة مطلوبة");
    const purchasePrice = parseFloat(pp ?? "0") || 0;
    const wholesalePrice = parseFloat(wp ?? "0") || 0;
    const retailPrice = parseFloat(rp ?? "0") || 0;
    if (purchasePrice < 0 || wholesalePrice < 0 || retailPrice < 0) {
      err.push("الأسعار لا يمكن أن تكون سالبة");
    }
    const minStockRaw = Number(ms || "0");
    const quantityRaw = Number(qty || "0");
    if (!Number.isInteger(quantityRaw) || quantityRaw < 0) {
      err.push("الكمية يجب أن تكون عددًا صحيحًا غير سالب");
    }
    if (!Number.isInteger(minStockRaw) || minStockRaw < 0) {
      err.push("أدنى مخزون يجب أن يكون عددًا صحيحًا غير سالب");
    }
    const minStock = Number.isInteger(minStockRaw) && minStockRaw >= 0 ? minStockRaw : 0;
    const quantity = Number.isInteger(quantityRaw) && quantityRaw >= 0 ? quantityRaw : 0;
    const warrantyNumber = warrantyRaw ? Number(warrantyRaw) : undefined;
    if (warrantyNumber !== undefined && (!Number.isInteger(warrantyNumber) || warrantyNumber < 0)) {
      err.push("الضمان يجب أن يكون عدد شهور صحيحًا");
    }
    const qualityValues = ["genuine", "oem", "aftermarket-premium", "aftermarket-economy"] as const;
    const conditionValues = ["new", "used", "remanufactured"] as const;
    const qualityGrade = qualityValues.includes(qualityRaw as (typeof qualityValues)[number])
      ? qualityRaw as ProductRow["qualityGrade"]
      : "aftermarket-premium";
    const condition = conditionValues.includes(conditionRaw as (typeof conditionValues)[number])
      ? conditionRaw as ProductRow["condition"]
      : "new";
    return {
      code: code || "",
      partNumber: partNumber || "",
      oemNumbers: (oemRaw || "").split(/[|؛]+/).map((value) => value.trim()).filter(Boolean),
      barcode: barcode || "",
      name: name || "",
      partBrand: partBrand || "",
      category: category || "قطع غيار عامة",
      unit: unit || "",
      purchasePrice,
      wholesalePrice,
      retailPrice,
      minStock,
      quantity,
      rackLocation: rackLocation || "",
      warrantyMonths: warrantyNumber,
      qualityGrade,
      condition,
      error: err.length ? err.join("، ") : undefined,
    };
  }).filter((r) => r.name || r.code);
}

// ── Customer import ───────────────────────────────────────────────────────────

const CUSTOMER_HEADERS = ["الاسم", "الهاتف", "العنوان", "ملاحظات"];

interface CustomerRow {
  name: string;
  phone: string;
  address: string;
  notes: string;
  error?: string;
}

function parseCustomerRows(rows: string[][]): CustomerRow[] {
  return rows.slice(1).map((row) => {
    const [name, phone, address, notes] = row.map((c) => c.trim());
    const err: string[] = [];
    if (!name) err.push("الاسم مطلوب");
    return {
      name: name || "",
      phone: phone || "",
      address: address || "",
      notes: notes || "",
      error: err.length ? err.join("، ") : undefined,
    };
  }).filter((r) => r.name);
}

function formatDeviceMoment(value: string | null): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  const date = new Date(time);
  const days = Math.floor((Date.now() - time) / 86_400_000);
  const ago =
    days === 0 ? "اليوم" :
    days === 1 ? "أمس" :
    days < 7 ? `منذ ${days} أيام` :
    days < 30 ? `منذ ${Math.floor(days / 7)} أسابيع` :
    days < 365 ? `منذ ${Math.floor(days / 30)} شهر` :
    `منذ ${Math.floor(days / 365)} سنة`;
  return `${date.toLocaleDateString("ar-EG", { month: "short", day: "numeric", year: "numeric" })} (${ago})`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BackupAndRestorePage() {
  const { settings, updateSettings, exportBackup, importBackup, exportToExcel, currentUser } = useApp();
  const { addProduct, addCustomer, products } = useCatalog();
  const toast = useToast();
  const { isEnabled } = useFeatures();

  const canAddProduct = hasPermission(currentUser, "products", "add");
  const canAddCustomer = hasPermission(currentUser, "customers", "add");
  const excelExportEnabled = isEnabled("excelExport");
  const dataImportEnabled = isEnabled("dataImport");

  const [form, setForm] = useState(settings);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [pendingRestore, setPendingRestore] = useState<{ file: File; pass?: string; isProtected: boolean } | null>(null);
  const [pendingInternalRestore, setPendingInternalRestore] = useState(false);

  // Cloud archive state
  const [cloudArchive, setCloudArchive] = useState<{
    state: "idle" | "loading";
    featureLicensed: boolean;
    serviceAvailable: boolean;
    configured: boolean;
    lastArchivedAt: string | null;
    lastError: { message: string } | null;
  }>({
    state: "idle",
    featureLicensed: false,
    serviceAvailable: false,
    configured: false,
    lastArchivedAt: null,
    lastError: null,
  });
  const [cloudArchiveBusy, setCloudArchiveBusy] = useState(false);
  const [cloudArchiveRefreshKey, setCloudArchiveRefreshKey] = useState(0);
  const [cloudPassphraseDialogOpen, setCloudPassphraseDialogOpen] = useState(false);
  const [cloudAccountPassword, setCloudAccountPassword] = useState("");
  const [cloudPassphrase, setCloudPassphrase] = useState("");
  const [cloudPassphraseConfirm, setCloudPassphraseConfirm] = useState("");
  const [cloudPassphraseError, setCloudPassphraseError] = useState("");
  const [cloudRestoreDialogOpen, setCloudRestoreDialogOpen] = useState(false);
  const [cloudRestorePassphrase, setCloudRestorePassphrase] = useState("");
  const [cloudRestoreError, setCloudRestoreError] = useState("");
  const [cloudRestorePreview, setCloudRestorePreview] = useState<{ ok: boolean; keyCount?: number } | null>(null);

  // Import CSV state
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [productImported, setProductImported] = useState(false);
  const productFileRef = useRef<HTMLInputElement>(null);
  const [customerRows, setCustomerRows] = useState<CustomerRow[]>([]);
  const [customerImported, setCustomerImported] = useState(false);
  const customerFileRef = useRef<HTMLInputElement>(null);


  // Fetch cloud archive status
  useEffect(() => {
    let active = true;
    const api = window.desktopAPI?.license?.getCloudArchiveStatus;
    if (!currentUser?.id || currentUser.role !== "owner" || !api) {
      setCloudArchive({ state: "idle", featureLicensed: false, serviceAvailable: false, configured: false, lastArchivedAt: null, lastError: null });
      return () => { active = false; };
    }
    setCloudArchive((prev) => ({ ...prev, state: "loading" }));
    void api().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setCloudArchive({ state: "idle", featureLicensed: false, serviceAvailable: false, configured: false, lastArchivedAt: null, lastError: null });
        return;
      }
      setCloudArchive({ state: "idle", featureLicensed: result.featureLicensed, serviceAvailable: result.serviceAvailable, configured: result.configured, lastArchivedAt: result.lastArchivedAt, lastError: result.lastError });
    });
    return () => { active = false; };
  }, [currentUser?.id, currentUser?.role, cloudArchiveRefreshKey]);

  const CLOUD_ARCHIVE_ERRORS: Record<string, string> = {
    not_authorized: "النسخ الاحتياطي السحابي متاح للمالك فقط",
    cloud_backup_not_licensed: "ميزة النسخة السحابية غير مفعلة على الترخيص الحالي",
    passphrase_too_short: "كلمة سر النسخة يجب ألا تقل عن 12 حرفًا",
    invalid_password: "كلمة مرور حسابك غير صحيحة",
    passphrase_not_set: "اضبط كلمة سر النسخة السحابية أولًا",
    passphrase_required: "اكتب كلمة سر النسخة السحابية",
    wrong_passphrase: "كلمة سر النسخة غير صحيحة",
    archive_not_found: "لا توجد نسخة سحابية محفوظة بعد",
    archive_too_large: "حجم بيانات المتجر تجاوز الحد المسموح للنسخة السحابية",
    license_inactive: "ترخيص البرنامج غير نشط",
    not_configured: "خدمة السحابة غير مهيأة في هذا الإصدار",
    online_service_unavailable: "تعذر الاتصال بالخدمة؛ تحقق من الإنترنت",
    timeout: "انتهت مهلة الاتصال بالخدمة",
  };

  async function saveCloudPassphrase() {
    if (cloudPassphrase.length < 12) {
      setCloudPassphraseError("كلمة سر النسخة يجب ألا تقل عن 12 حرفًا");
      return;
    }
    if (cloudPassphrase !== cloudPassphraseConfirm) {
      setCloudPassphraseError("تأكيد كلمة السر غير مطابق");
      return;
    }
    const api = window.desktopAPI?.license?.setCloudArchivePassphrase;
    if (!api) return;
    setCloudArchiveBusy(true);
    setCloudPassphraseError("");
    const result = await api(cloudAccountPassword, cloudPassphrase);
    setCloudArchiveBusy(false);
    if (result.ok) {
      setCloudPassphraseDialogOpen(false);
      setCloudAccountPassword("");
      setCloudPassphrase("");
      setCloudPassphraseConfirm("");
      setCloudArchiveRefreshKey((key) => key + 1);
      toast.success("تم تفعيل النسخة السحابية", "احتفظ بكلمة السر — من غيرها لا يمكن استرجاع النسخة");
      return;
    }
    setCloudPassphraseError(CLOUD_ARCHIVE_ERRORS[result.error || ""] || "تعذر حفظ الإعداد");
  }

  async function runCloudArchiveSync() {
    const api = window.desktopAPI?.license?.syncCloudArchiveNow;
    if (!api) return;
    setCloudArchiveBusy(true);
    const result = await api();
    setCloudArchiveBusy(false);
    setCloudArchiveRefreshKey((key) => key + 1);
    if (result.ok) {
      toast.success(
        result.skipped ? "النسخة السحابية محدَّثة بالفعل" : "تم رفع نسخة سحابية جديدة",
        result.skipped ? "لا توجد تغييرات منذ آخر رفع" : `${result.keyCount ?? 0} مجموعة بيانات`,
      );
      return;
    }
    toast.error("تعذر رفع النسخة", CLOUD_ARCHIVE_ERRORS[result.error || ""] || result.error || "");
  }

  async function previewCloudRestore() {
    const api = window.desktopAPI?.license?.previewCloudArchiveRestore;
    if (!api) return;
    setCloudArchiveBusy(true);
    setCloudRestoreError("");
    const result = await api(cloudRestorePassphrase);
    setCloudArchiveBusy(false);
    if (result.ok) {
      setCloudRestorePreview(result);
      return;
    }
    setCloudRestorePreview(null);
    setCloudRestoreError(CLOUD_ARCHIVE_ERRORS[result.error] || "تعذر قراءة النسخة السحابية");
  }

  async function confirmCloudRestore() {
    const api = window.desktopAPI?.license?.restoreCloudArchive;
    if (!api) return;
    setCloudArchiveBusy(true);
    const result = await api(cloudRestorePassphrase);
    setCloudArchiveBusy(false);
    if (!result.ok) {
      setCloudRestoreError(CLOUD_ARCHIVE_ERRORS[result.error] || "تعذر استعادة النسخة السحابية");
      return;
    }
    toast.success("تمت الاستعادة", "سيتم إعادة تشغيل الواجهة الآن");
    setTimeout(() => window.location.reload(), 1200);
  }

  // Product import
  async function handleProductFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!dataImportEnabled || !canAddProduct) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    setProductRows(parseProductRows(rows));
    setProductImported(false);
    if (productFileRef.current) productFileRef.current.value = "";
  }

  function importProducts() {
    if (!dataImportEnabled || !canAddProduct) return;
    const valid = productRows.filter((r) => !r.error);
    if (!valid.length) return;
    const existingCodes = new Set(products.map((p) => p.code));
    const existingPartNumbers = new Set(products.map((p) => p.partNumber?.trim().toLowerCase()).filter(Boolean));
    const existingBarcodes = new Set(products.map((p) => p.barcode?.trim().toLowerCase()).filter(Boolean));
    let skipped = 0;
    let imported = 0;
    valid.forEach((r) => {
      const partKey = r.partNumber.trim().toLowerCase();
      const barcodeKey = r.barcode.trim().toLowerCase();
      if ((r.code && existingCodes.has(r.code)) || existingPartNumbers.has(partKey) || (barcodeKey && existingBarcodes.has(barcodeKey))) { skipped++; return; }
      const added = addProduct({
        code: r.code,
        partNumber: r.partNumber,
        oemNumbers: r.oemNumbers,
        barcode: r.barcode || undefined,
        name: r.name,
        partBrand: r.partBrand || undefined,
        qualityGrade: r.qualityGrade,
        condition: r.condition,
        rackLocation: r.rackLocation || undefined,
        warrantyMonths: r.warrantyMonths,
        category: r.category,
        unit: r.unit,
        retailUnit: undefined,
        purchasePrice: r.purchasePrice,
        wholesalePrice: r.wholesalePrice,
        retailPrice: r.retailPrice,
        piecesPerUnit: undefined,
        quantity: r.quantity,
        looseQuantity: 0,
        minStock: r.minStock,
        hasExpiry: false,
        supplierId: undefined,
        notes: undefined,
        archived: false,
      });
      existingCodes.add(added.code);
      existingPartNumbers.add(partKey);
      if (barcodeKey) existingBarcodes.add(barcodeKey);
      imported++;
    });
    toast.success(
      `تم استيراد ${imported} منتج`,
      skipped > 0 ? `تم تخطي ${skipped} (كود أو رقم قطعة أو باركود مكرر)` : undefined
    );
    setProductImported(true);
    setProductRows([]);
  }

  // Customer import
  async function handleCustomerFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!dataImportEnabled || !canAddCustomer) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    setCustomerRows(parseCustomerRows(rows));
    setCustomerImported(false);
    if (customerFileRef.current) customerFileRef.current.value = "";
  }

  function importCustomers() {
    if (!dataImportEnabled || !canAddCustomer) return;
    const valid = customerRows.filter((r) => !r.error);
    if (!valid.length) return;
    valid.forEach((r) => {
      addCustomer({
        code: undefined,
        name: r.name,
        phone: r.phone || undefined,
        address: r.address || undefined,
        notes: r.notes || undefined,
        archived: false,
      });
    });
    toast.success(`تم استيراد ${valid.length} عميل`);
    setCustomerImported(true);
    setCustomerRows([]);
  }

  const productValid = productRows.filter((r) => !r.error).length;
  const productErrors = productRows.filter((r) => r.error).length;
  const customerValid = customerRows.filter((r) => !r.error).length;
  const customerErrors = customerRows.filter((r) => r.error).length;
  const featureOn = (key: FeatureKey) => isEnabled(key);

  return (
    <>
      <PageHeader
        title="النسخ الاحتياطي والاسترداد"
        description="حفظ واستعادة وتصدير واستيراد بيانات النظام بكل أمان"
      />

      <div className="space-y-8">
        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            النسخ الاحتياطي (Backup)
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4 flex items-center gap-2">
            <Database className="w-5 h-5 text-brand-600" />
            النسخ الاحتياطي
          </h2>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* النسخة السحابية الكاملة */}
            {currentUser?.role === "owner" && (
              <Card dir="rtl">
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <CloudUpload className="h-4 w-4 text-brand-600" />
                      <span>النسخة السحابية الكاملة</span>
                    </div>
                  }
                  subtitle="كل بيانات المتجر مشفَّرة بكلمة سر تخصك — محليًا وعلى السحابة"
                />
                <CardBody className="space-y-4">
                  {cloudArchive.state === "loading" ? (
                    <div className="rounded-xl border border-line bg-surface-muted/45 p-4 text-sm text-ink-muted">جارٍ فحص حالة النسخة السحابية…</div>
                  ) : !cloudArchive.featureLicensed ? (
                    <PaidFeatureNotice
                      title="النسخة السحابية الكاملة"
                      featureKey="cloudBackup"
                      description="نسخة مشفّرة من كل بيانات المتجر على السحابة، قابلة للاستعادة على أي جهاز بكلمة سرك."
                    />
                  ) : !cloudArchive.serviceAvailable ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      خدمة السحابة غير مهيأة في هذا الإصدار.
                    </div>
                  ) : (
                    <>
                      <div className={cn(
                        "rounded-xl border p-4",
                        cloudArchive.configured
                          ? "border-emerald-200 bg-emerald-50/55 dark:border-emerald-500/25 dark:bg-emerald-500/10"
                          : "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10",
                      )}>
                        <div className="text-sm font-bold text-ink">
                          {cloudArchive.configured ? "النسخة السحابية مفعّلة" : "النسخة السحابية غير مفعّلة"}
                        </div>
                        <div className="mt-1 text-xs leading-6 text-ink-muted">
                          {cloudArchive.configured
                            ? <>آخر رفع: {formatDeviceMoment(cloudArchive.lastArchivedAt)} · يتم الرفع تلقائيًا كل نصف ساعة.</>
                            : "اختر كلمة سر للنسخة عشان يبدأ رفع بيانات المتجر بالكامل مشفّرة."}
                        </div>
                        {cloudArchive.lastError && (
                          <div className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                            آخر محاولة فشلت: {cloudArchive.lastError.message}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          disabled={cloudArchiveBusy}
                          onClick={() => {
                            setCloudPassphraseError("");
                            setCloudAccountPassword("");
                            setCloudPassphrase("");
                            setCloudPassphraseConfirm("");
                            setCloudPassphraseDialogOpen(true);
                          }}
                        >
                          <KeyRound className="h-4 w-4" />
                          {cloudArchive.configured ? "تغيير كلمة سر النسخة" : "تفعيل النسخة السحابية"}
                        </Button>
                        {cloudArchive.configured && (
                          <Button type="button" variant="outline" disabled={cloudArchiveBusy} onClick={() => void runCloudArchiveSync()}>
                            <CloudUpload className={cn("h-4 w-4", cloudArchiveBusy && "animate-pulse")} /> رفع نسخة الآن
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={cloudArchiveBusy}
                          onClick={() => {
                            setCloudRestoreError("");
                            setCloudRestorePassphrase("");
                            setCloudRestorePreview(null);
                            setCloudRestoreDialogOpen(true);
                          }}
                        >
                          <CloudDownload className="h-4 w-4" /> استعادة من السحابة
                        </Button>
                      </div>
                    </>
                  )}
                </CardBody>
              </Card>
            )}

            {/* إعدادات النسخ الاحتياطي */}
            <Card>
              <CardHeader title="إعدادات النسخ الاحتياطي التلقائي" subtitle="جدولة حفظ البيانات تلقائياً" />
              <CardBody className="space-y-4">
                {!featureOn("advancedSecurity") && (
                  <PaidFeatureNotice title="النسخ الاحتياطي التلقائي والأمان المتقدم" featureKey="advancedSecurity" />
                )}
                <div className="space-y-3">
                  <div className="rounded-lg border border-line bg-surface-muted/25 p-3">
                    <Field label="تفعيل النسخ التلقائي">
                      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 disabled:opacity-50 cursor-pointer"
                          checked={featureOn("advancedSecurity") && form.autoBackupEnabled}
                          disabled={!featureOn("advancedSecurity")}
                          onChange={(e) => {
                            const updated = { ...form, autoBackupEnabled: e.target.checked };
                            setForm(updated);
                            updateSettings(updated);
                          }}
                        />
                        <span>نعم، قم بالحفظ تلقائياً</span>
                      </label>
                    </Field>
                  </div>

                  {form.autoBackupEnabled && (
                    <div className="rounded-lg border border-line bg-surface p-3 space-y-3">
                      <Field label="تكرار النسخ">
                        <Select
                          value={form.autoBackupFrequency}
                          disabled={!featureOn("advancedSecurity")}
                          onChange={(e) => {
                            const updated = { ...form, autoBackupFrequency: e.target.value as Settings["autoBackupFrequency"] };
                            setForm(updated);
                            updateSettings(updated);
                          }}
                        >
                          <option value="daily">يوميًا</option>
                          <option value="weekly">أسبوعيًا</option>
                          <option value="monthly">كل 30 يومًا</option>
                        </Select>
                      </Field>
                      <p className="text-[11px] leading-relaxed text-ink-faint">
                        يُنشئ النظام النسخة بعد مرور المدة المحددة على آخر نسخة ناجحة، ويفحص الاستحقاق عند التشغيل ثم كل 30 دقيقة أثناء بقاء البرنامج مفتوحًا.
                      </p>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            {/* النسخة الاحتياطية المحلية */}
            <Card>
              <CardHeader title="النسخة الاحتياطية المحلية" subtitle="حفظ واستعادة كل بيانات النظام يدوياً" />
              <CardBody className="space-y-4">
                <div className="flex flex-col gap-2">
                  <Input
                    type="password"
                    value={backupPassphrase}
                    onChange={(e) => setBackupPassphrase(e.target.value)}
                    placeholder="كلمة سر النسخة (اختياري — للحماية)"
                    className="text-xs"
                    autoComplete="new-password"
                  />
                  <Button
                    onClick={async () => {
                      const ok = await exportBackup(backupPassphrase.trim() || undefined);
                      if (!ok) toast.error("فشل تشفير النسخة الاحتياطية");
                    }}
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
                        e.target.value = "";
                        if (!file) return;
                        const pass = backupPassphrase.trim() || undefined;
                        let isProtected = false;
                        try {
                          const head = JSON.parse(await file.text());
                          isProtected = head?.enc === "aes-256-gcm" && (head?.v === 2 || head?.v === 3);
                        } catch {
                          /* plain or non-JSON */
                        }
                        if (isProtected && !pass) {
                          toast.error("هذه النسخة محمية بكلمة سر — اكتبها أعلاه ثم أعد الاستيراد");
                          return;
                        }
                        setPendingRestore({ file, pass, isProtected });
                      }}
                    />
                    <Button variant="outline" className="w-full justify-start">
                      <Upload className="w-4 h-4" /> استيراد نسخة احتياطية (Restore)
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-ink-faint">
                  ملف يحتوي على كافة الفواتير والمنتجات والعملاء. لو كتبت كلمة سر
                  فستُشفَّر النسخة ولن تُستعاد إلا بنفس الكلمة.
                </p>
                <div className="pt-2 border-t border-line-soft">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10"
                    onClick={() => {
                      const data = lsGet<unknown | null>("inventory_auto_backup_internal", null);
                      if (data) {
                        setPendingInternalRestore(true);
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
          </div>
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            التصدير والاستيراد (Export & Import)
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-4 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-brand-600" />
            التصدير والاستيراد
          </h2>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* تصدير البيانات Excel */}
            <Card>
              <CardHeader title="تصدير البيانات (Excel)" subtitle="تصدير جداول البيانات إلى ملفات Excel" />
              <CardBody className="grid grid-cols-2 gap-2">
                {!excelExportEnabled && (
                  <div className="col-span-2">
                    <PaidFeatureNotice title="تصدير البيانات إلى Excel" featureKey="excelExport" />
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

            {/* استيراد البيانات CSV */}
            <Card className="lg:col-span-1">
              <CardHeader title="استيراد البيانات (CSV)" subtitle="رفع منتجات أو عملاء من ملف Excel" />
              <CardBody>
                {!dataImportEnabled ? (
                  <PaidFeatureNotice title="استيراد البيانات" featureKey="dataImport" />
                ) : !canAddProduct && !canAddCustomer ? (
                  <div className="text-sm text-ink-faint p-4 text-center">
                    ليس لديك صلاحية لاستيراد البيانات
                  </div>
                ) : (
                  <Tabs defaultValue="products">
                    <TabsList>
                      <TabsTrigger value="products">المنتجات</TabsTrigger>
                      <TabsTrigger value="customers">العملاء</TabsTrigger>
                    </TabsList>

                    {/* Products tab */}
                    <TabsContent value="products">
                      <div className="space-y-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            downloadCsv("قالب_منتجات.csv", [
                              PRODUCT_HEADERS,
                              ["P001", "W 68/3", "90915-YZZJ1 | 90915-10003", "6221234567890", "فلتر زيت تويوتا كورولا", "MANN-FILTER", "فلاتر", "قطعة", "100", "130", "150", "5", "20", "A-03-02", "6", "aftermarket-premium", "new"],
                            ])
                          }
                          className="w-full justify-start"
                        >
                          <Download className="w-4 h-4" /> تحميل القالب (CSV)
                        </Button>
                        <input
                          ref={productFileRef}
                          type="file"
                          accept=".csv,.txt"
                          className="hidden"
                          onChange={handleProductFile}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => productFileRef.current?.click()}
                          disabled={!canAddProduct}
                          className="w-full justify-start"
                        >
                          <FileUp className="w-4 h-4" /> رفع ملف المنتجات
                        </Button>
                        {productRows.length > 0 && (
                          <div className="text-xs">
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">{productValid} صحيح</span>
                            {productErrors > 0 && (
                              <span className="text-rose-600 dark:text-rose-400 font-medium ms-2">{productErrors} خطأ</span>
                            )}
                            <Button
                              onClick={importProducts}
                              disabled={productValid === 0 || !canAddProduct}
                              size="sm"
                              className="w-full mt-2"
                            >
                              <CheckCircle className="w-4 h-4" /> استيراد {productValid} منتج
                            </Button>
                          </div>
                        )}
                        {productImported && (
                          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle className="w-4 h-4" /> تم الاستيراد
                          </span>
                        )}
                      </div>
                    </TabsContent>

                    {/* Customers tab */}
                    <TabsContent value="customers">
                      <div className="space-y-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            downloadCsv("قالب_عملاء.csv", [
                              CUSTOMER_HEADERS,
                              ["أحمد محمد", "01012345678", "القاهرة", "عميل جملة"],
                            ])
                          }
                          className="w-full justify-start"
                        >
                          <Download className="w-4 h-4" /> تحميل القالب (CSV)
                        </Button>
                        <input
                          ref={customerFileRef}
                          type="file"
                          accept=".csv,.txt"
                          className="hidden"
                          onChange={handleCustomerFile}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => customerFileRef.current?.click()}
                          disabled={!canAddCustomer}
                          className="w-full justify-start"
                        >
                          <FileUp className="w-4 h-4" /> رفع ملف العملاء
                        </Button>
                        {customerRows.length > 0 && (
                          <div className="text-xs">
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">{customerValid} صحيح</span>
                            {customerErrors > 0 && (
                              <span className="text-rose-600 dark:text-rose-400 font-medium ms-2">{customerErrors} خطأ</span>
                            )}
                            <Button
                              onClick={importCustomers}
                              disabled={customerValid === 0 || !canAddCustomer}
                              size="sm"
                              className="w-full mt-2"
                            >
                              <CheckCircle className="w-4 h-4" /> استيراد {customerValid} عميل
                            </Button>
                          </div>
                        )}
                        {customerImported && (
                          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle className="w-4 h-4" /> تم الاستيراد
                          </span>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
              </CardBody>
            </Card>
          </div>

          {/* معاينة بيانات الاستيراد */}
          {productRows.length > 0 && (
            <Card className="mt-6">
              <CardHeader title={`معاينة المنتجات (${productRows.length} صف)`} />
              <CardBody>
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>الكود</TH>
                        <TH>رقم القطعة</TH>
                        <TH>الاسم</TH>
                        <TH>الماركة</TH>
                        <TH>الفئة</TH>
                        <TH className="text-end">الكمية</TH>
                        <TH>الحالة</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {productRows.slice(0, 10).map((r, idx) => (
                        <TR key={idx} className={r.error ? "bg-rose-50 dark:bg-rose-500/10" : undefined}>
                          <TD className="font-mono text-xs">{r.code || "—"}</TD>
                          <TD className="font-mono text-xs" dir="ltr">{r.partNumber}</TD>
                          <TD className="font-medium">{r.name}</TD>
                          <TD>{r.partBrand || "—"}</TD>
                          <TD>{r.category}</TD>
                          <TD className="text-end">{r.quantity}</TD>
                          <TD>
                            {r.error ? (
                              <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 text-xs">
                                <AlertCircle className="w-3 h-3 shrink-0" /> {r.error}
                              </span>
                            ) : (
                              <Badge tone="green">صحيح</Badge>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
                {productRows.length > 10 && (
                  <div className="text-xs text-ink-faint text-center mt-2">
                    عرض أول 10 صفوف من {productRows.length}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {customerRows.length > 0 && (
            <Card className="mt-6">
              <CardHeader title={`معاينة العملاء (${customerRows.length} صف)`} />
              <CardBody>
                <Table>
                  <THead>
                    <TR>
                      <TH>الاسم</TH>
                      <TH>الهاتف</TH>
                      <TH>العنوان</TH>
                      <TH>الحالة</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {customerRows.slice(0, 10).map((r, idx) => (
                      <TR key={idx} className={r.error ? "bg-rose-50 dark:bg-rose-500/10" : undefined}>
                        <TD className="font-medium">{r.name}</TD>
                        <TD>{r.phone || "—"}</TD>
                        <TD>{r.address || "—"}</TD>
                        <TD>
                          {r.error ? (
                            <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 text-xs">
                              <AlertCircle className="w-3 h-3 shrink-0" /> {r.error}
                            </span>
                          ) : (
                            <Badge tone="green">صحيح</Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {customerRows.length > 10 && (
                  <div className="text-xs text-ink-faint text-center mt-2">
                    عرض أول 10 صفوف من {customerRows.length}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </section>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          Dialogs
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      {/* Cloud passphrase setup */}
      <Dialog
        open={cloudPassphraseDialogOpen}
        onClose={() => setCloudPassphraseDialogOpen(false)}
        title={cloudArchive.configured ? "تغيير كلمة سر النسخة السحابية" : "تفعيل النسخة السحابية"}
      >
        <div className="space-y-4" dir="rtl">
          <Field label="كلمة مرور حسابك">
            <Input
              type="password"
              value={cloudAccountPassword}
              onChange={(e) => setCloudAccountPassword(e.target.value)}
              placeholder="للتأكيد"
              autoComplete="current-password"
            />
          </Field>
          <Field label="كلمة سر النسخة السحابية (12 حرف على الأقل)">
            <Input
              type="password"
              value={cloudPassphrase}
              onChange={(e) => setCloudPassphrase(e.target.value)}
              placeholder="كلمة سر قوية ومميزة"
              autoComplete="new-password"
            />
          </Field>
          <Field label="تأكيد كلمة سر النسخة">
            <Input
              type="password"
              value={cloudPassphraseConfirm}
              onChange={(e) => setCloudPassphraseConfirm(e.target.value)}
              placeholder="أعد كتابة نفس الكلمة"
              autoComplete="new-password"
            />
          </Field>
          {cloudPassphraseError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {cloudPassphraseError}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCloudPassphraseDialogOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={saveCloudPassphrase} disabled={cloudArchiveBusy}>
              حفظ
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Cloud restore */}
      <Dialog
        open={cloudRestoreDialogOpen}
        onClose={() => setCloudRestoreDialogOpen(false)}
        title="استعادة من النسخة السحابية"
      >
        <div className="space-y-4" dir="rtl">
          <Field label="كلمة سر النسخة السحابية">
            <Input
              type="password"
              value={cloudRestorePassphrase}
              onChange={(e) => setCloudRestorePassphrase(e.target.value)}
              placeholder="نفس الكلمة المستخدمة عند التفعيل"
              autoComplete="off"
            />
          </Field>
          {cloudRestoreError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {cloudRestoreError}
            </div>
          )}
          {cloudRestorePreview && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              النسخة السحابية موجودة وجاهزة للاستعادة ({cloudRestorePreview.keyCount} مجموعة بيانات)
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCloudRestoreDialogOpen(false)}>
              إلغاء
            </Button>
            {!cloudRestorePreview ? (
              <Button onClick={previewCloudRestore} disabled={cloudArchiveBusy || !cloudRestorePassphrase}>
                معاينة
              </Button>
            ) : (
              <Button onClick={confirmCloudRestore} disabled={cloudArchiveBusy}>
                استعادة الآن
              </Button>
            )}
          </div>
        </div>
      </Dialog>

      {/* Local backup restore */}
      <ConfirmDialog
        open={!!pendingRestore}
        onClose={() => setPendingRestore(null)}
        title="استعادة نسخة احتياطية"
        message="هذا الإجراء سيستبدل كل البيانات الحالية بالبيانات الموجودة في الملف، ولا يمكن التراجع عنه. هل أنت متأكد؟"
        confirmText="استبدال كل البيانات"
        variant="danger"
        onConfirm={async () => {
          if (!pendingRestore) return;
          const { file, pass, isProtected } = pendingRestore;
          setPendingRestore(null);
          const ok = await importBackup(file, pass);
          if (ok) {
            toast.success("تم الاستعادة — جاري إعادة التشغيل...");
            setTimeout(() => window.location.reload(), 900);
          } else {
            toast.error(
              isProtected
                ? "تعذر فك النسخة — تأكد من كلمة السر"
                : "فشل استيراد الملف"
            );
          }
        }}
      />

      {/* Internal backup restore */}
      <ConfirmDialog
        open={pendingInternalRestore}
        onClose={() => setPendingInternalRestore(false)}
        title="استعادة من النسخة التلقائية الداخلية"
        message="هذا الإجراء سيستبدل كل البيانات الحيّة الحالية بآخر نسخة تلقائية داخلية محفوظة، ولا يمكن التراجع عنه. هل أنت متأكد؟"
        confirmText="استبدال كل البيانات"
        variant="danger"
        onConfirm={async () => {
          setPendingInternalRestore(false);
          const data = lsGet<unknown | null>("inventory_auto_backup_internal", null);
          if (!data) {
            toast.error("لا توجد نسخة تلقائية مخزنة");
            return;
          }
          const file = new File([JSON.stringify(data)], "internal_backup.json", { type: "application/json" });
          const ok = await importBackup(file);
          if (ok) {
            toast.success("تم الاستعادة — جاري إعادة التشغيل...");
            setTimeout(() => window.location.reload(), 900);
          } else {
            toast.error("فشل استيراد النسخة الداخلية");
          }
        }}
      />
    </>
  );
}
