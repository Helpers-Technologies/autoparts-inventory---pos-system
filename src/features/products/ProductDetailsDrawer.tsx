import { useState } from "react";
import { Drawer } from "../../components/ui/Drawer";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table";
import type { Product } from "../../types";
import { useCatalog } from "../../store/CatalogContext";
import { useInvoicing } from "../../store/InvoicingContext";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDate, formatQualityGradeLabel } from "../../lib/format";
import { formatStockMovementReference } from "../../lib/stockMovement";
import { daysUntil } from "../../lib/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { Activity, Printer } from "lucide-react";
import { BarcodePrintDialog } from "./BarcodePrintDialog";
import { useFeatures } from "../../lib/useFeatures";
import { useVehicleCatalog } from "../../store/VehicleCatalogContext";

export function ProductDetailsDrawer({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const { suppliers, products } = useCatalog();
  const { stockMovements, salesInvoices, purchaseInvoices, salesReturns, purchaseReturns } = useInvoicing();
  const { settings } = useSettings();
  const vehicleCatalog = useVehicleCatalog();
  const { isEnabled } = useFeatures();
  const barcodeEnabled = isEnabled("barcodeSystem");
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const [printOpen, setPrintOpen] = useState(false);
  if (!product) return null;

  const supplier = suppliers.find((s) => s.id === product.supplierId);
  const movements = stockMovements
    .filter((m) => m.productId === product.id)
    .slice(0, 30);

  const expDays = daysUntil(product.expiryDate);
  const fitments = vehicleCatalog.productFitments.filter((fitment) => fitment.productId === product.id);
  const alternatives = vehicleCatalog.productAlternatives.filter(
    (alternative) => alternative.productId === product.id || alternative.alternativeProductId === product.id,
  );

  return (
    <>
    <Drawer
      open={!!product}
      onClose={onClose}
      title={product.name}
      subtitle={`الكود: ${product.code} • ${product.category}`}
      width={520}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Info label="رقم القطعة"><span className="font-mono" dir="ltr">{product.partNumber || "—"}</span></Info>
          <Info label="ماركة القطعة">{product.partBrand || "—"}</Info>
          {product.oemNumbers?.length ? <Info label="أرقام OEM"><span className="font-mono text-xs" dir="ltr">{product.oemNumbers.join(" · ")}</span></Info> : null}
          {product.rackLocation ? <Info label="موقع التخزين"><span className="font-mono" dir="ltr">{product.rackLocation}</span></Info> : null}
          <Info label="الكمية الحالية">
            <span className="text-lg font-semibold">
              {product.piecesPerUnit
                ? `${product.quantity} ${product.unit}${product.looseQuantity ? ` + ${product.looseQuantity} ${product.retailUnit ?? "قطعة"}` : ""}`
                : `${product.quantity} ${product.unit}`}
            </span>
          </Info>
          <Info label="الحد الأدنى">
            {product.minStock} {product.unit}
          </Info>
          {multiSalePricesEnabled && product.piecesPerUnit ? (
            <Info label="تجزئة">
              {product.piecesPerUnit} {product.retailUnit ?? "قطعة"} في {product.unit}
            </Info>
          ) : null}
          <Info label="سعر الشراء">
            {formatCurrency(product.purchasePrice, settings.currency)}
          </Info>
          <Info label="سعر الجملة">
            {formatCurrency(product.wholesalePrice, settings.currency)}
          </Info>
          {multiSalePricesEnabled ? (
            <Info label={product.piecesPerUnit ? `سعر ${product.retailUnit ?? "القطعة"}` : "سعر التجزئة"}>
              {formatCurrency(product.retailPrice, settings.currency)}
            </Info>
          ) : null}
          <Info label="المورد">{supplier?.name ?? "—"}</Info>
          {product.qualityGrade ? <Info label="الجودة">{formatQualityGradeLabel(product.qualityGrade)}</Info> : null}
          {product.condition ? <Info label="الحالة">{product.condition === "new" ? "جديدة" : product.condition === "used" ? "استيراد / مستعملة" : "مجددة"}</Info> : null}
          {product.warrantyMonths ? <Info label="الضمان">{product.warrantyMonths} شهر</Info> : null}
          {barcodeEnabled && product.barcode ? (
            <Info label="الباركود">
              <div className="flex items-center gap-2">
                <span className="font-mono">{product.barcode}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPrintOpen(true)}
                  title="طباعة الباركود"
                >
                  <Printer className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Info>
          ) : null}
          {expiryTrackingEnabled ? <Info label="الصلاحية">
            {product.hasExpiry && product.expiryDate ? (
              <div className="flex items-center gap-2">
                <span>{formatDate(product.expiryDate)}</span>
                {expDays !== null && (
                  <Badge
                    tone={
                      expDays < 0
                        ? "red"
                        : expDays <= 7
                        ? "amber"
                        : expDays <= 30
                        ? "amber"
                        : "green"
                    }
                  >
                    {expDays < 0
                      ? `منتهي منذ ${Math.abs(expDays)} يوم`
                      : `يتبقى ${expDays} يوم`}
                  </Badge>
                )}
              </div>
            ) : (
              <span className="text-ink-faint">لا ينطبق</span>
            )}
          </Info> : null}
        </div>
        {fitments.length ? (
          <div className="rounded-lg border border-line p-3">
            <div className="text-sm font-medium mb-2">السيارات المتوافقة</div>
            <div className="space-y-2">
              {fitments.map((fitment) => {
                const make = vehicleCatalog.vehicleMakes.find((item) => item.id === fitment.makeId);
                const model = vehicleCatalog.vehicleModels.find((item) => item.id === fitment.modelId);
                const generation = vehicleCatalog.vehicleGenerations.find((item) => item.id === fitment.generationId);
                const engine = vehicleCatalog.vehicleEngines.find((item) => item.id === fitment.engineId);
                return <div key={fitment.id} className="rounded-md bg-surface-muted p-2 text-xs"><span className="font-medium" dir="ltr">{make?.name}{model ? ` / ${model.name}` : " / All models"}{generation ? ` / ${generation.name}` : ""}{engine ? ` / ${engine.code || engine.name}` : ""}</span><span className="text-ink-muted ms-2" dir="ltr">{fitment.yearFrom || "?"} — {fitment.yearTo || "الآن"}</span></div>;
              })}
            </div>
          </div>
        ) : null}
        {isEnabled("partAlternatives") && alternatives.length ? (
          <div className="rounded-lg border border-line p-3">
            <div className="text-sm font-medium mb-2">البدائل المتاحة</div>
            <div className="space-y-2">{alternatives.map((alternative) => { const otherId = alternative.productId === product.id ? alternative.alternativeProductId : alternative.productId; const other = products.find((item) => item.id === otherId); return <div key={alternative.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-muted p-2 text-xs"><span><span className="font-mono" dir="ltr">{other?.partNumber || other?.code}</span> — {other?.name}</span><Badge tone="blue">{alternative.relation}</Badge></div>; })}</div>
          </div>
        ) : null}
        {product.notes ? (
          <div className="bg-surface-muted border border-line-soft rounded-lg p-3 text-sm text-ink-muted">
            <div className="text-xs text-ink-faint mb-1">ملاحظات</div>
            {product.notes}
          </div>
        ) : null}
        <div>
          <div className="text-sm font-medium text-ink mb-2">
            سجل حركات المخزون
          </div>
          {movements.length === 0 ? (
            <EmptyState
              icon={<Activity className="w-5 h-5" />}
              title="لا توجد حركات"
              description="سيظهر هنا سجل كل حركة شراء / بيع / تعديل."
            />
          ) : (
            <div className="border border-line rounded-lg overflow-hidden">
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
                      <TD>
                        <MovementBadge type={m.type} />
                      </TD>
                      <TD
                        className={`text-end font-medium ${
                          m.quantity >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                        }`}
                      >
                        {m.quantity > 0 ? "+" : ""}
                        {m.quantity}
                      </TD>
                      <TD className="text-xs text-ink-faint">
                        {formatStockMovementReference(m, {
                          salesInvoices,
                          purchaseInvoices,
                          salesReturns,
                          purchaseReturns,
                        })}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </Drawer>

    {barcodeEnabled && product.barcode && (
      <BarcodePrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        productId={product.id}
        barcode={product.barcode}
        productName={product.name}
      />
    )}
  </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-muted border border-line-soft rounded-lg p-3">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="text-sm text-ink mt-1">{children}</div>
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
