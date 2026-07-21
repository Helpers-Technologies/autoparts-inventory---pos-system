import { useRef, useState } from "react";
import { Download, FileUp, CheckCircle, AlertCircle } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { uid } from "../lib/utils";
import { parseCsv, readFileAsText, downloadCsv } from "../lib/csvImport";
import { hasPermission } from "../lib/permissions";
import { useAuth } from "../store/AuthContext";

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
    // OBS-04: a typo like "-50" or "2.5" must surface as a row error instead of
    // silently importing negative prices/stock or truncating fractions.
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function ImportPage() {
  const { addProduct, addCustomer, products } = useCatalog();
  const { settings } = useSettings();
  const { currentUser } = useAuth();
  const toast = useToast();
  const canAddProduct = hasPermission(currentUser, "products", "add");
  const canAddCustomer = hasPermission(currentUser, "customers", "add");
  // OBS-03: the route itself is open to any logged-in user — gate the page
  // content so an employee without any add permission sees a clear denial.
  const canUseImport = canAddProduct || canAddCustomer;

  // Product state
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [productImported, setProductImported] = useState(false);
  const productFileRef = useRef<HTMLInputElement>(null);

  // Customer state
  const [customerRows, setCustomerRows] = useState<CustomerRow[]>([]);
  const [customerImported, setCustomerImported] = useState(false);
  const customerFileRef = useRef<HTMLInputElement>(null);

  void settings;

  async function handleProductFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    setProductRows(parseProductRows(rows));
    setProductImported(false);
    if (productFileRef.current) productFileRef.current.value = "";
  }

  async function handleCustomerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    setCustomerRows(parseCustomerRows(rows));
    setCustomerImported(false);
    if (customerFileRef.current) customerFileRef.current.value = "";
  }

  function importProducts() {
    const valid = productRows.filter((r) => !r.error);
    if (!valid.length) return;
    const existingCodes = new Set(products.map((p) => p.code));
    const existingPartNumbers = new Set(products.map((p) => p.partNumber?.trim().toLowerCase()).filter(Boolean));
    const existingBarcodes = new Set(products.map((p) => p.barcode?.trim().toLowerCase()).filter(Boolean));
    let skipped = 0;
    let imported = 0;
    valid.forEach((r) => {
      // BUG-01: skip codes that already exist in the catalog OR earlier in this
      // same file; addProduct now respects the provided code (or auto-assigns).
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

  function importCustomers() {
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

  if (!canUseImport) {
    return (
      <div className="grid place-items-center py-20 text-sm text-ink-faint">
        ليس لديك صلاحية لاستيراد البيانات — تحتاج صلاحية إضافة منتجات أو عملاء.
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="استيراد البيانات"
        description="رفع منتجات أو عملاء من ملف CSV (يمكن تحضيره من Excel)"
      />

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">المنتجات</TabsTrigger>
          <TabsTrigger value="customers">العملاء</TabsTrigger>
        </TabsList>

        {/* Products tab */}
        <TabsContent value="products">
          <div className="space-y-4">
            <Card>
              <CardHeader title="الخطوة 1 — تحميل القالب" />
              <CardBody className="flex gap-3 items-center flex-wrap">
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCsv("قالب_منتجات.csv", [
                      PRODUCT_HEADERS,
                      ["P001", "W 68/3", "90915-YZZJ1 | 90915-10003", "6221234567890", "فلتر زيت تويوتا كورولا", "MANN-FILTER", "فلاتر", "قطعة", "100", "130", "150", "5", "20", "A-03-02", "6", "aftermarket-premium", "new"],
                    ])
                  }
                >
                  <Download className="w-4 h-4" /> تحميل القالب (CSV)
                </Button>
                <span className="text-sm text-ink-faint">
                  افتح الملف في Excel، أضف البيانات، ثم احفظه كـ CSV
                </span>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="الخطوة 2 — رفع الملف" />
              <CardBody className="flex gap-3 items-center flex-wrap">
                <input
                  ref={productFileRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  aria-label="ملف CSV للمنتجات"
                  onChange={handleProductFile}
                />
                <Button
                  variant="outline"
                  onClick={() => productFileRef.current?.click()}
                  disabled={!canAddProduct}
                >
                  <FileUp className="w-4 h-4" /> اختر ملف CSV
                </Button>
                {productRows.length > 0 && (
                  <span className="text-sm">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">{productValid} صحيح</span>
                    {productErrors > 0 && (
                      <span className="text-rose-600 dark:text-rose-400 font-medium ms-2">{productErrors} خطأ</span>
                    )}
                  </span>
                )}
                {productImported && (
                  <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                    <CheckCircle className="w-4 h-4" /> تم الاستيراد
                  </span>
                )}
              </CardBody>
            </Card>

            {productRows.length > 0 && (
              <Card>
                <CardHeader
                  title={`معاينة (${productRows.length} صف)`}
                  actions={
                    <Button
                      onClick={importProducts}
                      disabled={productValid === 0 || !canAddProduct}
                    >
                      <CheckCircle className="w-4 h-4" /> استيراد {productValid} منتج
                    </Button>
                  }
                />
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
                          <TH>الوحدة</TH>
                          <TH className="text-end">سعر الشراء</TH>
                          <TH className="text-end">سعر الجملة</TH>
                          <TH className="text-end">الكمية</TH>
                          <TH>الموقع</TH>
                          <TH>الحالة</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {productRows.map((r, idx) => (
                          <TR key={idx} className={r.error ? "bg-rose-50 dark:bg-rose-500/10" : undefined}>
                            <TD className="font-mono text-xs">{r.code || "—"}</TD>
                            <TD className="font-mono text-xs" dir="ltr">{r.partNumber}</TD>
                            <TD className="font-medium">{r.name}</TD>
                            <TD>{r.partBrand || "—"}</TD>
                            <TD>{r.category}</TD>
                            <TD>{r.unit}</TD>
                            <TD className="text-end">{r.purchasePrice}</TD>
                            <TD className="text-end">{r.wholesalePrice}</TD>
                            <TD className="text-end">{r.quantity}</TD>
                            <TD className="font-mono text-xs" dir="ltr">{r.rackLocation || "—"}</TD>
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
                </CardBody>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Customers tab */}
        <TabsContent value="customers">
          <div className="space-y-4">
            <Card>
              <CardHeader title="الخطوة 1 — تحميل القالب" />
              <CardBody className="flex gap-3 items-center flex-wrap">
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadCsv("قالب_عملاء.csv", [
                      CUSTOMER_HEADERS,
                      ["أحمد محمد", "01012345678", "القاهرة", "عميل جملة"],
                    ])
                  }
                >
                  <Download className="w-4 h-4" /> تحميل القالب (CSV)
                </Button>
                <span className="text-sm text-ink-faint">
                  افتح الملف في Excel، أضف البيانات، ثم احفظه كـ CSV
                </span>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="الخطوة 2 — رفع الملف" />
              <CardBody className="flex gap-3 items-center flex-wrap">
                <input
                  ref={customerFileRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  aria-label="ملف CSV للعملاء"
                  onChange={handleCustomerFile}
                />
                <Button
                  variant="outline"
                  onClick={() => customerFileRef.current?.click()}
                  disabled={!canAddCustomer}
                >
                  <FileUp className="w-4 h-4" /> اختر ملف CSV
                </Button>
                {customerRows.length > 0 && (
                  <span className="text-sm">
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">{customerValid} صحيح</span>
                    {customerErrors > 0 && (
                      <span className="text-rose-600 dark:text-rose-400 font-medium ms-2">{customerErrors} خطأ</span>
                    )}
                  </span>
                )}
                {customerImported && (
                  <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                    <CheckCircle className="w-4 h-4" /> تم الاستيراد
                  </span>
                )}
              </CardBody>
            </Card>

            {customerRows.length > 0 && (
              <Card>
                <CardHeader
                  title={`معاينة (${customerRows.length} صف)`}
                  actions={
                    <Button
                      onClick={importCustomers}
                      disabled={customerValid === 0 || !canAddCustomer}
                    >
                      <CheckCircle className="w-4 h-4" /> استيراد {customerValid} عميل
                    </Button>
                  }
                />
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
                      {customerRows.map((r, idx) => (
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
                </CardBody>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

// silence unused import warning from uid (used implicitly via addProduct/addCustomer)
void uid;
