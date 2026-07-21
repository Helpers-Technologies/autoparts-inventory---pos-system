import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Plus,
  Minus,
  Trash2,
  Search,
  Scan,
  Monitor,
  Printer,
  FileText,
  DollarSign,
  User,
  ShoppingBag,
  CarFront,
  Building2,
  ShieldCheck,
} from "lucide-react";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useToast } from "../components/ui/Toast";
import { useAuth } from "../store/AuthContext";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { CustomerFormDialog } from "../features/customers/CustomerFormDialog";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { todayISO, uid } from "../lib/utils";
import type { InvoiceLine, PaymentMethod, Product, SalesPaymentType, SalesPriceType } from "../types";
import { formatCurrency } from "../lib/format";
import { findProductScanCandidates, productMatchesSearch } from "../lib/partSearch";
import { useFeatures } from "../lib/useFeatures";
import { computeCreditPaymentView } from "../store/_pure";
import { aggregateSalesPriceType } from "../lib/salesPrice";
import { printAppRoute } from "../lib/print";
import { productVehicleFitmentStatus, useAutoPartsPro, vehicleDisplayName } from "../store/AutoPartsProContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";

interface LineDraft {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  priceType: SalesPriceType;
  expiryDate?: string;
}

const DEFAULT_PRICE_TYPE: SalesPriceType = "wholesale";

// Helper functions defined at top level to avoid declaration order issues
function nextInvoiceNumber(existing: string[]): string {
  const nums = existing
    .map((x) => parseInt(x.replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  const currentMax = nums.length ? Math.max(...nums) : 1000;
  const storedMax = parseInt(localStorage.getItem("seq_sales_invoice") || "0", 10);
  const absoluteMax = Math.max(currentMax, storedMax);
  return `INV-${absoluteMax + 1}`;
}

function productStockAsBaseUnits(product: Product) {
  return product.piecesPerUnit
    ? product.quantity * product.piecesPerUnit + (product.looseQuantity ?? 0)
    : product.quantity;
}

function quantityAsBaseUnits(
  product: Product | undefined,
  quantity: number,
  priceType: SalesPriceType
) {
  if (!product?.piecesPerUnit) return quantity;
  return priceType === "retail" ? quantity : quantity * product.piecesPerUnit;
}

function getProductPrice(product: Product, selectedPriceType: SalesPriceType = DEFAULT_PRICE_TYPE) {
  return selectedPriceType === "retail" ? product.retailPrice : product.wholesalePrice;
}

export function POSPage() {
  const { products: allProducts, customers: allCustomers } = useCatalog();
  const { currentUser } = useAuth();
  const { salesInvoices, addSalesInvoice, applyCustomerCredit } = useInvoicing();
  const { customerBalance } = useReporting();
  const pro = useAutoPartsPro();
  const branchQuantity = pro.branchQuantity;
  const vehicleCatalog = useVehicleCatalog();
  const { isEnabled } = useFeatures();
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const creditPaymentEnabled = isEnabled("creditPayment");
  const creditSalesEnabled = isEnabled("creditSales");
  const navigate = useNavigate();
  const toast = useToast();

  const products = useMemo(() => allProducts.filter((p) => !p.archived), [allProducts]);
  const customers = useMemo(() => allCustomers.filter((c) => !c.archived), [allCustomers]);

  const [isCustomerDialogOpen, setIsCustomerDialogOpen] = useState(false);
  const [pendingCustomerName, setPendingCustomerName] = useState("");

  // Current date/time for ticket
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Form State
  const [invoiceNumber, setInvoiceNumber] = useState("");
  useEffect(() => {
    setInvoiceNumber(nextInvoiceNumber(salesInvoices.map((s) => s.invoiceNumber)));
  }, [salesInvoices]);

  const [date] = useState(() => todayISO());
  const [customerId, setCustomerId] = useState("");
  const [paymentType, setPaymentType] = useState<SalesPaymentType>("cash");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [useCredit, setUseCredit] = useState(false);
  const [discount, setDiscount] = useState<number>(0);
  const [amountReceived, setAmountReceived] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [compatibilityOnly, setCompatibilityOnly] = useState(true);
  const [selectedBranchId, setSelectedBranchId] = useState(
    pro.branches.find((branch) => branch.isMain)?.id ?? pro.branches[0]?.id ?? "",
  );

  // Barcode & Catalog UI state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("الكل");
  const [openPriceMenuLineId, setOpenPriceMenuLineId] = useState<string | null>(null);
  const priceMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (priceMenuRef.current && !priceMenuRef.current.contains(event.target as Node)) {
        setOpenPriceMenuLineId(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Post-sale Receipt Modal State
  const [newInvoiceId, setNewInvoiceId] = useState<string | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Set default customer
  useEffect(() => {
    if (!customerId && customers[0]) {
      setCustomerId(customers[0].id);
    }
  }, [customers, customerId]);

  const customerVehicles = useMemo(
    () => pro.customerVehicles.filter((vehicle) => vehicle.customerId === customerId && !vehicle.archived),
    [customerId, pro.customerVehicles],
  );
  const selectedVehicle = pro.customerVehicles.find((vehicle) => vehicle.id === selectedVehicleId);
  const selectedBranch = pro.branches.find((branch) => branch.id === selectedBranchId);

  useEffect(() => {
    if (selectedVehicleId && !customerVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId("");
    }
  }, [customerVehicles, selectedVehicleId]);

  useEffect(() => {
    if (!selectedBranchId && pro.branches[0]) setSelectedBranchId(pro.branches[0].id);
  }, [pro.branches, selectedBranchId]);

  // Autofocus barcode input
  const focusBarcode = () => {
    barcodeInputRef.current?.focus();
  };
  useEffect(() => {
    focusBarcode();
  }, [newInvoiceId]);

  // Calculate unique categories
  const categories = useMemo(() => {
    const cats = products.map((p) => p.category).filter(Boolean);
    return ["الكل", ...Array.from(new Set(cats))];
  }, [products]);

  // Filter products by category and search query
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = selectedCategory === "الكل" || p.category === selectedCategory;
      const matchesSearch = productMatchesSearch(p, searchQuery);
      const fitmentStatus = productVehicleFitmentStatus(p.id, selectedVehicle, vehicleCatalog.productFitments);
      const matchesVehicle = !selectedVehicle || !compatibilityOnly || fitmentStatus !== "incompatible";
      return matchesCategory && matchesSearch && matchesVehicle;
    });
  }, [compatibilityOnly, products, searchQuery, selectedCategory, selectedVehicle, vehicleCatalog.productFitments]);

  // Totals calculations
  const gross = useMemo(
    () => lines.reduce((a, l) => a + (l.quantity || 0) * (l.price || 0), 0),
    [lines]
  );
  const invoiceNet = Math.max(0, gross - (discount || 0));
  const creditAvailable = customerId ? Math.max(0, -customerBalance(customerId)) : 0;
  
  const { creditApplied, remainingDue, customerChange } = computeCreditPaymentView({
    invoiceNet,
    amountReceived,
    creditAvailable,
    useCredit,
  });

  // Auto-adjust amountReceived on cash / discount change
  useEffect(() => {
    if (paymentType !== "cash") {
      setAmountReceived(0);
      return;
    }
    const cr = useCredit ? Math.min(creditAvailable, invoiceNet) : 0;
    setAmountReceived(Math.max(0, invoiceNet - cr));
  }, [paymentType, invoiceNet, useCredit, creditAvailable]);

  const branchAvailableAsBaseUnits = useCallback((product: Product) => {
    if (!selectedBranchId) return productStockAsBaseUnits(product);
    const availableQuantity = branchQuantity(selectedBranchId, product.id);
    return product.piecesPerUnit ? availableQuantity * product.piecesPerUnit : availableQuantity;
  }, [branchQuantity, selectedBranchId]);

  const stockWarnings = useMemo(() => {
    const out: { productId: string; requested: number; available: number; name: string }[] = [];
    const byProduct = new Map<string, number>();
    lines.forEach((l) => {
      if (!l.productId) return;
      const product = products.find((x) => x.id === l.productId);
      const ept = l.priceType;
      byProduct.set(
        l.productId,
        (byProduct.get(l.productId) ?? 0) + quantityAsBaseUnits(product, l.quantity, ept)
      );
    });
    byProduct.forEach((requestedBase, pid) => {
      const p = products.find((x) => x.id === pid);
      if (!p) return;
      const availableBase = branchAvailableAsBaseUnits(p);
      if (requestedBase > availableBase) {
        out.push({
          productId: pid,
          requested: requestedBase,
          available: availableBase,
          name: p.name,
        });
      }
    });
    return out;
  }, [lines, products, branchAvailableAsBaseUnits]);

  // Add product to cart
  const addProductToCart = (product: Product) => {
    const fitmentStatus = productVehicleFitmentStatus(product.id, selectedVehicle, vehicleCatalog.productFitments);
    if (selectedVehicle && fitmentStatus === "incompatible") {
      toast.error("القطعة غير متوافقة مع السيارة المختارة", "غيّر السيارة أو راجع توافق القطعة قبل البيع.");
      return;
    }
    const defaultPriceType = DEFAULT_PRICE_TYPE;
    const existing = lines.find((l) => l.productId === product.id && l.priceType === defaultPriceType);
    
    // Check stock warning
    const currentQtyInCart = existing ? existing.quantity : 0;
    const baseQtyRequested = quantityAsBaseUnits(product, currentQtyInCart + 1, defaultPriceType);
    const available = branchAvailableAsBaseUnits(product);
    
    if (baseQtyRequested > available) {
      toast.error("الكمية المطلوبة تتجاوز المخزون المتاح", product.name);
      return;
    }

    if (existing) {
      setLines((arr) =>
        arr.map((l) =>
          l.id === existing.id ? { ...l, quantity: l.quantity + 1 } : l
        )
      );
    } else {
      setLines((arr) => [
        ...arr,
        {
          id: uid("line"),
          productId: product.id,
          quantity: 1,
          price: getProductPrice(product, defaultPriceType),
          priceType: defaultPriceType,
        },
      ]);
    }
    focusBarcode();
  };

  // Handle barcode submission
  const handleBarcodeScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;

    const candidates = findProductScanCandidates(products, code);
    if (candidates.length > 1) {
      setSearchQuery(code);
      toast.info(`يوجد ${candidates.length} بدائل لهذا الرقم`, "اختر الماركة أو الجودة المطلوبة من قائمة المنتجات");
      setBarcodeInput("");
      return;
    }
    const product = candidates[0]?.product;

    if (!product) {
      toast.error("المنتج غير موجود", `لا يوجد باركود أو Part Number أو OEM مطابق: ${code}`);
      setBarcodeInput("");
      return;
    }

    addProductToCart(product);
    setBarcodeInput("");
  };

  // Adjust line quantity
  const updateLineQty = (id: string, newQty: number) => {
    if (newQty <= 0) {
      removeLine(id);
      return;
    }
    
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    const product = products.find((p) => p.id === line.productId);
    if (!product) return;

    const priceType = line.priceType;
    const baseQtyRequested = quantityAsBaseUnits(product, newQty, priceType);
    const available = branchAvailableAsBaseUnits(product);
    
    if (baseQtyRequested > available) {
      toast.error("الكمية المطلوبة تتجاوز المخزون المتاح", product.name);
      return;
    }

    setLines((arr) =>
      arr.map((l) => (l.id === id ? { ...l, quantity: newQty } : l))
    );
  };

  const removeLine = (id: string) => {
    setLines((arr) => arr.filter((l) => l.id !== id));
  };

  const changePriceType = (id: string, type: SalesPriceType) => {
    setLines((arr) =>
      arr.map((l) => {
        if (l.id !== id) return l;
        const product = products.find((p) => p.id === l.productId);
        return {
          ...l,
          priceType: type,
          price: product ? getProductPrice(product, type) : l.price,
        };
      })
    );
  };

  // Save POS sales invoice
  const submitSale = () => {
    if (!customerId) {
      toast.error("يرجى اختيار العميل");
      return;
    }
    if (lines.length === 0) {
      toast.error("سلة المشتريات فارغة");
      return;
    }
    if (stockWarnings.length > 0) {
      toast.error("الكمية المطلوبة لبعض المنتجات تتجاوز المخزون المتوفر");
      return;
    }
    const incompatibleLine = selectedVehicle && lines.find((line) =>
      productVehicleFitmentStatus(line.productId, selectedVehicle, vehicleCatalog.productFitments) === "incompatible"
    );
    if (incompatibleLine) {
      toast.error("توجد قطعة غير متوافقة مع السيارة", products.find((product) => product.id === incompatibleLine.productId)?.name);
      return;
    }
    if (discount < 0 || discount > gross) {
      toast.error("قيمة الخصم غير صحيحة");
      return;
    }
    if (amountReceived < 0) {
      toast.error("المبلغ المستلم غير صحيح");
      return;
    }
    if ((paymentType === "account" || remainingDue > 0) && !creditSalesEnabled) {
      toast.error("ميزة البيع الآجل غير مفعّلة في ترخيصك", "سدّد إجمالي الفاتورة أو فعّل الميزة من الباقة.");
      return;
    }

    const customer = customers.find((c) => c.id === customerId)!;
    const invLines: InvoiceLine[] = lines.map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      const ept = l.priceType;
      const isRetailUnit = ept === "retail" && !!p.piecesPerUnit;
      return {
        id: l.id,
        productId: p.id,
        productName: p.name,
        partNumber: p.partNumber,
        partBrand: p.partBrand,
        warrantyMonths: p.warrantyMonths,
        unit: isRetailUnit ? (p.retailUnit ?? "قطعة") : p.unit,
        quantity: l.quantity,
        price: l.price,
        priceType: ept,
        expiryDate: l.expiryDate,
        subtotal: l.quantity * l.price,
        isRetailUnit: isRetailUnit || undefined,
      };
    });

    const actualCashReceived = Math.min(amountReceived, invoiceNet);
    const cashOverpayment = Math.max(0, amountReceived - invoiceNet);

    const inv = addSalesInvoice({
      invoiceNumber,
      date,
      customerId,
      customerName: customer.name,
      lines: invLines,
      total: invoiceNet,
      discount: discount > 0 ? discount : undefined,
      amountReceived: actualCashReceived,
      overpayment: cashOverpayment > 0 ? cashOverpayment : undefined,
      paymentType: remainingDue > 0 ? "account" : paymentType,
      paymentMethod,
      priceType: aggregateSalesPriceType(invLines),
      customerVehicleId: selectedVehicle?.id,
      vehicleLabel: selectedVehicle ? vehicleDisplayName(selectedVehicle, vehicleCatalog.vehicleMakes, vehicleCatalog.vehicleModels) : undefined,
      branchId: selectedBranch?.id,
      branchName: selectedBranch?.name,
      notes: notes.trim() || undefined,
    });

    if (selectedBranchId) {
      pro.consumeBranchStock(selectedBranchId, invLines.map((line) => ({ productId: line.productId, quantity: line.quantity })));
    }

    if (creditApplied > 0) {
      applyCustomerCredit(customerId, inv.id, creditApplied);
    }

    const issuedNum = parseInt(inv.invoiceNumber.replace(/\D/g, ""), 10);
    if (!Number.isNaN(issuedNum)) {
      const storedMax = parseInt(localStorage.getItem("seq_sales_invoice") || "0", 10);
      localStorage.setItem("seq_sales_invoice", Math.max(storedMax, issuedNum).toString());
    }

    toast.success("تم إتمام العملية بنجاح", `رقم الفاتورة ${inv.invoiceNumber}`);
    setNewInvoiceId(inv.id);
  };

  // Keyboard shortcut listener (F10 to checkout)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        submitSale();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Reset/Clear sale
  const handleResetSale = () => {
    setLines([]);
    setDiscount(0);
    setAmountReceived(0);
    setUseCredit(false);
    setNotes("");
    setBarcodeInput("");
    setNewInvoiceId(null);
    focusBarcode();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden gap-4" dir="rtl">
            {/* Main split grid */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left column (Sells cart and Payment controls) - 5 cols */}
        <div className="lg:col-span-5 flex flex-col min-h-0 bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
          {/* Cart Header with Customer & Barcode */}
          <div className="p-4 border-b border-line bg-surface-muted/30 space-y-3 shrink-0">
            {/* Customer select */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-muted shrink-0 flex items-center gap-1">
                <User className="w-3.5 h-3.5" /> العميل:
              </span>
              <SearchableSelect
                value={customerId}
                onChange={setCustomerId}
                options={customers.map((c) => ({
                  value: c.id,
                  label: c.name,
                  searchText: `${c.code ?? ""} ${c.phone ?? ""}`,
                }))}
                placeholder="اختر العميل..."
                searchPlaceholder="ابحث باسم العميل أو الكود أو الهاتف..."
                minChars={0}
                className="flex-1"
                onCreate={(query) => {
                  setPendingCustomerName(query);
                  setIsCustomerDialogOpen(true);
                }}
                createLabel={`أضف عميل جديد: "${pendingCustomerName}"`}
              />
            <CustomerFormDialog
              open={isCustomerDialogOpen}
              onClose={() => setIsCustomerDialogOpen(false)}
              initialName={pendingCustomerName}
              onCreated={(created) => {
                setCustomerId(created.id);
                setIsCustomerDialogOpen(false);
              }}
            />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="relative">
                <CarFront className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-cyan-600" />
                <Select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)} className="pr-8 text-xs">
                  <option value="">بدون تحديد سيارة</option>
                  {customerVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleDisplayName(vehicle, vehicleCatalog.vehicleMakes, vehicleCatalog.vehicleModels)}</option>)}
                </Select>
              </div>
              <div className="relative">
                <Building2 className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-indigo-600" />
                <Select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="pr-8 text-xs">
                  {pro.branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </Select>
              </div>
            </div>
            {customerId && customerVehicles.length === 0 ? (
              <button type="button" onClick={() => navigate("/customer-garage")} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-300 bg-cyan-50/60 px-3 py-2 text-xs font-semibold text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300">
                <CarFront className="h-4 w-4" /> سجل سيارة العميل لتفعيل منع أخطاء التوافق
              </button>
            ) : null}

            {/* Barcode scanner box */}
            <form onSubmit={handleBarcodeScan} className="flex gap-2">
              <div className="relative flex-1">
                <Scan className="absolute right-3 top-2.5 w-4 h-4 text-ink-faint" />
                <Input
                  ref={barcodeInputRef}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="امسح الباركود / Part No. / OEM..."
                  className="pr-10"
                />
              </div>
              <Button type="submit" size="sm" className="px-4">
                إضافة
              </Button>
            </form>
          </div>

          {/* Cart Table Container */}
          <div className="flex-1 overflow-y-auto p-2">
            {lines.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-ink-faint p-8 text-center space-y-2">
                <ShoppingBag className="w-12 h-12 stroke-[1.2]" />
                <p className="text-sm font-medium">سلة المشتريات فارغة</p>
                <p className="text-xs">امسح باركود أو اضغط على منتج من القائمة الجانبية للبدء</p>
              </div>
            ) : (
              <table className="w-full text-sm text-right border-collapse">
                <thead>
                  <tr className="border-b border-line text-ink-muted text-xs font-semibold">
                    <th className="py-2 px-1">المنتج</th>
                    {multiSalePricesEnabled && <th className="py-2 px-1 text-center">السعر</th>}
                    <th className="py-2 px-1 text-center">الكمية</th>
                    <th className="py-2 px-1 text-left">الإجمالي</th>
                    <th className="py-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const product = products.find((p) => p.id === line.productId);
                    if (!product) return null;
                    return (
                      <tr key={line.id} className="border-b border-line/60 hover:bg-surface-muted/20">
                        <td className="py-3 px-1">
                          <p className="font-semibold text-ink leading-tight">{product.name}</p>
                          <span className="text-[10px] text-ink-faint font-mono" dir="ltr">{product.partNumber || product.code}{product.partBrand ? ` · ${product.partBrand}` : ""}</span>
                        </td>
                        
                        {multiSalePricesEnabled && (
                          <td className="py-3 px-1 text-center">
                            <div ref={priceMenuRef} className="relative inline-block w-full max-w-[160px] text-right text-sm">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenPriceMenuLineId((current) =>
                                    current === line.id ? null : line.id
                                  )
                                }
                                className="flex h-10 w-full items-center justify-between rounded-full border border-line bg-white px-3 text-right text-sm text-ink shadow-sm transition hover:border-brand-400 hover:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-100"
                              >
                                <span className="truncate text-right">
                                  {line.priceType === "retail" && product.retailPrice
                                    ? `تجزئة (${formatCurrency(product.retailPrice)})`
                                    : `جملة (${formatCurrency(product.wholesalePrice)})`}
                                </span>
                              </button>

                              {openPriceMenuLineId === line.id && (
                                <div className="absolute right-0 z-20 mt-2 w-full overflow-hidden rounded-2xl border border-line bg-white shadow-lg">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      changePriceType(line.id, "wholesale");
                                      setOpenPriceMenuLineId(null);
                                    }}
                                    className="w-full px-3 py-3 text-right text-sm text-ink transition hover:bg-surface-muted"
                                  >
                                    جملة ({formatCurrency(product.wholesalePrice)})
                                  </button>
                                  {product.retailPrice && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        changePriceType(line.id, "retail");
                                        setOpenPriceMenuLineId(null);
                                      }}
                                      className="w-full px-3 py-3 text-right text-sm text-ink transition hover:bg-surface-muted"
                                    >
                                      تجزئة ({formatCurrency(product.retailPrice)})
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        )}

                        <td className="py-3 px-1 text-center">
                          <div className="inline-flex items-center border border-line rounded-lg bg-surface">
                            <button
                              type="button"
                              onClick={() => updateLineQty(line.id, line.quantity - 1)}
                              className="w-8 h-8 flex items-center justify-center text-ink-muted hover:bg-surface-muted active:bg-line transition-colors rounded-r-lg"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              value={line.quantity}
                              onChange={(e) => updateLineQty(line.id, parseInt(e.target.value) || 0)}
                              className="w-10 h-8 text-center text-sm font-semibold border-x border-line focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              onClick={() => updateLineQty(line.id, line.quantity + 1)}
                              className="w-8 h-8 flex items-center justify-center text-ink-muted hover:bg-surface-muted active:bg-line transition-colors rounded-l-lg"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="py-3 px-1 text-left font-bold text-ink">
                          {formatCurrency(line.quantity * line.price)}
                        </td>

                        <td className="py-3 px-1 text-left">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="text-red-500 hover:text-red-700 p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Cart Footer & Payment Controls */}
          <div className="p-4 border-t border-line bg-surface-muted/20 shrink-0 space-y-4">
            {/* Totals panel */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <div className="flex justify-between text-ink-muted">
                  <span>الإجمالي:</span>
                  <span>{formatCurrency(gross)}</span>
                </div>
                <div className="flex justify-between items-center text-ink-muted">
                  <span>الخصم:</span>
                  <input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-20 text-left border border-line rounded-xl px-3 py-1.5 bg-white/90 text-ink text-sm font-semibold shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                {creditPaymentEnabled && creditAvailable > 0 && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-brand-600 mt-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useCredit}
                      onChange={(e) => setUseCredit(e.target.checked)}
                      className="rounded text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
                    />
                    استخدام رصيد دائن ({formatCurrency(creditAvailable)})
                  </label>
                )}
              </div>

              <div className="space-y-2 border-r border-line pr-3">
                <div className="flex justify-between font-bold text-base text-ink">
                  <span>الصافي:</span>
                  <span>{formatCurrency(invoiceNet)}</span>
                </div>
                
                <div className="flex justify-between items-center font-semibold text-emerald-700">
                  <span>المستلم:</span>
                  <input
                    type="number"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-24 text-left border border-line rounded-xl px-3 py-1.5 bg-white/90 text-emerald-700 font-semibold shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                <div className="flex justify-between font-semibold text-brand-600">
                  <span>الباقي:</span>
                  <span>{formatCurrency(customerChange)}</span>
                </div>
              </div>
            </div>

            {/* Payment method & Checkout */}
            <div className="space-y-2">
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentType("cash");
                    setPaymentMethod("cash");
                  }}
                  className={`flex-1 py-2 font-bold rounded-lg border text-center transition-all ${
                    paymentType === "cash" && paymentMethod === "cash"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-md scale-[1.02]"
                      : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                  }`}
                >
                  كاش نقدي
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentType("cash");
                    setPaymentMethod("bank");
                  }}
                  className={`flex-1 py-2 font-bold rounded-lg border text-center transition-all ${
                    paymentType === "cash" && paymentMethod === "bank"
                      ? "bg-blue-600 text-white border-blue-600 shadow-md scale-[1.02]"
                      : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                  }`}
                >
                  بطاقة مدى/فيزا
                </button>
                {creditSalesEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentType("account");
                    }}
                    className={`flex-1 py-2 font-bold rounded-lg border text-center transition-all ${
                      paymentType === "account"
                        ? "bg-amber-600 text-white border-amber-600 shadow-md scale-[1.02]"
                        : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                    }`}
                  >
                    مبيعات آجل
                  </button>
                )}
              </div>

              {/* Big Checkout Button */}
              <Button
                type="button"
                onClick={submitSale}
                className="w-full h-12 bg-emerald-600 text-white hover:bg-emerald-700 text-base font-bold shadow-md rounded-xl"
              >
                <DollarSign className="w-5 h-5" /> إتمام البيع وحفظ الفاتورة
              </Button>
            </div>
          </div>
        </div>

        {/* Right column (Product Grid Catalog) - 7 cols */}
        <div className="lg:col-span-7 flex flex-col min-h-0 bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
          {/* Search & Category Header */}
          <div className="p-4 border-b border-line bg-surface-muted/20 space-y-3 shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-ink-faint" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتج بالاسم أو الرمز..."
                className="pr-10"
              />
            </div>

            {/* Category tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${
                    selectedCategory === cat
                      ? "bg-brand-600 text-white"
                      : "bg-surface-muted text-ink-muted hover:bg-line"
                  }`}
                >
                  {cat === "" ? "عام" : cat}
                </button>
              ))}
            </div>
            {selectedVehicle ? (
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-cyan-200 bg-cyan-50/60 px-3 py-2 text-xs font-semibold text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300">
                <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> عرض القطع المتوافقة والمجهولة فقط</span>
                <input type="checkbox" checked={compatibilityOnly} onChange={(event) => setCompatibilityOnly(event.target.checked)} className="h-4 w-4 rounded" />
              </label>
            ) : null}
          </div>

          {/* Grid list of Products */}
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            {filteredProducts.length === 0 ? (
              <div className="h-full flex items-center justify-center text-ink-faint">
                لا توجد منتجات مطابقة للبحث
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredProducts.map((prod) => {
                  const availableStock = branchAvailableAsBaseUnits(prod);
                  const isOutOfStock = availableStock <= 0;
                  const fitmentStatus = productVehicleFitmentStatus(prod.id, selectedVehicle, vehicleCatalog.productFitments);
                  return (
                    <button
                      key={prod.id}
                      onClick={() => !isOutOfStock && addProductToCart(prod)}
                      disabled={isOutOfStock}
                      className={`flex flex-col text-right justify-between p-3 border rounded-xl bg-surface transition-all select-none ${
                        isOutOfStock
                          ? "opacity-50 cursor-not-allowed border-line bg-surface-muted/30"
                          : "border-line hover:border-brand-500 hover:shadow-md hover:scale-[1.01] cursor-pointer"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex justify-between items-start gap-1">
                          <span className="text-[10px] bg-surface-muted px-1.5 py-0.5 rounded text-ink-muted font-bold font-mono truncate max-w-[60px]">
                            {prod.code}
                          </span>
                          <Badge
                            tone={availableStock <= prod.minStock ? "red" : "green"}
                            className="text-[9px] px-1 py-0"
                          >
                            متاح: {availableStock}
                          </Badge>
                        </div>
                        {selectedVehicle ? <Badge tone={fitmentStatus === "compatible" ? "green" : fitmentStatus === "incompatible" ? "red" : "amber"} className="text-[9px]">{fitmentStatus === "compatible" ? "متوافق" : fitmentStatus === "incompatible" ? "غير متوافق" : "يلزم مطابقة"}</Badge> : null}
                        <h3 className="font-semibold text-xs text-ink leading-tight line-clamp-2">
                          {prod.name}
                        </h3>
                      </div>
                      
                      <div className="mt-3 border-t border-line/60 pt-2 flex justify-between items-center">
                        <span className="text-[10px] text-ink-faint">
                          {prod.unit}
                        </span>
                        <span className="font-bold text-sm text-brand-600">
                          {formatCurrency(getProductPrice(prod, DEFAULT_PRICE_TYPE))}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Post-Checkout Print Receipt Modal */}
      {newInvoiceId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-line bg-surface-muted/30 flex justify-between items-center">
              <h2 className="font-bold text-ink flex items-center gap-1.5">
                <Printer className="w-5 h-5 text-brand-600" /> خيارات طباعة الفاتورة
              </h2>
              <button
                onClick={handleResetSale}
                className="text-ink-muted hover:text-ink text-sm bg-surface border border-line px-2.5 py-1 rounded-lg"
              >
                ✕ إغلاق
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto dark:bg-emerald-500/10">
                  <DollarSign className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-base text-ink">تم حفظ الفاتورة بنجاح!</h3>
                <p className="text-sm text-ink-muted">اختر طريقة الطباعة أو المتابعة لعملية جديدة</p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5">
                <Button
                  onClick={async () => {
                    await printAppRoute(`/sales/${newInvoiceId}/receipt`);
                  }}
                  className="w-full py-3 h-auto bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-bold flex items-center justify-center gap-2 rounded-xl"
                >
                  <Printer className="w-4 h-4" /> طباعة إيصال حراري (80 مم)
                </Button>
                
                <Button
                  onClick={async () => {
                    await printAppRoute(`/sales/${newInvoiceId}/print`);
                  }}
                  className="w-full py-3 h-auto bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold flex items-center justify-center gap-2 rounded-xl"
                >
                  <FileText className="w-4 h-4" /> طباعة فاتورة A4 / A5
                </Button>
              </div>
            </div>

            <div className="p-4 border-t border-line bg-surface-muted/30 flex gap-2">
              <Button onClick={handleResetSale} className="flex-1 py-2.5 h-auto text-sm font-bold">
                عملية بيع جديدة
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
