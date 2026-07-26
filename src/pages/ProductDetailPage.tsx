import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Pencil,
  Printer,
  Boxes,
  Wallet,
  ShoppingCart,
  TrendingUp,
  Percent,
  Car,
  Activity,
  Building2,
  ShieldCheck,
  MapPin,
  Tag,
  GitCompareArrows,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Select } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { ProductFormDialog } from "../features/products/ProductForm";
import { BarcodePrintDialog } from "../features/products/BarcodePrintDialog";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useAuth } from "../store/AuthContext";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { useFeatures } from "../lib/useFeatures";
import { formatCurrency, formatDate, formatQualityGradeLabel } from "../lib/format";
import { formatStockMovementReference } from "../lib/stockMovement";
import { daysUntil } from "../lib/utils";
import { hasPermission } from "../lib/permissions";
import type { WarrantyClaimStatus } from "../types";

function conditionLabel(condition?: string) {
  switch (condition) {
    case "new": return "جديدة";
    case "used": return "استيراد / مستعملة";
    case "refurbished": return "مجددة";
    case "remanufactured": return "معاد تصنيعها";
    default: return condition ?? "—";
  }
}

const WARRANTY_STATUS: Record<WarrantyClaimStatus, { label: string; tone: "blue" | "amber" | "indigo" | "green" | "red" | "emerald" }> = {
  open: { label: "مفتوح", tone: "blue" },
  inspecting: { label: "قيد الفحص", tone: "amber" },
  supplier: { label: "لدى المورد", tone: "indigo" },
  approved: { label: "مقبول", tone: "green" },
  rejected: { label: "مرفوض", tone: "red" },
  replaced: { label: "تم الاستبدال", tone: "emerald" },
};

export function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { products, suppliers } = useCatalog();
  const { stockMovements, salesInvoices, purchaseInvoices, salesReturns, purchaseReturns } = useInvoicing();
  const { settings } = useSettings();
  const { currentUser } = useAuth();
  const pro = useAutoPartsPro();
  const vehicleCatalog = useVehicleCatalog();
  const { isEnabled } = useFeatures();
  const barcodeEnabled = isEnabled("barcodeSystem");
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const partAlternativesEnabled = isEnabled("partAlternatives");

  const canEdit = hasPermission(currentUser, "products", "edit");

  const product = products.find((p) => p.id === id);

  const [editOpen, setEditOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const supplier = product ? suppliers.find((s) => s.id === product.supplierId) : undefined;

  // Per-piece cost so mixed carton/loose stock values correctly.
  const productCost = product ? (product.avgCost ?? product.purchasePrice) : 0;
  const perPieceCost = product ? (product.piecesPerUnit ? productCost / product.piecesPerUnit : productCost) : 0;
  const baseUnits = product ? (product.piecesPerUnit ? product.quantity * product.piecesPerUnit + (product.looseQuantity ?? 0) : product.quantity) : 0;
  const stockValue = baseUnits * perPieceCost;

  const unitProfit = product ? product.wholesalePrice - productCost : 0;
  const marginPct = product && productCost > 0 ? (unitProfit / productCost) * 100 : 0;

  const sales = useMemo(() => {
    let revenue = 0;
    let units = 0;
    let profit = 0;
    const invoiceIds = new Set<string>();
    if (product) {
      for (const inv of salesInvoices) {
        if (inv.cancelled) continue;
        for (const l of inv.lines) {
          if (l.productId !== product.id) continue;
          revenue += l.subtotal;
          units += l.quantity;
          profit += l.subtotal - (l.costPrice ?? product.avgCost ?? product.purchasePrice) * l.quantity;
          invoiceIds.add(inv.id);
        }
      }
    }
    return { revenue, units, profit, invoiceCount: invoiceIds.size };
  }, [salesInvoices, product]);

  const purchases = useMemo(() => {
    let cost = 0;
    let units = 0;
    const invoiceIds = new Set<string>();
    if (product) {
      for (const inv of purchaseInvoices) {
        for (const l of inv.lines) {
          if (l.productId !== product.id) continue;
          cost += l.subtotal;
          units += l.quantity;
          invoiceIds.add(inv.id);
        }
      }
    }
    return { cost, units, invoiceCount: invoiceIds.size };
  }, [purchaseInvoices, product]);

  const [movementsPageSize, setMovementsPageSize] = useState(5);
  const [movementsLimit, setMovementsLimit] = useState(5);
  const allMovements = useMemo(
    () => (product ? stockMovements.filter((m) => m.productId === product.id) : []),
    [stockMovements, product]
  );
  const movements = useMemo(() => allMovements.slice(0, movementsLimit), [allMovements, movementsLimit]);
  const fitments = useMemo(
    () => (product ? vehicleCatalog.productFitments.filter((f) => f.productId === product.id) : []),
    [vehicleCatalog.productFitments, product]
  );
  const alternatives = useMemo(
    () => (product ? vehicleCatalog.productAlternatives.filter((a) => a.productId === product.id || a.alternativeProductId === product.id) : []),
    [vehicleCatalog.productAlternatives, product]
  );
  const branchRows = useMemo(
    () => (product && pro.branches.length > 1
      ? pro.branches.map((b) => ({ branch: b, quantity: pro.branchQuantity(b.id, product.id) }))
      : []),
    [pro, product]
  );
  const claims = useMemo(
    () => (product ? pro.warrantyClaims.filter((c) => c.productId === product.id) : []),
    [pro.warrantyClaims, product]
  );

  if (!product) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8">
            <div className="text-ink font-medium">المنتج غير موجود</div>
            <Button className="mt-4" onClick={() => navigate("/products")}>
              <ArrowRight className="w-4 h-4" /> العودة لقائمة المنتجات
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const expDays = daysUntil(product.expiryDate);
  const stockTone = product.quantity <= 0 ? "red" : product.quantity <= product.minStock ? "amber" : "green";
  const stockLabel = product.quantity <= 0 ? "نافد من المخزون" : product.quantity <= product.minStock ? "أقل من الحد الأدنى" : "متوفر";

  return (
    <>
      <PageHeader
        title={product.name}
        description={`الكود: ${product.code} • ${product.category}${product.partNumber ? ` • ${product.partNumber}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/products")}>
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            {barcodeEnabled && product.barcode ? (
              <Button variant="outline" onClick={() => setPrintOpen(true)}>
                <Printer className="w-4 h-4" /> طباعة الباركود
              </Button>
            ) : null}
            {canEdit ? (
              <Button onClick={() => setEditOpen(true)}>
                <Pencil className="w-4 h-4" /> تعديل
              </Button>
            ) : null}
          </>
        }
      />

      {product.archived ? (
        <div className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-ink-muted">
          هذا المنتج مؤرشف حاليًا ولا يظهر في القوائم الرئيسية.
        </div>
      ) : null}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          icon={<Boxes className="w-5 h-5" />}
          label="الكمية الحالية"
          value={product.piecesPerUnit
            ? `${product.quantity} ${product.unit}${product.looseQuantity ? ` + ${product.looseQuantity}` : ""}`
            : `${product.quantity} ${product.unit}`}
          detail={stockLabel}
          tone={stockTone === "red" ? "red" : stockTone === "amber" ? "amber" : "green"}
        />
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="قيمة المخزون"
          value={formatCurrency(stockValue, settings.currency)}
          detail="محسوبة بسعر الشراء"
          tone="indigo"
        />
        <StatCard
          icon={<ShoppingCart className="w-5 h-5" />}
          label="إجمالي المبيعات"
          value={formatCurrency(sales.revenue, settings.currency)}
          detail={sales.units > 0 ? `${sales.units} وحدة في ${sales.invoiceCount} فاتورة` : "لا مبيعات بعد"}
          tone="green"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="الربح المحقق"
          value={formatCurrency(sales.profit, settings.currency)}
          detail={`هامش الجملة ${marginPct.toFixed(0)}%`}
          tone="emerald"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product info */}
        <Card className="lg:col-span-2">
          <CardHeader title="بيانات القطعة" />
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <Info label="رقم القطعة" icon={<Tag className="w-3.5 h-3.5" />}>
                <span className="font-mono" dir="ltr">{product.partNumber || "—"}</span>
              </Info>
              <Info label="ماركة القطعة">{product.partBrand || "—"}</Info>
              <Info label="التصنيف">{product.category}</Info>
              {product.oemNumbers?.length ? (
                <Info label="أرقام OEM" className="sm:col-span-2 xl:col-span-3">
                  <span className="font-mono text-xs" dir="ltr">{product.oemNumbers.join(" · ")}</span>
                </Info>
              ) : null}
              {product.rackLocation ? (
                <Info label="موقع التخزين" icon={<MapPin className="w-3.5 h-3.5" />}>
                  <span className="font-mono" dir="ltr">{product.rackLocation}</span>
                </Info>
              ) : null}
              <Info label="الحد الأدنى">{product.minStock} {product.unit}</Info>
              {product.reorderQuantity ? <Info label="كمية إعادة الطلب">{product.reorderQuantity} {product.unit}</Info> : null}
              {product.qualityGrade ? <Info label="الجودة">{formatQualityGradeLabel(product.qualityGrade)}</Info> : null}
              {product.condition ? <Info label="الحالة">{conditionLabel(product.condition)}</Info> : null}
              {product.originCountry ? <Info label="بلد المنشأ">{product.originCountry}</Info> : null}
              {product.manufacturer ? <Info label="المُصنّع">{product.manufacturer}</Info> : null}
              {product.position ? <Info label="الموضع">{product.position}</Info> : null}
              {product.warrantyMonths ? (
                <Info label="الضمان" icon={<ShieldCheck className="w-3.5 h-3.5" />}>{product.warrantyMonths} شهر</Info>
              ) : null}
              <Info label="المورد" icon={<Building2 className="w-3.5 h-3.5" />}>
                {supplier ? (
                  <Link to={`/suppliers/${supplier.id}`} className="text-brand-700 dark:text-brand-300 hover:underline">
                    {supplier.name}
                  </Link>
                ) : "—"}
              </Info>
              {barcodeEnabled && product.barcode ? (
                <Info label="الباركود">
                  <span className="font-mono" dir="ltr">{product.barcode}</span>
                </Info>
              ) : null}
              {expiryTrackingEnabled ? (
                <Info label="الصلاحية">
                  {product.hasExpiry && product.expiryDate ? (
                    <span className="inline-flex items-center gap-2">
                      {formatDate(product.expiryDate)}
                      {expDays !== null && (
                        <Badge tone={expDays < 0 ? "red" : expDays <= 30 ? "amber" : "green"}>
                          {expDays < 0 ? `منتهٍ منذ ${Math.abs(expDays)} يوم` : `يتبقى ${expDays} يوم`}
                        </Badge>
                      )}
                    </span>
                  ) : <span className="text-ink-faint">لا ينطبق</span>}
                </Info>
              ) : null}
            </div>
            {product.notes ? (
              <div className="mt-3 bg-surface-muted border border-line rounded-lg p-3 text-sm text-ink-muted">
                <div className="text-[11px] text-ink-faint mb-1">ملاحظات</div>
                {product.notes}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* Pricing & margin */}
        <Card>
          <CardHeader title="التسعير والأرباح" />
          <CardBody className="space-y-2">
            <PriceRow label="سعر الشراء" value={formatCurrency(product.purchasePrice, settings.currency)} />
            <PriceRow label={multiSalePricesEnabled ? "سعر الجملة" : "سعر البيع"} value={formatCurrency(product.wholesalePrice, settings.currency)} />
            {multiSalePricesEnabled ? (
              <PriceRow
                label={product.piecesPerUnit ? `سعر ${product.retailUnit ?? "القطعة"}` : "سعر التجزئة"}
                value={formatCurrency(product.retailPrice, settings.currency)}
              />
            ) : null}
            {product.piecesPerUnit ? (
              <PriceRow label="التعبئة" value={`${product.piecesPerUnit} ${product.retailUnit ?? "قطعة"} / ${product.unit}`} />
            ) : null}
            <div className="border-t border-line pt-2 mt-1 space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 inline-flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5" /> هامش الجملة
                </span>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  {marginPct.toFixed(1)}%
                </span>
              </div>
              <PriceRow label="ربح الوحدة (جملة)" value={formatCurrency(unitProfit, settings.currency)} valueClass="text-emerald-700 dark:text-emerald-400" />
              <PriceRow label="إجمالي مشتريات القطعة" value={`${purchases.units} وحدة`} valueClass="text-ink-muted" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Branch distribution */}
      {branchRows.length > 0 ? (
        <Card>
          <CardHeader title="توزيع المخزون على الفروع" subtitle={`${pro.branches.length} فرع`} />
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH>الفرع</TH>
                  <TH className="text-end">الكمية</TH>
                  <TH className="text-end">قيمة المخزون</TH>
                </TR>
              </THead>
              <TBody>
                {branchRows.map(({ branch, quantity }) => (
                  <TR key={branch.id}>
                    <TD className="font-medium text-ink">{branch.name}{branch.isMain ? <Badge tone="blue" className="ms-2">رئيسي</Badge> : null}</TD>
                    <TD className="text-end">
                      <Badge tone={quantity <= 0 ? "red" : quantity <= product.minStock ? "amber" : "green"}>{quantity} {product.unit}</Badge>
                    </TD>
                    <TD className="text-end font-mono">{formatCurrency(quantity * (product.avgCost ?? product.purchasePrice), settings.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {/* Compatible vehicles */}
      <Card>
        <CardHeader title="السيارات المتوافقة" subtitle={fitments.length > 0 ? `${fitments.length} توافق` : undefined} />
        <CardBody>
          {fitments.length === 0 ? (
            <EmptyState icon={<Car className="w-5 h-5" />} title="لا توجد سيارات متوافقة مسجّلة" description="أضف التوافقات من نموذج تعديل المنتج." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {fitments.map((f) => {
                const make = vehicleCatalog.vehicleMakes.find((m) => m.id === f.makeId);
                const model = vehicleCatalog.vehicleModels.find((m) => m.id === f.modelId);
                const generation = vehicleCatalog.vehicleGenerations.find((g) => g.id === f.generationId);
                const engine = vehicleCatalog.vehicleEngines.find((e) => e.id === f.engineId);
                return (
                  <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <Car className="w-4 h-4 text-brand-600 shrink-0" />
                      <span dir="ltr">
                        {make?.name}{model ? ` / ${model.name}` : " / All"}{generation ? ` / ${generation.name}` : ""}{engine ? ` / ${engine.code || engine.name}` : ""}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-ink-faint shrink-0" dir="ltr">{f.yearFrom || "?"}—{f.yearTo || "الآن"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Alternatives */}
      {partAlternativesEnabled && alternatives.length > 0 ? (
        <Card>
          <CardHeader title="البدائل و Cross Reference" subtitle={`${alternatives.length} بديل`} />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {alternatives.map((a) => {
                const otherId = a.productId === product.id ? a.alternativeProductId : a.productId;
                const other = products.find((p) => p.id === otherId);
                return (
                  <Link
                    key={a.id}
                    to={other ? `/products/${other.id}` : "#"}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2 hover:border-brand-300 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <GitCompareArrows className="w-4 h-4 text-brand-600 shrink-0" />
                      <span><span className="font-mono" dir="ltr">{other?.partNumber || other?.code}</span> — {other?.name}</span>
                    </span>
                    <Badge tone="blue">{a.relation}</Badge>
                  </Link>
                );
              })}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* Warranty claims */}
      {claims.length > 0 ? (
        <Card>
          <CardHeader title="مطالبات الضمان على هذه القطعة" subtitle={`${claims.length} مطالبة`} />
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH>العميل</TH>
                  <TH>الفاتورة</TH>
                  <TH>الشكوى</TH>
                  <TH className="text-end">الحالة</TH>
                </TR>
              </THead>
              <TBody>
                {claims.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-ink">{c.customerName}</TD>
                    <TD className="font-mono text-xs">{c.invoiceNumber}</TD>
                    <TD className="text-xs text-ink-muted">{c.complaint}</TD>
                    <TD className="text-end"><Badge tone={WARRANTY_STATUS[c.status].tone}>{WARRANTY_STATUS[c.status].label}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {/* Stock movement log */}
      <Card>
        <CardHeader
          title="سجل حركات المخزون"
          subtitle={allMovements.length > 0 ? `عرض ${movements.length} من ${allMovements.length} حركة` : undefined}
          actions={
            allMovements.length > 0 ? (
              <Select
                value={movementsPageSize}
                onChange={(e) => {
                  const size = Number(e.target.value);
                  setMovementsPageSize(size);
                  setMovementsLimit(size);
                }}
                className="!w-auto"
              >
                <option value={5}>آخر 5 حركات</option>
                <option value={10}>آخر 10 حركات</option>
                <option value={20}>آخر 20 حركة</option>
                <option value={50}>آخر 50 حركة</option>
              </Select>
            ) : undefined
          }
        />
        <CardBody>
          {movements.length === 0 ? (
            <EmptyState icon={<Activity className="w-5 h-5" />} title="لا توجد حركات" description="سيظهر هنا سجل كل حركة شراء / بيع / تعديل." />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>التاريخ</TH>
                    <TH>النوع</TH>
                    <TH className="text-end">الكمية</TH>
                    <TH>السبب / المرجع</TH>
                  </TR>
                </THead>
                <TBody>
                  {movements.map((m) => (
                    <TR key={m.id}>
                      <TD>{formatDate(m.date)}</TD>
                      <TD><MovementBadge type={m.type} /></TD>
                      <TD className={`text-end font-medium ${m.quantity >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
                        {m.quantity > 0 ? "+" : ""}{m.quantity}
                      </TD>
                      <TD className="text-xs text-ink-faint">
                        {formatStockMovementReference(m, { salesInvoices, purchaseInvoices, salesReturns, purchaseReturns })}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {allMovements.length > movements.length ? (
                <div className="mt-3 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMovementsLimit((limit) => limit + movementsPageSize)}
                  >
                    عرض المزيد ({allMovements.length - movements.length} حركة متبقية)
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>

      {canEdit ? (
        <ProductFormDialog open={editOpen} editing={product} onClose={() => setEditOpen(false)} />
      ) : null}
      {barcodeEnabled && product.barcode ? (
        <BarcodePrintDialog
          open={printOpen}
          onClose={() => setPrintOpen(false)}
          productId={product.id}
          barcode={product.barcode}
          productName={product.name}
        />
      ) : null}
    </>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "green" | "red" | "amber" | "blue" | "indigo" | "emerald";
}) {
  const colors: Record<typeof tone, string> = {
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    red: "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400",
    indigo: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  };
  return (
    <div className="bg-surface border border-line rounded-xl p-4 flex items-center gap-3 shadow-card">
      <div className={`w-11 h-11 rounded-lg grid place-items-center shrink-0 ${colors[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-ink-faint">{label}</div>
        <div className="font-semibold text-ink text-lg truncate">{value}</div>
        <div className="text-[11px] text-ink-faint truncate">{detail}</div>
      </div>
    </div>
  );
}

function Info({
  label,
  children,
  className,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={`bg-surface-muted border border-line rounded-lg p-3 ${className ?? ""}`}>
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="text-sm text-ink mt-1 inline-flex items-center gap-1.5">
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
        {children}
      </div>
    </div>
  );
}

function PriceRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={`text-sm font-mono font-medium text-ink ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function MovementBadge({ type }: { type: string }) {
  if (type === "purchase") return <Badge tone="blue">شراء</Badge>;
  if (type === "sale") return <Badge tone="green">بيع</Badge>;
  if (type === "adjustment-in") return <Badge tone="emerald">تعديل +</Badge>;
  if (type === "adjustment-out") return <Badge tone="rose">تعديل -</Badge>;
  if (type === "return") return <Badge tone="amber">مرتجع</Badge>;
  return <Badge>{type}</Badge>;
}
