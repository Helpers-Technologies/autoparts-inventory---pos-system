import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CarFront,
  FileCheck2,
  Plus,
  Save,
  ScanLine,
  Tags,
  Trash2,
} from "lucide-react";
import { AutoPartsHero } from "../../components/AutoPartsHero";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../../components/ui/Input";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import { BarcodeScanInput } from "../products/BarcodeScanInput";
import { formatCurrency } from "../../lib/format";
import { parseNumericInput } from "../../lib/numberInput";
import { findProductScanCandidates } from "../../lib/partSearch";
import { uid } from "../../lib/utils";
import { useCatalog } from "../../store/CatalogContext";
import { useSettings } from "../../store/SettingsContext";
import { useFeatures } from "../../lib/useFeatures";
import {
  calculateTierPrice,
  productVehicleFitmentStatus,
  useAutoPartsPro,
  vehicleDisplayName,
  type FitmentStatus,
} from "../../store/AutoPartsProContext";
import { useVehicleCatalog } from "../../store/VehicleCatalogContext";
import type { InvoiceLine, Product, Quotation, SalesPriceType } from "../../types";

type QuotationEditableFields = Pick<
  Quotation,
  | "date"
  | "validUntil"
  | "customerId"
  | "customerName"
  | "customerVehicleId"
  | "vehicleLabel"
  | "branchId"
  | "branchName"
  | "priceTierId"
  | "priceTierName"
  | "lines"
  | "total"
  | "discount"
  | "notes"
>;

interface LineDraft {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  priceType: SalesPriceType;
}

export interface QuotationFormInitialValue {
  date: string;
  validUntil?: string;
  customerId?: string;
  customerVehicleId?: string;
  branchId?: string;
  priceTierId?: string;
  discount?: number;
  notes?: string;
  lines?: InvoiceLine[];
}

export function QuotationForm({
  quotationNumber,
  mode,
  initialValue,
  onSubmit,
}: {
  quotationNumber: string;
  mode: "new" | "edit";
  initialValue: QuotationFormInitialValue;
  onSubmit: (value: QuotationEditableFields) => void;
}) {
  const { products: allProducts, customers: allCustomers } = useCatalog();
  const { settings } = useSettings();
  const pro = useAutoPartsPro();
  const vehicleCatalog = useVehicleCatalog();
  const vehicleCatalogEnabled = useFeatures().isEnabled("vehicleCatalog");
  const navigate = useNavigate();
  const toast = useToast();
  const products = useMemo(() => allProducts.filter((product) => !product.archived), [allProducts]);
  const customers = useMemo(() => allCustomers.filter((customer) => !customer.archived), [allCustomers]);
  const defaultBranchId = pro.branches.find((branch) => branch.isMain && branch.active)?.id
    ?? pro.branches.find((branch) => branch.active)?.id
    ?? "";
  const defaultTierId = pro.priceTiers.find((tier) => tier.isDefault && tier.active)?.id
    ?? pro.priceTiers.find((tier) => tier.active)?.id
    ?? "";

  const [date, setDate] = useState(initialValue.date);
  const [validUntil, setValidUntil] = useState(initialValue.validUntil ?? "");
  const [customerId, setCustomerId] = useState(initialValue.customerId ?? "");
  const [selectedVehicleId, setSelectedVehicleId] = useState(initialValue.customerVehicleId ?? "");
  const [selectedBranchId, setSelectedBranchId] = useState(initialValue.branchId ?? defaultBranchId);
  const [selectedPriceTierId, setSelectedPriceTierId] = useState(initialValue.priceTierId ?? defaultTierId);
  const [discount, setDiscount] = useState(initialValue.discount ?? 0);
  const [notes, setNotes] = useState(initialValue.notes ?? "");
  const [scanMatches, setScanMatches] = useState<Product[]>([]);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (initialValue.lines ?? []).map((line) => ({
      id: line.id,
      productId: line.productId,
      quantity: line.quantity,
      price: line.price,
      priceType: line.priceType ?? (line.isRetailUnit ? "retail" : "wholesale"),
    })),
  );

  const isDirtyRef = useRef(false);
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    isDirtyRef.current = true;
  }, [customerId, date, discount, lines, notes, selectedBranchId, selectedPriceTierId, selectedVehicleId, validUntil]);
  const blocker = useBlocker(useCallback(() => isDirtyRef.current, []));

  useEffect(() => {
    if (!selectedBranchId && defaultBranchId) setSelectedBranchId(defaultBranchId);
    if (!selectedPriceTierId && defaultTierId) setSelectedPriceTierId(defaultTierId);
  }, [defaultBranchId, defaultTierId, selectedBranchId, selectedPriceTierId]);

  const customer = customers.find((item) => item.id === customerId);
  const customerVehicles = useMemo(
    () => pro.customerVehicles.filter((vehicle) => vehicle.customerId === customerId && !vehicle.archived),
    [customerId, pro.customerVehicles],
  );
  const selectedVehicle = pro.customerVehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const selectedBranch = pro.branches.find((branch) => branch.id === selectedBranchId);
  const selectedPriceTier = pro.priceTiers.find((tier) => tier.id === selectedPriceTierId);

  useEffect(() => {
    if (selectedVehicleId && !customerVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId("");
    }
  }, [customerVehicles, selectedVehicleId]);

  const productOptions = useMemo(
    () => products.map((product) => ({
      value: product.id,
      label: `${product.partNumber || product.code} — ${product.name}`,
      searchText: [
        product.code,
        product.barcode,
        product.partNumber,
        product.partBrand,
        product.manufacturer,
        ...(product.oemNumbers ?? []),
      ].filter(Boolean).join(" "),
    })),
    [products],
  );

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity * line.price, 0),
    [lines],
  );
  const total = Math.max(0, subtotal - discount);

  function productForLine(productId: string) {
    return products.find((product) => product.id === productId);
  }

  function priceTypeForTier(): SalesPriceType {
    return selectedPriceTier?.basis === "retail" ? "retail" : "wholesale";
  }

  function productPrice(product: Product) {
    return selectedPriceTier
      ? calculateTierPrice(product, selectedPriceTier)
      : product.wholesalePrice;
  }

  function fitmentStatus(productId: string): FitmentStatus {
    return productVehicleFitmentStatus(productId, selectedVehicle, vehicleCatalog.productFitments);
  }

  function availableBaseUnits(product: Product) {
    if (!selectedBranchId) {
      return product.piecesPerUnit
        ? product.quantity * product.piecesPerUnit + (product.looseQuantity ?? 0)
        : product.quantity;
    }
    const branchQuantity = pro.branchQuantity(selectedBranchId, product.id);
    return product.piecesPerUnit ? branchQuantity * product.piecesPerUnit : branchQuantity;
  }

  function lineBaseUnits(line: LineDraft, product: Product) {
    return line.priceType === "retail" && product.piecesPerUnit
      ? line.quantity
      : line.quantity * (product.piecesPerUnit ?? 1);
  }

  const stockWarnings = (() => {
    const requested = new Map<string, number>();
    for (const line of lines) {
      const product = productForLine(line.productId);
      if (!product) continue;
      requested.set(product.id, (requested.get(product.id) ?? 0) + lineBaseUnits(line, product));
    }
    return [...requested.entries()].flatMap(([productId, requestedBase]) => {
      const product = productForLine(productId);
      if (!product) return [];
      const available = availableBaseUnits(product);
      return requestedBase > available ? [{ product, requested: requestedBase, available }] : [];
    });
  })();

  const incompatibleLines = selectedVehicle
    ? lines.filter((line) => line.productId && fitmentStatus(line.productId) === "incompatible")
    : [];

  function addEmptyLine() {
    setLines((current) => [
      ...current,
      { id: uid("ql"), productId: "", quantity: 1, price: 0, priceType: priceTypeForTier() },
    ]);
  }

  function addProduct(product: Product) {
    if (selectedVehicle && fitmentStatus(product.id) === "incompatible") {
      toast.error("القطعة غير متوافقة مع سيارة العميل", "راجع السيارة أو اختر بديلاً متوافقًا.");
      return;
    }
    const priceType = priceTypeForTier();
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id && line.priceType === priceType);
      if (existing) {
        return current.map((line) => line.id === existing.id
          ? { ...line, quantity: line.quantity + 1 }
          : line);
      }
      return [
        ...current,
        {
          id: uid("ql"),
          productId: product.id,
          quantity: 1,
          price: productPrice(product),
          priceType,
        },
      ];
    });
    setScanMatches([]);
  }

  function updateLine(lineId: string, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => {
      if (line.id !== lineId) return line;
      if (patch.productId !== undefined) {
        const product = productForLine(patch.productId);
        if (!product) return { ...line, productId: "", price: 0 };
        if (selectedVehicle && fitmentStatus(product.id) === "incompatible") {
          toast.error("القطعة غير متوافقة مع سيارة العميل", product.name);
          return line;
        }
        const priceType = priceTypeForTier();
        return { ...line, productId: product.id, price: productPrice(product), priceType };
      }
      return { ...line, ...patch };
    }));
  }

  function handleTierChange(priceTierId: string) {
    setSelectedPriceTierId(priceTierId);
    const tier = pro.priceTiers.find((item) => item.id === priceTierId);
    const priceType: SalesPriceType = tier?.basis === "retail" ? "retail" : "wholesale";
    setLines((current) => current.map((line) => {
      const product = productForLine(line.productId);
      return product
        ? { ...line, priceType, price: tier ? calculateTierPrice(product, tier) : product.wholesalePrice }
        : { ...line, priceType };
    }));
  }

  function handleScan(code: string) {
    const candidates = findProductScanCandidates(products, code);
    if (candidates.length === 0) {
      toast.error("لم يُعثر على قطعة الغيار", `لا يوجد باركود أو Part No. أو OEM مطابق: ${code}`);
      setScanMatches([]);
      return;
    }
    if (candidates.length === 1) {
      addProduct(candidates[0].product);
      return;
    }
    setScanMatches(candidates.map((candidate) => candidate.product));
    toast.info(`الرقم يطابق ${candidates.length} قطع`, "اختر الماركة أو الجودة الصحيحة من النتائج.");
  }

  function save() {
    if (!customer) {
      toast.error("اختر العميل");
      return;
    }
    if (!date) {
      toast.error("أدخل تاريخ عرض السعر");
      return;
    }
    if (validUntil && validUntil < date) {
      toast.error("تاريخ صلاحية العرض يجب أن يكون بعد تاريخ الإصدار");
      return;
    }
    if (lines.length === 0) {
      toast.error("أضف قطعة غيار واحدة على الأقل");
      return;
    }
    if (lines.some((line) => !line.productId || line.quantity <= 0 || line.price < 0)) {
      toast.error("راجع القطعة والكمية والسعر في كل بند");
      return;
    }
    if (discount < 0 || discount > subtotal) {
      toast.error("الخصم لا يمكن أن يتجاوز مجموع عرض السعر");
      return;
    }
    if (incompatibleLines.length > 0) {
      const product = productForLine(incompatibleLines[0].productId);
      toast.error("يوجد بند غير متوافق مع سيارة العميل", product?.name);
      return;
    }
    if (stockWarnings.length > 0) {
      toast.error(
        `رصيد ${selectedBranch?.name ?? "المخزون"} لا يكفي`,
        stockWarnings.map((warning) => `${warning.product.name}: متاح ${warning.available} / مطلوب ${warning.requested}`).join(" • "),
      );
      return;
    }

    const invoiceLines: InvoiceLine[] = lines.map((line) => {
      const product = productForLine(line.productId)!;
      const isRetailUnit = line.priceType === "retail" && Boolean(product.piecesPerUnit);
      return {
        id: line.id,
        productId: product.id,
        productName: product.name,
        partNumber: product.partNumber,
        partBrand: product.partBrand,
        warrantyMonths: product.warrantyMonths,
        unit: isRetailUnit ? (product.retailUnit ?? "قطعة") : product.unit,
        quantity: line.quantity,
        price: line.price,
        priceType: line.priceType,
        costPrice: product.purchasePrice,
        subtotal: line.quantity * line.price,
        isRetailUnit: isRetailUnit || undefined,
      };
    });
    isDirtyRef.current = false;
    onSubmit({
      date,
      validUntil: validUntil || undefined,
      customerId: customer.id,
      customerName: customer.name,
      customerVehicleId: selectedVehicle?.id,
      vehicleLabel: selectedVehicle
        ? vehicleDisplayName(selectedVehicle, vehicleCatalog.vehicleMakes, vehicleCatalog.vehicleModels)
        : undefined,
      branchId: selectedBranch?.id,
      branchName: selectedBranch?.name,
      priceTierId: selectedPriceTier?.id,
      priceTierName: selectedPriceTier?.name,
      lines: invoiceLines,
      total,
      discount: discount || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <>
      <AutoPartsHero
        icon={FileCheck2}
        eyebrow="AUTO PARTS QUOTATION"
        title={mode === "new" ? "عرض سعر قطع غيار جديد" : `تعديل عرض ${quotationNumber}`}
        description="اربط العرض بسيارة العميل، وتحقق من التوافق ورصيد الفرع، ثم طبّق شريحة السعر المناسبة قبل الإرسال."
        stats={[
          { label: "رقم العرض", value: quotationNumber },
          { label: "السيارة", value: selectedVehicle ? "محددة" : "غير محددة" },
          { label: "رصيد الفرع", value: stockWarnings.length ? `${stockWarnings.length} تنبيه` : "سليم" },
        ]}
        actions={
          <>
            <Button variant="outline" onClick={() => mode === "new" ? navigate("/quotations") : navigate(-1)}>
              <ArrowRight className="h-4 w-4" /> رجوع
            </Button>
            <Button onClick={save} disabled={lines.length === 0}>
              <Save className="h-4 w-4" /> {mode === "new" ? "حفظ العرض" : "حفظ التعديلات"}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="العميل والسيارة وسياسة التسعير" />
          <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="العميل" required>
              <SearchableSelect
                value={customerId}
                onChange={(value) => {
                  setCustomerId(value);
                  setSelectedVehicleId("");
                }}
                options={customers.map((item) => ({
                  value: item.id,
                  label: item.name,
                  searchText: `${item.code ?? ""} ${item.phone ?? ""}`,
                }))}
                placeholder="اختر العميل"
                searchPlaceholder="اسم العميل أو الكود أو الهاتف..."
                minChars={0}
              />
            </Field>
            {vehicleCatalogEnabled && (
              <Field label="سيارة العميل" hint={customerId && customerVehicles.length === 0 ? "لا توجد سيارة مسجلة لهذا العميل" : undefined}>
                <div className="relative">
                  <CarFront className="pointer-events-none absolute end-3 top-2.5 h-4 w-4 text-cyan-600" />
                  <Select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)} className="pe-9">
                    <option value="">بدون تحديد سيارة</option>
                    {customerVehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicleDisplayName(vehicle, vehicleCatalog.vehicleMakes, vehicleCatalog.vehicleModels)}
                      </option>
                    ))}
                  </Select>
                </div>
              </Field>
            )}
            <Field label="الفرع" required>
              <div className="relative">
                <Building2 className="pointer-events-none absolute end-3 top-2.5 h-4 w-4 text-indigo-600" />
                <Select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="pe-9">
                  {pro.branches.filter((branch) => branch.active).map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field label="شريحة السعر" required>
              <div className="relative">
                <Tags className="pointer-events-none absolute end-3 top-2.5 h-4 w-4 text-amber-600" />
                <Select value={selectedPriceTierId} onChange={(event) => handleTierChange(event.target.value)} className="pe-9">
                  {pro.priceTiers.filter((tier) => tier.active).map((tier) => (
                    <option key={tier.id} value={tier.id}>{tier.name}</option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field label="التاريخ" required>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="صالح حتى">
              <Input type="date" min={date} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="إضافة سريعة بالاسكان" />
          <CardBody className="space-y-3">
            <BarcodeScanInput onScan={handleScan} />
            <p className="flex items-center gap-2 text-xs leading-5 text-ink-faint">
              <ScanLine className="h-4 w-4 shrink-0 text-cyan-600" />
              يقبل باركود العبوة، Part No.، رقم OEM والكود الداخلي.
            </p>
            {scanMatches.length > 1 ? (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">اختر القطعة المطابقة</div>
                {scanMatches.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-start text-xs hover:border-brand-400"
                  >
                    <span className="font-semibold text-ink">{product.partNumber || product.code}</span>
                    <span className="text-ink-muted"> — {product.name}{product.partBrand ? ` · ${product.partBrand}` : ""}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={`قطع الغيار (${lines.length})`}
          actions={<Button size="sm" onClick={addEmptyLine}><Plus className="h-4 w-4" /> إضافة بند</Button>}
        />
        <CardBody>
          {lines.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink-faint">امسح كود القطعة أو أضف بندًا وابحث بالـ Part No. أو OEM.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>قطعة الغيار / رقمها</TH>
                  <TH>التوافق</TH>
                  <TH>رصيد الفرع</TH>
                  <TH className="w-24">الكمية</TH>
                  <TH className="w-32">السعر</TH>
                  <TH className="w-32 text-end">الإجمالي</TH>
                  <TH className="w-10" />
                </TR>
              </THead>
              <TBody>
                {lines.map((line) => {
                  const product = productForLine(line.productId);
                  const status = product ? fitmentStatus(product.id) : "unknown";
                  const available = product ? availableBaseUnits(product) : 0;
                  const requested = product ? lineBaseUnits(line, product) : 0;
                  return (
                    <TR key={line.id}>
                      <TD className="min-w-[310px]">
                        <SearchableSelect
                          value={line.productId}
                          onChange={(value) => updateLine(line.id, { productId: value })}
                          options={productOptions}
                          placeholder="ابحث عن قطعة..."
                          searchPlaceholder="Part No. / OEM / باركود / اسم / ماركة..."
                          minChars={0}
                        />
                        {product ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Badge tone="slate"><span dir="ltr">{product.partNumber || product.code}</span></Badge>
                            {product.partBrand ? <Badge tone="blue">{product.partBrand}</Badge> : null}
                            {product.oemNumbers?.[0] ? <Badge tone="indigo">OEM: <span dir="ltr">{product.oemNumbers[0]}</span></Badge> : null}
                            {product.warrantyMonths ? <Badge tone="green">ضمان {product.warrantyMonths} شهر</Badge> : null}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        {!selectedVehicle ? (
                          <Badge tone="slate">لم تحدد سيارة</Badge>
                        ) : (
                          <FitmentBadge status={status} />
                        )}
                      </TD>
                      <TD>
                        <Badge tone={requested > available ? "red" : available <= (product?.minStock ?? 0) ? "amber" : "green"}>
                          {available} {product?.piecesPerUnit ? "قطعة" : (product?.unit ?? "")}
                        </Badge>
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) => updateLine(line.id, { quantity: parseNumericInput(event.target.value) })}
                        />
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.price}
                          onChange={(event) => updateLine(line.id, { price: parseNumericInput(event.target.value) })}
                        />
                        <div className="mt-1 text-[10px] text-ink-faint">{line.priceType === "retail" ? "تجزئة" : "جملة"}</div>
                      </TD>
                      <TD className="text-end font-semibold text-ink">{formatCurrency(line.quantity * line.price, settings.currency)}</TD>
                      <TD>
                        <button type="button" className="text-rose-500 hover:text-rose-700" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}

          {stockWarnings.length > 0 ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              رصيد {selectedBranch?.name ?? "الفرع"} غير كافٍ لبعض البنود: {stockWarnings.map((warning) => warning.product.name).join("، ")}
            </div>
          ) : null}
          {incompatibleLines.length > 0 ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              العرض يحتوي قطعة غير متوافقة مع سيارة العميل ولن يمكن حفظه قبل مراجعتها.
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-2">
            <Field label="ملاحظات للعميل / الفني">
              <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="مثال: السعر يشمل التركيب أو يلزم مراجعة رقم الشاسيه..." />
            </Field>
            <div className="space-y-3 md:justify-self-end md:min-w-80">
              <Field label="خصم على العرض">
                <Input type="number" min={0} max={subtotal} step="0.01" value={discount} onChange={(event) => setDiscount(parseNumericInput(event.target.value))} />
              </Field>
              <div className="space-y-1 rounded-xl bg-surface-muted p-4 text-sm">
                <div className="flex justify-between gap-8"><span className="text-ink-faint">المجموع الفرعي</span><span>{formatCurrency(subtotal, settings.currency)}</span></div>
                {discount > 0 ? <div className="flex justify-between gap-8 text-rose-600"><span>الخصم</span><span>- {formatCurrency(discount, settings.currency)}</span></div> : null}
                <div className="flex justify-between gap-8 border-t border-line pt-2 text-lg font-bold"><span>الإجمالي</span><span>{formatCurrency(total, settings.currency)}</span></div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title="الخروج بدون حفظ؟"
        message="توجد تعديلات غير محفوظة في عرض السعر. هل تريد تجاهلها؟"
        confirmText="خروج"
        variant="danger"
      />
    </>
  );
}

function FitmentBadge({ status }: { status: FitmentStatus }) {
  if (status === "compatible") return <Badge tone="green">متوافق</Badge>;
  if (status === "incompatible") return <Badge tone="red">غير متوافق</Badge>;
  return <Badge tone="amber">يلزم مطابقة</Badge>;
}
