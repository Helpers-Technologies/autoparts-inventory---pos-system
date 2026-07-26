import { useCallback, useEffect, memo, useMemo, useRef, useState, useDeferredValue } from "react";
import {
  Plus,
  Minus,
  Trash2,
  Search,
  Scan,
  Printer,
  FileText,
  DollarSign,
  User,
  ShoppingBag,
  CarFront,
  ShieldCheck,
  PlayCircle,
  Lock,
  RotateCcw,
  Pause,
  Play,
  Building2,
} from "lucide-react";
import { hasPermission } from "../lib/permissions";
import { useAuth } from "../store/AuthContext";
import { useShifts } from "../store/ShiftsContext";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useToast } from "../components/ui/Toast";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { Dialog } from "../components/ui/Dialog";
import { CustomerFormDialog } from "../features/customers/CustomerFormDialog";
import { CustomerVehicleFormDialog } from "../features/vehicles/CustomerVehicleFormDialog";
import { Button } from "../components/ui/Button";
import { Input, Select } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { todayISO, uid } from "../lib/utils";
import { useVirtualizer } from "../lib/useVirtualizer";
import { buildProductSearchIndex, searchProductSearchIndex } from "../lib/partSearchIndex";
import type { CashierShift, InvoiceLine, PartAlternativeRelation, PaymentMethod, Product, SalesInvoice, SalesPaymentType, SalesPriceType } from "../types";
import { formatCurrency, formatDateTime, formatQualityGradeLabel } from "../lib/format";
import { findProductScanCandidates, productMatchesSearch } from "../lib/partSearch";
import { useFeatures } from "../lib/useFeatures";
import { aggregateSalesPriceType } from "../lib/salesPrice";
import { printAppRoute } from "../lib/print";
import { productVehicleFitmentStatus, useAutoPartsPro, vehicleDisplayName } from "../store/AutoPartsProContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { computeCreditPaymentView } from "../store/_pure";
import { OpenShiftDialog } from "../components/shifts/OpenShiftDialog";
import { CloseShiftDialog } from "../components/shifts/CloseShiftDialog";
import { ShiftReportModal } from "../components/shifts/ShiftReportModal";
import { POSReturnLookupDialog } from "../features/returns/POSReturnLookupDialog";
import { SalesReturnDialog } from "../features/returns/SalesReturnDialog";

// ── Held (parked) invoices — persisted in localStorage ──────────────────────
interface HeldInvoice {
  id: string;
  heldAt: string;
  customerName: string;
  customerId: string;
  lines: LineDraft[];
  discount: number;
  notes: string;
  paymentType: SalesPaymentType;
  paymentMethod: PaymentMethod;
  selectedVehicleId: string;
  selectedBranchId: string;
  gross: number;
}

const HELD_INVOICES_KEY = "pos-held-invoices";
function loadHeldInvoices(): HeldInvoice[] {
  try {
    return JSON.parse(localStorage.getItem(HELD_INVOICES_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveHeldInvoices(items: HeldInvoice[]) {
  localStorage.setItem(HELD_INVOICES_KEY, JSON.stringify(items));
}

interface LineDraft {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  priceType: SalesPriceType;
  expiryDate?: string;
}

const DEFAULT_PRICE_TYPE: SalesPriceType = "wholesale";

const ALTERNATIVE_RELATION_LABELS: Record<PartAlternativeRelation, string> = {
  equivalent: "بديل مطابق",
  economy: "بديل اقتصادي",
  premium: "بديل أعلى جودة",
  superseded: "رقم بديل / مُحدّث",
};

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

interface POSProductCardProps {
  prod: Product;
  availableStock: number;
  isOutOfStock: boolean;
  fitmentStatus: string;
  hasAlternatives: boolean;
  price: number;
  selectedVehicle: boolean;
  onClick: () => void;
}

const POSProductCard = memo(function POSProductCard({
  prod,
  availableStock,
  isOutOfStock,
  fitmentStatus,
  hasAlternatives,
  price,
  selectedVehicle,
  onClick,
}: POSProductCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isOutOfStock && !hasAlternatives}
      className={`flex flex-col text-right justify-between p-2.5 border rounded-xl bg-surface transition-all select-none relative ${
        isOutOfStock
          ? hasAlternatives
            ? "opacity-80 cursor-pointer border-amber-500/50 hover:border-amber-500 hover:shadow-md"
            : "opacity-50 cursor-not-allowed border-line bg-surface-muted/30"
          : "border-line hover:border-brand-500 hover:shadow-md hover:scale-[1.01] cursor-pointer"
      }`}
    >
      {/* "يوجد بديل" badge for out-of-stock items with alternatives */}
      {isOutOfStock && hasAlternatives && (
        <span className="absolute -top-2 -right-2 z-10 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow whitespace-nowrap">
          يوجد بديل
        </span>
      )}
      <div className="space-y-1">
        <div className="flex justify-between items-start gap-1">
          <span className="text-[10px] bg-surface-muted px-1.5 py-0.5 rounded text-ink-muted font-bold font-mono truncate max-w-[55px]" title={prod.code}>
            {prod.code}
          </span>
          <Badge
            tone={availableStock <= prod.minStock ? "red" : "green"}
            className="text-[9px] px-1 py-0"
          >
            متاح: {availableStock}
          </Badge>
        </div>
        {selectedVehicle ? (
          <Badge
            tone={fitmentStatus === "compatible" ? "green" : fitmentStatus === "incompatible" ? "red" : "amber"}
            className="text-[9px]"
          >
            {fitmentStatus === "compatible" ? "متوافق" : fitmentStatus === "incompatible" ? "غير متوافق" : "يلزم مطابقة"}
          </Badge>
        ) : null}
        <h3 className="font-semibold text-xs text-ink leading-snug line-clamp-2" title={prod.name}>
          {prod.name}
        </h3>
      </div>

      <div className="mt-2 border-t border-line/60 pt-1.5 flex justify-between items-center">
        <span className="text-[10px] text-ink-faint truncate max-w-[45px]">
          {prod.unit}
        </span>
        <span className="font-bold text-xs text-brand-600">
          {formatCurrency(price)}
        </span>
      </div>
    </button>
  );
});

export function POSPage() {
  const { currentUser } = useAuth();
  const { products: allProducts, customers: allCustomers } = useCatalog();
  const { salesInvoices, addSalesInvoice, applyCustomerCredit } = useInvoicing();
  const { activeShift } = useShifts();
  const { customerBalance } = useReporting();
  const pro = useAutoPartsPro();
  const branchQuantity = pro.branchQuantity;
  const vehicleCatalog = useVehicleCatalog();
  const { isEnabled } = useFeatures();
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const creditPaymentEnabled = isEnabled("creditPayment");
  const creditSalesEnabled = isEnabled("creditSales");
  const toast = useToast();

  const products = useMemo(() => allProducts.filter((p) => !p.archived), [allProducts]);
  const customers = useMemo(() => allCustomers.filter((c) => !c.archived), [allCustomers]);

  const [isCustomerDialogOpen, setIsCustomerDialogOpen] = useState(false);
  const [isVehicleDialogOpen, setIsVehicleDialogOpen] = useState(false);
  const [pendingCustomerName, setPendingCustomerName] = useState("");
  const [stockAlternative, setStockAlternative] = useState<{
    product: Product;
    alternatives: Array<{ product: Product; relation: PartAlternativeRelation }>;
  } | null>(null);

  // Shift Dialogs State
  const [isOpenShiftOpen, setIsOpenShiftOpen] = useState(false);
  const [isCloseShiftOpen, setIsCloseShiftOpen] = useState(false);
  const [selectedShiftForReport, setSelectedShiftForReport] = useState<CashierShift | null>(null);
  const [isShiftReportOpen, setIsShiftReportOpen] = useState(false);

  // ── Return lookup state ──
  const [isReturnLookupOpen, setIsReturnLookupOpen] = useState(false);
  const [returnInvoice, setReturnInvoice] = useState<SalesInvoice | null>(null);

  // ── Held invoices state ──
  const [heldInvoices, setHeldInvoices] = useState<HeldInvoice[]>(loadHeldInvoices);
  const [isHeldListOpen, setIsHeldListOpen] = useState(false);

  const canAddReturn = hasPermission(currentUser, "returns", "add");

  const canOpenShift = hasPermission(currentUser, "pos", "openShift");
  const canCloseShift = hasPermission(currentUser, "pos", "closeShift");

  useEffect(() => {
    // Don't pop the "start a new shift" prompt over the close-shift flow or its
    // Z-Report — activeShift goes null the instant a shift closes, while the
    // cashier is still viewing/printing that shift's report.
    if (!activeShift && canOpenShift && !isCloseShiftOpen && !isShiftReportOpen) {
      setIsOpenShiftOpen(true);
    }
  }, [activeShift, canOpenShift, isCloseShiftOpen, isShiftReportOpen]);

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
  // A restricted employee (currentUser.branchId set) always works their
  // assigned branch; only an unrestricted user (owner, or an employee with no
  // fixed branch) can freely pick one.
  const [selectedBranchId, setSelectedBranchId] = useState(
    currentUser?.branchId ?? pro.branches.find((branch) => branch.isMain)?.id ?? pro.branches[0]?.id ?? "",
  );

  // Barcode & Catalog UI state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("الكل");
  const [openPriceMenuLineId, setOpenPriceMenuLineId] = useState<string | null>(null);
  const priceMenuRef = useRef<HTMLDivElement>(null);

  // ── Resizable split between the cart panel (right, RTL) and the product grid (left) ──
  const POS_CART_WIDTH_DEFAULT = 42;
  const POS_CART_WIDTH_MIN = 28;
  const POS_CART_WIDTH_MAX = 68;
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [cartWidth, setCartWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("pos-cart-width"));
    return saved >= POS_CART_WIDTH_MIN && saved <= POS_CART_WIDTH_MAX ? saved : POS_CART_WIDTH_DEFAULT;
  });

  function startSplitResize(e: React.PointerEvent) {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    let latest = cartWidth;
    function onMove(ev: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      // RTL: the cart panel sits on the right, so its width is measured from the right edge.
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      latest = Math.min(POS_CART_WIDTH_MAX, Math.max(POS_CART_WIDTH_MIN, pct));
      setCartWidth(latest);
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      localStorage.setItem("pos-cart-width", String(Math.round(latest)));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resetSplit() {
    setCartWidth(POS_CART_WIDTH_DEFAULT);
    localStorage.setItem("pos-cart-width", String(POS_CART_WIDTH_DEFAULT));
  }

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
    if (!selectedBranchId && pro.branches[0]) {
      setSelectedBranchId(currentUser?.branchId ?? pro.branches.find((b) => b.isMain)?.id ?? pro.branches[0].id);
    }
  }, [pro.branches, selectedBranchId, currentUser?.branchId]);

  // A restricted employee can't switch away from their assigned branch even
  // if it changes elsewhere (e.g. an admin re-assigns them mid-session).
  useEffect(() => {
    if (currentUser?.branchId && selectedBranchId !== currentUser.branchId) {
      setSelectedBranchId(currentUser.branchId);
    }
  }, [currentUser?.branchId, selectedBranchId]);

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

  const deferredQuery = useDeferredValue(searchQuery);

  const productIndex = useMemo(() => buildProductSearchIndex(products), [products]);

  // Filter products by category and search query using in-memory inverted index
  const filteredProducts = useMemo(() => {
    const searched = searchProductSearchIndex(productIndex, deferredQuery, products);
    return searched.filter((p) => {
      const matchesCategory = selectedCategory === "الكل" || p.category === selectedCategory;
      const fitmentStatus = productVehicleFitmentStatus(p.id, selectedVehicle, vehicleCatalog.productFitments);
      const matchesVehicle = !selectedVehicle || !compatibilityOnly || fitmentStatus === "compatible";
      return matchesCategory && matchesVehicle;
    });
  }, [compatibilityOnly, deferredQuery, productIndex, products, selectedCategory, selectedVehicle, vehicleCatalog.productFitments]);

  const { containerRef: gridContainerRef, virtualItems, paddingTop: gridPaddingTop, paddingBottom: gridPaddingBottom } = useVirtualizer({
    count: filteredProducts.length,
    itemHeight: 135,
    overscan: 4,
  });

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
  const findAlternativesFor = useCallback(
    (product: Product) =>
      vehicleCatalog.productAlternatives
        .filter((link) => link.productId === product.id || link.alternativeProductId === product.id)
        .map((link) => {
          const otherId = link.productId === product.id ? link.alternativeProductId : link.productId;
          const other = products.find((p) => p.id === otherId);
          return other ? { product: other, relation: link.relation } : null;
        })
        .filter((row): row is { product: Product; relation: PartAlternativeRelation } => row !== null),
    [products, vehicleCatalog.productAlternatives],
  );

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
      const alternatives = findAlternativesFor(product);
      if (alternatives.length > 0) {
        setStockAlternative({ product, alternatives });
      } else {
        toast.error("الكمية المطلوبة تتجاوز المخزون المتاح", product.name);
      }
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
  // `fromButton` distinguishes button clicks (which CAN remove the line at
  // qty 0) from keyboard input (which should NOT remove it — the user may
  // just be clearing the field to retype a new number).
  const updateLineQty = (id: string, newQty: number, fromButton = false) => {
    if (fromButton && newQty <= 0) {
      removeLine(id);
      return;
    }
    if (newQty <= 0) return; // ignore non-positive values typed in the input
    
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
    if (!activeShift) {
      toast.error("الوردية مغلقة", "يرجى فتح وردية كاشير جديدة قبل إصدار فواتير المبيعات.");
      setIsOpenShiftOpen(true);
      return;
    }
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
      toast.error("المبلغ المدفوع غير صحيح");
      return;
    }
    if ((paymentType === "account" || remainingDue > 0) && !creditSalesEnabled) {
      toast.error("ميزة البيع الآجل غير مفعّلة في ترخيصك", "سدّد إجمالي الفاتورة أو فعّل الميزة من الباقة.");
      return;
    }

    const customer = customers.find((c) => c.id === customerId)!;
    if (remainingDue > 0 && customer.creditLimit && customer.creditLimit > 0) {
      const currentDebt = Math.max(0, customerBalance(customerId));
      const projectedDebt = currentDebt + remainingDue;
      if (projectedDebt > customer.creditLimit) {
        toast.error(
          "تجاوز الحد الائتماني للعميل",
          `الحد: ${customer.creditLimit.toFixed(2)} — الرصيد الحالي: ${currentDebt.toFixed(2)} — هذه الفاتورة تحتاج ${remainingDue.toFixed(2)} إضافية.`
        );
        return;
      }
    }
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

  // ── Hold / Resume invoice helpers ──
  const holdCurrentInvoice = () => {
    if (lines.length === 0) {
      toast.error("السلة فارغة — لا يوجد ما يُعلّق");
      return;
    }
    const customer = customers.find((c) => c.id === customerId);
    const held: HeldInvoice = {
      id: uid("held"),
      heldAt: new Date().toISOString(),
      customerName: customer?.name ?? "عميل",
      customerId,
      lines: [...lines],
      discount,
      notes,
      paymentType,
      paymentMethod,
      selectedVehicleId,
      selectedBranchId,
      gross,
    };
    const updated = [held, ...heldInvoices];
    setHeldInvoices(updated);
    saveHeldInvoices(updated);
    toast.success("تم تعليق الفاتورة", `${held.customerName} — ${lines.length} صنف`);
    handleResetSale();
  };

  const resumeHeldInvoice = (heldId: string) => {
    const held = heldInvoices.find((h) => h.id === heldId);
    if (!held) return;
    // If current cart has items, hold it first
    if (lines.length > 0) {
      holdCurrentInvoice();
    }
    setCustomerId(held.customerId);
    setLines(held.lines);
    setDiscount(held.discount);
    setNotes(held.notes);
    setPaymentType(held.paymentType);
    setPaymentMethod(held.paymentMethod);
    setSelectedVehicleId(held.selectedVehicleId);
    setSelectedBranchId(held.selectedBranchId);
    const updated = heldInvoices.filter((h) => h.id !== heldId);
    setHeldInvoices(updated);
    saveHeldInvoices(updated);
    setIsHeldListOpen(false);
    toast.info("تم استعادة الفاتورة المعلّقة");
    focusBarcode();
  };

  const deleteHeldInvoice = (heldId: string) => {
    const updated = heldInvoices.filter((h) => h.id !== heldId);
    setHeldInvoices(updated);
    saveHeldInvoices(updated);
    toast.success("تم حذف الفاتورة المعلّقة");
  };

  // Keyboard shortcut listener (F8 hold, F9 return, F10 checkout)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F8") {
        e.preventDefault();
        holdCurrentInvoice();
      } else if (e.key === "F9") {
        e.preventDefault();
        if (canAddReturn) setIsReturnLookupOpen(true);
      } else if (e.key === "F10") {
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
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden gap-2" dir="rtl">
      {/* Shift Status Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-surface py-2 px-3 rounded-xl border border-line shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          {activeShift ? (
            <>
              <Badge tone="green" className="py-0.5 px-2.5 text-xs font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                وردية نشطة #{activeShift.shiftNumber}
              </Badge>
              <div className="text-xs text-ink-muted hidden sm:flex items-center gap-2">
                <span>الكاشير: <strong className="text-ink">{activeShift.cashierName}</strong></span>
                <span className="text-line">|</span>
                <span>وقت الفتح: <strong className="text-ink">{formatDateTime(activeShift.openedAt)}</strong></span>
              </div>
            </>
          ) : (
            <Badge tone="amber" className="py-0.5 px-2.5 text-xs font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              الوردية مغلقة
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {activeShift ? (
            <>
              {canAddReturn && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsReturnLookupOpen(true)}
                  title="مرتجع مبيعات سريع (F9)"
                  className="h-8 text-xs px-2.5"
                >
                  <RotateCcw className="w-3.5 h-3.5 ml-1 text-amber-600" />
                  مرتجع (F9)
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedShiftForReport(activeShift);
                  setIsShiftReportOpen(true);
                }}
                className="h-8 text-xs px-2.5"
              >
                <FileText className="w-3.5 h-3.5 ml-1 text-brand-600" />
                تقرير الوردية
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsCloseShiftOpen(true)}
                disabled={!canCloseShift}
                title={!canCloseShift ? "يتطلب صلاحية إغلاق وردية الكاشير" : undefined}
                className="h-8 text-xs px-2.5"
              >
                <Lock className="w-3.5 h-3.5 ml-1" />
                إغلاق الوردية
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsOpenShiftOpen(true)}
              disabled={!canOpenShift}
              title={!canOpenShift ? "يتطلب صلاحية فتح وردية كاشير جديدة" : undefined}
              className="h-8 text-xs px-2.5"
            >
              <PlayCircle className="w-3.5 h-3.5 ml-1" />
              فتح وردية
            </Button>
          )}
        </div>
      </div>

      {/* Main resizable split */}
      <div
        ref={splitContainerRef}
        className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 lg:gap-2"
        style={{ ["--pos-cart-w" as string]: `${cartWidth}%` } as React.CSSProperties}
      >
        {/* Cart & payment panel (right in RTL) — resizable width */}
        <div className="w-full lg:w-[var(--pos-cart-w)] lg:shrink-0 flex flex-col min-h-0 bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
          {/* Cart Header with Customer & Barcode */}
          <div className="p-2.5 border-b border-line bg-surface-muted/30 space-y-2 shrink-0">
            {/* Top row: Customer & Vehicle side-by-side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {/* Customer select */}
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] font-semibold text-ink-muted shrink-0 flex items-center gap-0.5">
                  <User className="w-3.5 h-3.5 text-brand-600" /> العميل:
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
                  searchPlaceholder="ابحث باسم العميل..."
                  minChars={0}
                  className="flex-1 min-w-0 text-xs"
                  onCreate={(query) => {
                    setPendingCustomerName(query);
                    setIsCustomerDialogOpen(true);
                  }}
                  createLabel={`أضف عميل: "${pendingCustomerName}"`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setPendingCustomerName("");
                    setIsCustomerDialogOpen(true);
                  }}
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-line bg-surface hover:bg-surface-muted text-ink transition-colors shadow-sm"
                  title="إضافة عميل جديد"
                >
                  <Plus className="w-3.5 h-3.5 text-brand-600" />
                </button>
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

              {/* Vehicle select */}
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[11px] font-semibold text-ink-muted shrink-0 flex items-center gap-0.5">
                  <CarFront className="w-3.5 h-3.5 text-cyan-600" /> السيارة:
                </span>
                <SearchableSelect
                  value={selectedVehicleId}
                  onChange={setSelectedVehicleId}
                  options={customerVehicles.map((vehicle) => {
                    const make = vehicleCatalog.vehicleMakes.find((m) => m.id === vehicle.makeId);
                    const label = vehicleDisplayName(vehicle, vehicleCatalog.vehicleMakes, vehicleCatalog.vehicleModels);
                    return {
                      value: vehicle.id,
                      label,
                      image: make?.logoPath || (make?.slug ? `/vehicle-logos/${make.slug}.png` : undefined),
                      searchText: `${label} ${vehicle.plateNumber ?? ""}`,
                    };
                  })}
                  placeholder="بدون تحديد سيارة"
                  searchPlaceholder="ابحث عن سيارة العميل..."
                  minChars={0}
                  className="flex-1 min-w-0 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setIsVehicleDialogOpen(true)}
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-line bg-surface hover:bg-surface-muted text-ink transition-colors shadow-sm"
                  title="إضافة سيارة جديدة"
                >
                  <Plus className="w-3.5 h-3.5 text-cyan-600" />
                </button>
                <CustomerVehicleFormDialog
                  open={isVehicleDialogOpen}
                  onClose={() => setIsVehicleDialogOpen(false)}
                  initialCustomerId={customerId}
                  onCreated={(newVehicleId) => {
                    setSelectedVehicleId(newVehicleId);
                  }}
                />
              </div>
            </div>

            {/* Branch selector if active */}
            {pro.branches.filter((b) => b.active).length > 0 && (
              currentUser?.branchId ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink-muted shrink-0 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> الفرع:
                  </span>
                  <span className="text-xs font-semibold text-brand-600 bg-brand-50 dark:bg-brand-950/30 px-2 py-0.5 rounded border border-brand-200 dark:border-brand-900">
                    {pro.branches.find((b) => b.id === currentUser.branchId)?.name || "فرع محدد"}
                  </span>
                </div>
              ) : pro.branches.filter((b) => b.active).length > 1 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink-muted shrink-0 flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> الفرع:
                  </span>
                  <Select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="flex-1 h-7 text-xs py-0"
                  >
                    {pro.branches.filter((b) => b.active).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                </div>
              ) : null
            )}

            {/* Barcode scanner box */}
            <form onSubmit={handleBarcodeScan} className="flex gap-1.5">
              <div className="relative flex-1">
                <Scan className="absolute right-2.5 top-2 w-4 h-4 text-ink-faint" />
                <Input
                  ref={barcodeInputRef}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="امسح الباركود / Part No. / OEM..."
                  className="pr-9 h-8 text-xs"
                />
              </div>
              <Button type="submit" size="sm" className="px-3 h-8 text-xs font-semibold">
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
                        <td className="py-2 px-1">
                          <p className="font-semibold text-ink text-xs leading-snug">{product.name}</p>
                          <span className="text-[10px] text-ink-faint font-mono" dir="ltr">{product.partNumber || product.code}{product.partBrand ? ` · ${product.partBrand}` : ""}</span>
                        </td>
                        
                        {multiSalePricesEnabled && (
                          <td className="py-2 px-1 text-center">
                            <div ref={priceMenuRef} className="relative inline-block w-full max-w-[140px] text-right text-xs">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenPriceMenuLineId((current) =>
                                    current === line.id ? null : line.id
                                  )
                                }
                                className="flex h-8 w-full items-center justify-between rounded-lg border border-line bg-surface px-2 text-right text-xs text-ink shadow-sm transition hover:border-brand-400 hover:bg-surface-muted focus:outline-none"
                              >
                                <span className="truncate text-right">
                                  {line.priceType === "retail" && product.retailPrice
                                    ? `تجزئة (${formatCurrency(product.retailPrice)})`
                                    : `جملة (${formatCurrency(product.wholesalePrice)})`}
                                </span>
                              </button>

                              {openPriceMenuLineId === line.id && (
                                <div className="absolute right-0 z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      changePriceType(line.id, "wholesale");
                                      setOpenPriceMenuLineId(null);
                                    }}
                                    className="w-full px-2.5 py-2 text-right text-xs text-ink transition hover:bg-surface-muted"
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
                                      className="w-full px-2.5 py-2 text-right text-xs text-ink transition hover:bg-surface-muted"
                                    >
                                      تجزئة ({formatCurrency(product.retailPrice)})
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        )}

                        <td className="py-2 px-1 text-center">
                          <div className="inline-flex items-center border border-line rounded-lg bg-surface">
                            <button
                              type="button"
                              onClick={() => updateLineQty(line.id, line.quantity - 1, true)}
                              className="w-7 h-7 flex items-center justify-center text-ink-muted hover:bg-surface-muted active:bg-line transition-colors rounded-r-lg"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              value={line.quantity}
                              onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) updateLineQty(line.id, v); }}
                              className="w-9 h-7 text-center text-xs font-semibold border-x border-line focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              onClick={() => updateLineQty(line.id, line.quantity + 1, true)}
                              className="w-7 h-7 flex items-center justify-center text-ink-muted hover:bg-surface-muted active:bg-line transition-colors rounded-l-lg"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="py-2 px-1 text-left font-bold text-xs text-ink">
                          {formatCurrency(line.quantity * line.price)}
                        </td>

                        <td className="py-2 px-1 text-left">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
          <div className="p-3 border-t border-line bg-surface-muted/20 shrink-0 space-y-2.5">
            {/* Totals compact summary */}
            <div className="grid grid-cols-2 gap-2 text-sm bg-surface p-2.5 rounded-xl border border-line">
              <div className="space-y-1">
                <div className="flex justify-between text-ink-muted">
                  <span>الإجمالي:</span>
                  <span className="font-bold">{formatCurrency(gross)}</span>
                </div>
                <div className="flex justify-between items-center text-ink-muted">
                  <span>الخصم:</span>
                  <input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-20 text-left border border-line rounded-lg px-2 py-0.5 bg-surface text-ink text-sm font-bold shadow-sm focus:border-brand-500 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                {creditPaymentEnabled && creditAvailable > 0 && (
                  <label className="flex items-center gap-1.5 text-[10px] font-semibold text-brand-600 mt-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useCredit}
                      onChange={(e) => setUseCredit(e.target.checked)}
                      className="rounded text-brand-600 focus:ring-brand-500 w-3 h-3"
                    />
                    رصيد دائن ({formatCurrency(creditAvailable)})
                  </label>
                )}
              </div>

              <div className="space-y-1 border-r border-line pr-2.5">
                <div className="flex justify-between font-bold text-sm text-ink">
                  <span>الصافي:</span>
                  <span className="text-brand-600 text-base">{formatCurrency(invoiceNet)}</span>
                </div>
                <div className="flex justify-between items-center font-semibold text-emerald-700 dark:text-emerald-400">
                  <span>المدفوع:</span>
                  <input
                    type="number"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-24 text-left border border-line rounded-lg px-2 py-1 bg-surface text-emerald-700 dark:text-emerald-400 text-sm font-bold shadow-sm focus:border-emerald-500 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="flex justify-between font-semibold text-sm text-ink-muted">
                  <span>الباقي:</span>
                  <span className={customerChange > 0 ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                    {formatCurrency(customerChange)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment method & Checkout */}
            <div className="space-y-2">
              <div className="flex gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => { setPaymentType("cash"); setPaymentMethod("cash"); }}
                  className={`flex-1 py-1.5 font-bold rounded-lg border text-center text-xs transition-all ${
                    paymentType === "cash" && paymentMethod === "cash"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow"
                      : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                  }`}
                >
                  كاش نقدي
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentType("cash"); setPaymentMethod("card"); }}
                  className={`flex-1 py-1.5 font-bold rounded-lg border text-center text-xs transition-all ${
                    paymentType === "cash" && paymentMethod === "card"
                      ? "bg-indigo-600 text-white border-indigo-600 shadow"
                      : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                  }`}
                >
                  فيزا / كارت
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentType("cash"); setPaymentMethod("vodafone"); }}
                  className={`flex-1 py-1.5 font-bold rounded-lg border text-center text-xs transition-all ${
                    paymentType === "cash" && paymentMethod === "vodafone"
                      ? "bg-red-600 text-white border-red-600 shadow"
                      : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                  }`}
                >
                  فودافون كاش
                </button>
                <button
                  type="button"
                  onClick={() => { setPaymentType("cash"); setPaymentMethod("instapay"); }}
                  className={`flex-1 py-1.5 font-bold rounded-lg border text-center text-xs transition-all ${
                    paymentType === "cash" && paymentMethod === "instapay"
                      ? "bg-blue-600 text-white border-blue-600 shadow"
                      : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                  }`}
                >
                  انستاباي
                </button>
                {creditSalesEnabled && (
                  <button
                    type="button"
                    onClick={() => { setPaymentType("account"); }}
                    className={`flex-1 py-1.5 font-bold rounded-lg border text-center text-xs transition-all ${
                      paymentType === "account"
                        ? "bg-amber-600 text-white border-amber-600 shadow"
                        : "bg-surface text-ink-muted border-line hover:bg-surface-muted/50"
                    }`}
                  >
                    مبيعات آجل
                  </button>
                )}
              </div>

              {/* Hold / Resume & Checkout Row */}
              <div className="flex gap-2 items-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={holdCurrentInvoice}
                  disabled={lines.length === 0}
                  className="h-10 text-xs font-bold rounded-xl px-3"
                  title="تعليق الفاتورة الحالية (F8)"
                >
                  <Pause className="w-3.5 h-3.5 ml-1" /> تعليق (F8)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsHeldListOpen(true)}
                  className="h-10 text-xs font-bold rounded-xl px-3 relative"
                  title="الفواتير المعلّقة"
                >
                  <Play className="w-3.5 h-3.5 ml-1" /> المعلّقة
                  {heldInvoices.length > 0 && (
                    <span className="absolute -top-1.5 -left-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 shadow">
                      {heldInvoices.length}
                    </span>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={submitSale}
                  className="flex-1 h-10 bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold shadow-md rounded-xl"
                >
                  <DollarSign className="w-4 h-4 ml-1" /> إتمام البيع وحفظ (F10)
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Draggable divider — resize the two panels (desktop only) */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startSplitResize}
          onDoubleClick={resetSplit}
          title="اسحب لتغيير عرض اللوحتين — دبل كليك لإعادة الضبط"
          style={{ touchAction: "none" }}
          className="hidden lg:flex shrink-0 w-3 items-center justify-center cursor-col-resize group"
        >
          <div className="h-16 w-1 rounded-full bg-line transition-colors group-hover:bg-brand-400 group-active:bg-brand-500" />
        </div>

        {/* Product grid catalog (left in RTL) — fills the remaining width */}
        <div className="w-full lg:flex-1 lg:min-w-0 flex flex-col min-h-0 bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
          {/* Search & Category Header */}
          <div className="p-3 border-b border-line bg-surface-muted/20 space-y-2 shrink-0">
            {/* Search Input on top */}
            <div className="relative w-full">
              <Search className="absolute right-2.5 top-2.5 w-4 h-4 text-ink-faint" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتج بالاسم أو الرمز..."
                className="pr-9 h-8 text-xs w-full"
              />
            </div>

            {/* Category tabs underneath */}
            <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-thin w-full">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${
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
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50/60 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300">
                <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> عرض القطع المتوافقة فقط</span>
                <input type="checkbox" checked={compatibilityOnly} onChange={(event) => setCompatibilityOnly(event.target.checked)} className="h-3.5 w-3.5 rounded" />
              </label>
            ) : null}
          </div>

          {/* Grid list of Products */}
          <div ref={gridContainerRef} className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            {filteredProducts.length === 0 ? (
              <div className="h-full flex items-center justify-center text-ink-faint text-xs">
                لا توجد منتجات مطابقة للبحث
              </div>
            ) : (
              <div
                className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2"
                style={{ paddingTop: `${gridPaddingTop}px`, paddingBottom: `${gridPaddingBottom}px` }}
              >
                {virtualItems.map(({ index }) => {
                  const prod = filteredProducts[index];
                  if (!prod) return null;
                  const availableStock = branchAvailableAsBaseUnits(prod);
                  const isOutOfStock = availableStock <= 0;
                  const fitmentStatus = productVehicleFitmentStatus(prod.id, selectedVehicle, vehicleCatalog.productFitments);
                  const alternatives = isOutOfStock ? findAlternativesFor(prod) : [];
                  const hasAlternatives = alternatives.length > 0;
                  const price = getProductPrice(prod, DEFAULT_PRICE_TYPE);

                  return (
                    <POSProductCard
                      key={prod.id}
                      prod={prod}
                      availableStock={availableStock}
                      isOutOfStock={isOutOfStock}
                      fitmentStatus={fitmentStatus}
                      hasAlternatives={hasAlternatives}
                      price={price}
                      selectedVehicle={!!selectedVehicle}
                      onClick={() => {
                        if (isOutOfStock && hasAlternatives) {
                          setStockAlternative({ product: prod, alternatives });
                        } else if (!isOutOfStock) {
                          addProductToCart(prod);
                        }
                      }}
                    />
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

      {/* Shift Dialog Modals */}
      <OpenShiftDialog
        open={isOpenShiftOpen}
        onClose={() => setIsOpenShiftOpen(false)}
      />

      <CloseShiftDialog
        shift={activeShift}
        open={isCloseShiftOpen}
        onClose={() => setIsCloseShiftOpen(false)}
        onPrintZReport={(shiftToPrint) => {
          setSelectedShiftForReport(shiftToPrint);
          setIsShiftReportOpen(true);
        }}
      />

      <ShiftReportModal
        shift={selectedShiftForReport}
        open={isShiftReportOpen}
        onClose={() => {
          setIsShiftReportOpen(false);
          setSelectedShiftForReport(null);
        }}
      />

      <Dialog
        open={stockAlternative !== null}
        onClose={() => setStockAlternative(null)}
        title="القطعة اللي دورت عليها خلصت"
        subtitle={stockAlternative ? `${stockAlternative.product.name} — بس عندك بديل متسجّل ليها` : undefined}
        width="md"
        footer={<Button variant="outline" onClick={() => setStockAlternative(null)}>إلغاء</Button>}
      >
        {stockAlternative ? (
          <div className="space-y-2.5" dir="rtl">
            {stockAlternative.alternatives.map(({ product: alt, relation }) => {
              const altAvailable = branchAvailableAsBaseUnits(alt);
              const out = altAvailable <= 0;
              const low = !out && altAvailable <= alt.minStock;
              return (
                <div key={alt.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-brand-700" dir="ltr">{alt.partNumber || alt.code}</span>
                      <Badge tone={relation === "economy" ? "amber" : relation === "premium" ? "indigo" : "green"}>
                        {ALTERNATIVE_RELATION_LABELS[relation]}
                      </Badge>
                      {alt.qualityGrade ? <Badge tone="slate">{formatQualityGradeLabel(alt.qualityGrade)}</Badge> : null}
                    </div>
                    <div className="mt-1 font-semibold text-ink">{alt.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <span>{alt.partBrand || "بدون ماركة"}</span>
                      <span>·</span>
                      <span>{formatCurrency(getProductPrice(alt, DEFAULT_PRICE_TYPE))}</span>
                      <Badge tone={out ? "red" : low ? "amber" : "green"}>
                        {out ? "نافذ" : `متاح: ${altAvailable} ${alt.unit}`}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={out}
                    onClick={() => {
                      setStockAlternative(null);
                      addProductToCart(alt);
                    }}
                    className="shrink-0"
                  >
                    أضِفه للسلة
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </Dialog>

      {/* ── POS Return Lookup ── */}
      <POSReturnLookupDialog
        open={isReturnLookupOpen}
        onClose={() => setIsReturnLookupOpen(false)}
        onSelectInvoice={(inv) => {
          setIsReturnLookupOpen(false);
          setReturnInvoice(inv);
        }}
      />

      {returnInvoice && (
        <SalesReturnDialog
          open={!!returnInvoice}
          onClose={() => setReturnInvoice(null)}
          invoice={returnInvoice}
        />
      )}

      {/* ── Held Invoices List Dialog ── */}
      <Dialog
        open={isHeldListOpen}
        onClose={() => setIsHeldListOpen(false)}
        title="الفواتير المعلّقة"
        subtitle={heldInvoices.length > 0 ? `${heldInvoices.length} فاتورة معلّقة` : undefined}
        width="md"
      >
        {heldInvoices.length === 0 ? (
          <div className="py-10 text-center text-ink-faint text-sm">
            <Pause className="w-10 h-10 mx-auto mb-2 stroke-[1.2]" />
            لا توجد فواتير معلّقة حاليًا
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
            {heldInvoices.map((held) => (
              <div
                key={held.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line p-3.5 bg-surface"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-ink">{held.customerName}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-ink-muted">
                    <span>{new Date(held.heldAt).toLocaleString("ar-EG")}</span>
                    <span className="text-line">·</span>
                    <span>{held.lines.length} صنف</span>
                    <span className="text-line">·</span>
                    <span className="font-semibold">{formatCurrency(held.gross)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => resumeHeldInvoice(held.id)}
                    className="text-xs"
                  >
                    <Play className="w-3.5 h-3.5 ml-1" /> استعادة
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteHeldInvoice(held.id)}
                    className="text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}
