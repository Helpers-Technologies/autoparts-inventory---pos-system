import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CarFront,
  MessageCircle,
  PackageSearch,
  Search,
  Shuffle,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input, Select } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useReporting } from "../store/ReportingContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import type { PurchaseInvoice, SalesInvoice } from "../types";
import { useFeatures } from "../lib/useFeatures";
import { useAuth } from "../store/AuthContext";
import { hasPermission } from "../lib/permissions";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { useAutoPartsPro, vehicleDisplayName } from "../store/AutoPartsProContext";

type DueStatus = "overdue" | "today" | "soon" | "scheduled" | "undated";
type PartyType = "customer" | "supplier";
type PartyDirection = "theyOweUs" | "weOweThem";

interface PartyBalanceRow {
  id: string;
  type: PartyType;
  name: string;
  code?: string;
  phone?: string;
  balance: number;
  direction: PartyDirection;
  openInvoices: number;
  overdueInvoices: number;
  dueSoonInvoices: number;
  lastActivity?: string;
}

interface SalesDueRow {
  invoice: SalesInvoice;
  days: number | null;
  status: DueStatus;
  customerPhone?: string;
  customerCode?: string;
  vehicleLabel?: string;
  vin?: string;
  plateNumber?: string;
  branchName?: string;
  partsSummary: string;
  partsSearch: string;
}

interface PurchaseDueRow {
  invoice: PurchaseInvoice;
  supplierPhone?: string;
  supplierCode?: string;
  partsSummary: string;
  partsSearch: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysUntil(value?: string) {
  const date = dateOnly(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / DAY_MS);
}

function dueStatus(days: number | null): DueStatus {
  if (days === null) return "undated";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "soon";
  return "scheduled";
}

function statusLabel(status: DueStatus, days: number | null) {
  if (status === "undated") return "بدون تاريخ استحقاق";
  if (status === "overdue") return `متأخر ${Math.abs(days ?? 0)} يوم`;
  if (status === "today") return "مستحق اليوم";
  if (status === "soon") return `خلال ${days} يوم`;
  return `بعد ${days} يوم`;
}

function statusTone(status: DueStatus): "red" | "amber" | "blue" | "slate" {
  if (status === "overdue") return "red";
  if (status === "today" || status === "soon") return "amber";
  if (status === "scheduled") return "blue";
  return "slate";
}

function whatsappHref(phone?: string, message?: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  const normalized = digits.startsWith("0") ? `20${digits.slice(1)}` : digits;
  const query = message?.trim() ? `?text=${encodeURIComponent(message.trim())}` : "";
  return `https://wa.me/${normalized}${query}`;
}

function includesTerm(...values: Array<string | number | undefined>) {
  return (term: string) =>
    values.some((value) => String(value ?? "").toLowerCase().includes(term));
}

function invoicePartsSummary(lines: SalesInvoice["lines"] | PurchaseInvoice["lines"]) {
  if (lines.length === 0) return "بدون بنود قطع";
  const visible = lines.slice(0, 2).map((line) => line.partNumber || line.productName);
  const extra = lines.length - visible.length;
  return `${visible.join(" · ")}${extra > 0 ? ` +${extra}` : ""}`;
}

function invoicePartsSearch(lines: SalesInvoice["lines"] | PurchaseInvoice["lines"]) {
  return lines
    .flatMap((line) => [line.productName, line.partNumber, line.partBrand])
    .filter(Boolean)
    .join(" ");
}

export function DuesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { currentUser } = useAuth();
  const { customers, suppliers } = useCatalog();
  const { salesInvoices, purchaseInvoices, settleAllDues, settleSupplierDues } = useInvoicing();
  const { settings } = useSettings();
  const { customerBalance, customerCredit, supplierBalance, supplierCredit } = useReporting();
  const { customerVehicles, branches } = useAutoPartsPro();
  const { vehicleMakes, vehicleModels } = useVehicleCatalog();

  const canViewSales = hasPermission(currentUser, "salesInvoices");
  const canReceiveSales = hasPermission(currentUser, "salesInvoices", "receive");
  const canViewPurchases = hasPermission(currentUser, "purchaseInvoices");
  const canPayPurchases = hasPermission(currentUser, "purchaseInvoices", "pay");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DueStatus | "all">("all");
  const [partyFilter, setPartyFilter] = useState<"all" | PartyType>("all");
  const [activeTab, setActiveTab] = useState("alerts");
  const [branchFilter, setBranchFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [displayLimit, setDisplayLimit] = useState<number | "all">(5);
  const [showAllRows, setShowAllRows] = useState(false);
  const [priorityDisplayLimit, setPriorityDisplayLimit] = useState<number | "all">(5);
  const [showAllPriorityRows, setShowAllPriorityRows] = useState(false);

  const resetFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setPartyFilter("all");
    setBranchFilter("all");
    setDirectionFilter("all");
    setMinAmount("");
    setMaxAmount("");
    setStartDate("");
    setEndDate("");
    setSortBy("default");
  };

  const customerLookup = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers]
  );
  const supplierLookup = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers]
  );
  const customerVehicleLookup = useMemo(
    () => new Map(customerVehicles.map((vehicle) => [vehicle.id, vehicle])),
    [customerVehicles]
  );
  const branchLookup = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch])),
    [branches]
  );

  const salesDueRows = useMemo<SalesDueRow[]>(() => {
    return salesInvoices
      .filter((invoice) => !invoice.cancelled && invoice.remaining > 0)
      .map((invoice) => {
        const customer = customerLookup.get(invoice.customerId);
        const vehicle = invoice.customerVehicleId
          ? customerVehicleLookup.get(invoice.customerVehicleId)
          : undefined;
        const days = daysUntil(invoice.paymentDueDate);
        return {
          invoice,
          days,
          status: dueStatus(days),
          customerPhone: customer?.phone,
          customerCode: customer?.code,
          vehicleLabel:
            invoice.vehicleLabel ||
            (vehicle ? vehicleDisplayName(vehicle, vehicleMakes, vehicleModels) : undefined),
          vin: vehicle?.vin,
          plateNumber: vehicle?.plateNumber,
          branchName:
            invoice.branchName ||
            (invoice.branchId ? branchLookup.get(invoice.branchId)?.name : undefined),
          partsSummary: invoicePartsSummary(invoice.lines),
          partsSearch: invoicePartsSearch(invoice.lines),
        };
      })
      .sort((a, b) => {
        const aRank = a.days ?? 9999;
        const bRank = b.days ?? 9999;
        return aRank - bRank || b.invoice.remaining - a.invoice.remaining;
      });
  }, [
    branchLookup,
    customerLookup,
    customerVehicleLookup,
    salesInvoices,
    vehicleMakes,
    vehicleModels,
  ]);

  const purchaseDueRows = useMemo<PurchaseDueRow[]>(() => {
    return purchaseInvoices
      .filter((invoice) => invoice.remaining > 0)
      .map((invoice) => {
        const supplier = supplierLookup.get(invoice.supplierId);
        return {
          invoice,
          supplierPhone: supplier?.phone,
          supplierCode: supplier?.code,
          partsSummary: invoicePartsSummary(invoice.lines),
          partsSearch: invoicePartsSearch(invoice.lines),
        };
      })
      .sort((a, b) => b.invoice.remaining - a.invoice.remaining);
  }, [purchaseInvoices, supplierLookup]);

  const partyRows = useMemo<PartyBalanceRow[]>(() => {
    const customerRows: PartyBalanceRow[] = customers
      .map((customer) => {
        const balance = customerBalance(customer.id);
        const relatedDueRows = salesDueRows.filter(
          (row) => row.invoice.customerId === customer.id
        );
        const lastActivity = salesInvoices
          .filter((invoice) => invoice.customerId === customer.id && !invoice.cancelled)
          .map((invoice) => invoice.date)
          .sort()
          .at(-1);

        return {
          id: customer.id,
          type: "customer" as const,
          name: customer.name,
          code: customer.code,
          phone: customer.phone,
          balance,
          direction: balance >= 0 ? ("theyOweUs" as const) : ("weOweThem" as const),
          openInvoices: relatedDueRows.length,
          overdueInvoices: relatedDueRows.filter((row) => row.status === "overdue").length,
          dueSoonInvoices: relatedDueRows.filter(
            (row) => row.status === "today" || row.status === "soon"
          ).length,
          lastActivity,
        };
      })
      .filter((row) => row.balance !== 0 || row.openInvoices > 0);

    const supplierRows: PartyBalanceRow[] = suppliers
      .map((supplier) => {
        const balance = supplierBalance(supplier.id);
        const relatedInvoices = purchaseDueRows.filter(
          (row) => row.invoice.supplierId === supplier.id
        );
        const lastActivity = purchaseInvoices
          .filter((invoice) => invoice.supplierId === supplier.id)
          .map((invoice) => invoice.date)
          .sort()
          .at(-1);

        return {
          id: supplier.id,
          type: "supplier" as const,
          name: supplier.name,
          code: supplier.code,
          phone: supplier.phone,
          balance,
          direction: balance > 0 ? ("weOweThem" as const) : ("theyOweUs" as const),
          openInvoices: relatedInvoices.length,
          overdueInvoices: 0,
          dueSoonInvoices: 0,
          lastActivity,
        };
      })
      .filter((row) => row.balance !== 0 || row.openInvoices > 0);

    return [...customerRows, ...supplierRows].sort(
      (a, b) => Math.abs(b.balance) - Math.abs(a.balance)
    );
  }, [
    customers,
    suppliers,
    customerBalance,
    supplierBalance,
    salesDueRows,
    salesInvoices,
    purchaseDueRows,
    purchaseInvoices,
  ]);

  const filteredSalesRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    let result = salesDueRows.filter((row) => {
      if (term) {
        const matches = includesTerm(
          row.invoice.invoiceNumber,
          row.invoice.customerName,
          row.customerCode,
          row.customerPhone,
          row.vehicleLabel,
          row.vin,
          row.plateNumber,
          row.branchName,
          row.partsSearch
        )(term);
        if (!matches) return false;
      }
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (branchFilter !== "all" && row.invoice.branchId !== branchFilter) return false;
      if (minAmount && row.invoice.remaining < Number(minAmount)) return false;
      if (maxAmount && row.invoice.remaining > Number(maxAmount)) return false;
      if (startDate || endDate) {
        if (!row.invoice.paymentDueDate) return false;
        const dueDate = row.invoice.paymentDueDate.split("T")[0];
        if (startDate && dueDate < startDate) return false;
        if (endDate && dueDate > endDate) return false;
      }
      return true;
    });

    if (sortBy === "amountDesc") {
      result = [...result].sort((a, b) => b.invoice.remaining - a.invoice.remaining);
    } else if (sortBy === "amountAsc") {
      result = [...result].sort((a, b) => a.invoice.remaining - b.invoice.remaining);
    } else if (sortBy === "dateAsc") {
      result = [...result].sort((a, b) => {
        const da = a.invoice.paymentDueDate || "9999-12-31";
        const db = b.invoice.paymentDueDate || "9999-12-31";
        return da.localeCompare(db);
      });
    } else if (sortBy === "dateDesc") {
      result = [...result].sort((a, b) => {
        const da = a.invoice.paymentDueDate || "";
        const db = b.invoice.paymentDueDate || "";
        return db.localeCompare(da);
      });
    } else if (sortBy === "nameAsc") {
      result = [...result].sort((a, b) => a.invoice.customerName.localeCompare(b.invoice.customerName, "ar"));
    }

    return result;
  }, [query, salesDueRows, statusFilter, branchFilter, minAmount, maxAmount, startDate, endDate, sortBy]);

  const filteredPartyRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    let result = partyRows.filter((row) => {
      if (term) {
        let matches = includesTerm(row.name, row.code, row.phone)(term);
        if (!matches) {
          if (row.type === "customer") {
            matches = salesDueRows.some(
              (due) =>
                due.invoice.customerId === row.id &&
                includesTerm(
                  due.invoice.invoiceNumber,
                  due.vehicleLabel,
                  due.vin,
                  due.plateNumber,
                  due.branchName,
                  due.partsSearch
                )(term)
            );
          } else {
            matches = purchaseDueRows.some(
              (due) =>
                due.invoice.supplierId === row.id &&
                includesTerm(due.invoice.invoiceNumber, due.partsSearch)(term)
            );
          }
        }
        if (!matches) return false;
      }
      if (partyFilter !== "all" && row.type !== partyFilter) return false;
      if (directionFilter !== "all" && row.direction !== directionFilter) return false;
      if (branchFilter !== "all") {
        if (row.type === "customer") {
          const hasBranchInvoice = salesDueRows.some(
            (due) => due.invoice.customerId === row.id && due.invoice.branchId === branchFilter
          );
          if (!hasBranchInvoice) return false;
        } else {
          const hasBranchInvoice = purchaseDueRows.some(
            (due) => due.invoice.supplierId === row.id && due.invoice.branchId === branchFilter
          );
          if (!hasBranchInvoice) return false;
        }
      }
      const absBalance = Math.abs(row.balance);
      if (minAmount && absBalance < Number(minAmount)) return false;
      if (maxAmount && absBalance > Number(maxAmount)) return false;

      return true;
    });

    if (sortBy === "amountDesc") {
      result = [...result].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    } else if (sortBy === "amountAsc") {
      result = [...result].sort((a, b) => Math.abs(a.balance) - Math.abs(b.balance));
    } else if (sortBy === "nameAsc") {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name, "ar"));
    }

    return result;
  }, [partyFilter, partyRows, purchaseDueRows, query, salesDueRows, directionFilter, branchFilter, minAmount, maxAmount, sortBy]);

  const filteredPurchaseRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    let result = purchaseDueRows.filter((row) => {
      if (term) {
        const matches = includesTerm(
          row.invoice.invoiceNumber,
          row.invoice.supplierName,
          row.supplierCode,
          row.supplierPhone,
          row.partsSearch
        )(term);
        if (!matches) return false;
      }
      if (branchFilter !== "all" && row.invoice.branchId !== branchFilter) return false;
      if (minAmount && row.invoice.remaining < Number(minAmount)) return false;
      if (maxAmount && row.invoice.remaining > Number(maxAmount)) return false;
      if (startDate || endDate) {
        const invDate = row.invoice.date.split("T")[0];
        if (startDate && invDate < startDate) return false;
        if (endDate && invDate > endDate) return false;
      }
      return true;
    });

    if (sortBy === "amountDesc") {
      result = [...result].sort((a, b) => b.invoice.remaining - a.invoice.remaining);
    } else if (sortBy === "amountAsc") {
      result = [...result].sort((a, b) => a.invoice.remaining - b.invoice.remaining);
    } else if (sortBy === "dateAsc") {
      result = [...result].sort((a, b) => a.invoice.date.localeCompare(b.invoice.date));
    } else if (sortBy === "dateDesc") {
      result = [...result].sort((a, b) => b.invoice.date.localeCompare(a.invoice.date));
    } else if (sortBy === "nameAsc") {
      result = [...result].sort((a, b) => a.invoice.supplierName.localeCompare(b.invoice.supplierName, "ar"));
    }

    return result;
  }, [purchaseDueRows, query, branchFilter, minAmount, maxAmount, startDate, endDate, sortBy]);

  const visibleSalesRows = useMemo(() => {
    if (showAllRows || displayLimit === "all") return filteredSalesRows;
    return filteredSalesRows.slice(0, typeof displayLimit === "number" ? displayLimit : 5);
  }, [filteredSalesRows, showAllRows, displayLimit]);

  const visiblePartyRows = useMemo(() => {
    if (showAllRows || displayLimit === "all") return filteredPartyRows;
    return filteredPartyRows.slice(0, typeof displayLimit === "number" ? displayLimit : 5);
  }, [filteredPartyRows, showAllRows, displayLimit]);

  const visiblePurchaseRows = useMemo(() => {
    if (showAllRows || displayLimit === "all") return filteredPurchaseRows;
    return filteredPurchaseRows.slice(0, typeof displayLimit === "number" ? displayLimit : 5);
  }, [filteredPurchaseRows, showAllRows, displayLimit]);

  const totals = useMemo(() => {
    const customerReceivables = partyRows
      .filter((row) => row.type === "customer" && row.balance > 0)
      .reduce((sum, row) => sum + row.balance, 0);
    const customerCredits = partyRows
      .filter((row) => row.type === "customer" && row.balance < 0)
      .reduce((sum, row) => sum + Math.abs(row.balance), 0);
    const supplierPayables = partyRows
      .filter((row) => row.type === "supplier" && row.balance > 0)
      .reduce((sum, row) => sum + row.balance, 0);
    const supplierCredits = partyRows
      .filter((row) => row.type === "supplier" && row.balance < 0)
      .reduce((sum, row) => sum + Math.abs(row.balance), 0);
    const overdueSales = salesDueRows
      .filter((row) => row.status === "overdue")
      .reduce((sum, row) => sum + row.invoice.remaining, 0);
    const dueSoonSales = salesDueRows
      .filter((row) => row.status === "today" || row.status === "soon")
      .reduce((sum, row) => sum + row.invoice.remaining, 0);
    const undatedSales = salesDueRows
      .filter((row) => row.status === "undated")
      .reduce((sum, row) => sum + row.invoice.remaining, 0);

    return {
      customerReceivables,
      customerCredits,
      supplierPayables,
      supplierCredits,
      receivablesTotal: customerReceivables + supplierCredits,
      payablesTotal: supplierPayables + customerCredits,
      overdueSales,
      dueSoonSales,
      undatedSales,
      net: customerReceivables + supplierCredits - supplierPayables - customerCredits,
    };
  }, [partyRows, salesDueRows]);

  const allPriorityRows = useMemo(
    () => salesDueRows.filter((row) => row.status === "overdue" || row.status === "today" || row.status === "soon"),
    [salesDueRows]
  );

  const visiblePriorityRows = useMemo(() => {
    if (showAllPriorityRows || priorityDisplayLimit === "all") return allPriorityRows;
    return allPriorityRows.slice(0, typeof priorityDisplayLimit === "number" ? priorityDisplayLimit : 5);
  }, [allPriorityRows, showAllPriorityRows, priorityDisplayLimit]);

  return (
    <>
      <AutoPartsHero
        icon={CarFront}
        title="مستحقات مبيعات وتوريد قطع الغيار"
        description="تابع تحصيل كل فاتورة مع سيارة العميل ورقم الشاسيه والقطع المباعة والفرع، وراجع التزامات موردي قطع الغيار من شاشة واحدة."
        actions={
          <>
            <Link to="/reports">
              <Button className="h-10 border-white/15 bg-white/10 text-white hover:bg-white/20">
                <PackageSearch className="h-4 w-4" />
                تقارير قطع الغيار
              </Button>
            </Link>
            {canViewSales ? (
              <Link to="/sales">
                <Button variant="outline" className="h-10 border-white/15 bg-white/10 text-white hover:bg-white/20">
                  فواتير البيع
                </Button>
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <StatCard
          icon={<ArrowDownLeft className="w-5 h-5" />}
          label="تحصيل مبيعات قطع الغيار"
          value={formatCurrency(totals.receivablesTotal, settings.currency)}
          detail={`على العملاء: ${formatCurrency(totals.customerReceivables, settings.currency)}`}
          tone="green"
        />
        <StatCard
          icon={<ArrowUpRight className="w-5 h-5" />}
          label="التزامات موردي القطع"
          value={formatCurrency(totals.payablesTotal, settings.currency)}
          detail={`للموردين: ${formatCurrency(totals.supplierPayables, settings.currency)}`}
          tone="red"
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="تحصيلات قطع متأخرة"
          value={formatCurrency(totals.overdueSales, settings.currency)}
          detail={`${salesDueRows.filter((row) => row.status === "overdue").length} فاتورة متأخرة`}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader
          title="أولويات تحصيل مبيعات قطع الغيار"
          subtitle={`مستحق قريباً: ${formatCurrency(totals.dueSoonSales, settings.currency)} - بدون تاريخ استحقاق: ${formatCurrency(totals.undatedSales, settings.currency)}`}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted hidden sm:inline">عدد العرض:</span>
              <Select
                value={priorityDisplayLimit}
                onChange={(e) => {
                  const val = e.target.value;
                  setPriorityDisplayLimit(val === "all" ? "all" : Number(val));
                  setShowAllPriorityRows(false);
                }}
                className="w-28 text-xs h-8 font-semibold"
              >
                <option value={5}>5 أولويات</option>
                <option value={10}>10 أولويات</option>
                <option value={20}>20 أولوية</option>
                <option value={50}>50 أولوية</option>
                <option value="all">عرض الكل</option>
              </Select>
            </div>
          }
        />
        <CardBody className="space-y-3">
          {allPriorityRows.length === 0 ? (
            <div className="min-h-32 grid place-items-center text-sm text-ink-muted">
              لا توجد فواتير قطع غيار متأخرة أو مستحقة قريباً
            </div>
          ) : (
            <>
              {visiblePriorityRows.map((row) => (
                <div
                  key={row.invoice.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {canViewSales ? (
                        <Link
                          to={`/sales/${row.invoice.id}`}
                          className="font-mono text-xs text-brand-700 hover:underline"
                        >
                          {row.invoice.invoiceNumber}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-ink-muted">
                          {row.invoice.invoiceNumber}
                        </span>
                      )}
                      <Badge tone={statusTone(row.status)}>
                        {statusLabel(row.status, row.days)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm font-medium text-ink">
                      {row.invoice.customerName}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      {row.vehicleLabel ? (
                        <span className="inline-flex items-center gap-1">
                          <CarFront className="h-3.5 w-3.5" />
                          {row.vehicleLabel}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <PackageSearch className="h-3.5 w-3.5" />
                        {row.partsSummary}
                      </span>
                      {row.branchName ? (
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" />
                          {row.branchName}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-rose-700 dark:text-rose-400">
                      {formatCurrency(row.invoice.remaining, settings.currency)}
                    </span>
                    <ContactButton
                      phone={row.customerPhone}
                      message={`مرحبًا ${row.invoice.customerName}، تذكير باستحقاق ${formatCurrency(row.invoice.remaining, settings.currency)} لفاتورة قطع الغيار ${row.invoice.invoiceNumber}${row.vehicleLabel ? ` الخاصة بـ ${row.vehicleLabel}` : ""}.`}
                    />
                  </div>
                </div>
              ))}

              {allPriorityRows.length > (typeof priorityDisplayLimit === "number" ? priorityDisplayLimit : allPriorityRows.length) && (
                <div className="pt-3 text-center border-t border-line mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-faint">
                    يتم عرض {visiblePriorityRows.length} من أصل {allPriorityRows.length} أولوية
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllPriorityRows(!showAllPriorityRows)}
                    className="text-xs font-bold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 gap-1.5"
                  >
                    {showAllPriorityRows ? (
                      <>
                        <ChevronUp className="w-4 h-4" /> عرض أقل (عرض 5 فقط)
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" /> عرض المزيد ({allPriorityRows.length - visiblePriorityRows.length} أولويات متبقية)
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[280px]">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث باسم، فاتورة، رقم قطعة، VIN، لوحة، سيارة أو فرع..."
                className="pe-9"
              />
            </div>

            {branches.length > 1 && (
              <Select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="w-full md:w-44"
              >
                <option value="all">كل الفروع</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}

            <Select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="w-full md:w-44"
            >
              <option value="default">الترتيب التلقائي</option>
              <option value="amountDesc">المبلغ المتبقي (الأعلى أولاً)</option>
              <option value="amountAsc">المبلغ المتبقي (الأقل أولاً)</option>
              {activeTab !== "parties" && <option value="dateAsc">تاريخ الاستحقاق (الأقدم أولاً)</option>}
              {activeTab !== "parties" && <option value="dateDesc">تاريخ الاستحقاق (الأحدث أولاً)</option>}
              <option value="nameAsc">الاسم أبجدياً (أ-ي)</option>
            </Select>

            <Button
              variant="outline"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 h-10"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>فلترة متقدمة</span>
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>

            <Button
              variant="outline"
              onClick={resetFilters}
              className="h-10 text-ink-muted hover:text-ink gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              مسح الفلاتر
            </Button>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-line/60">
              {activeTab === "alerts" && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-muted">حالة التحصيل</label>
                  <Select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as DueStatus | "all")}
                    className="w-full"
                  >
                    <option value="all">كل الحالات</option>
                    <option value="overdue">متأخر</option>
                    <option value="today">مستحق اليوم</option>
                    <option value="soon">خلال 7 أيام</option>
                    <option value="scheduled">مجدول لاحقاً</option>
                    <option value="undated">بدون تاريخ استحقاق</option>
                  </Select>
                </div>
              )}

              {activeTab === "parties" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-muted">نوع الطرف</label>
                    <Select
                      value={partyFilter}
                      onChange={(event) => setPartyFilter(event.target.value as "all" | PartyType)}
                      className="w-full"
                    >
                      <option value="all">كل الأطراف</option>
                      <option value="customer">العملاء</option>
                      <option value="supplier">الموردين</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-muted">حالة الحساب</label>
                    <Select
                      value={directionFilter}
                      onChange={(event) => setDirectionFilter(event.target.value)}
                      className="w-full"
                    >
                      <option value="all">كل الأرصدة</option>
                      <option value="theyOweUs">مدين (مستحق لنا)</option>
                      <option value="weOweThem">دائن (مستحق عليهم)</option>
                    </Select>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-muted">الحد الأدنى للمبلغ</label>
                <Input
                  type="number"
                  placeholder="مثال: 1000"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-full text-start"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-ink-muted">الحد الأقصى للمبلغ</label>
                <Input
                  type="number"
                  placeholder="مثال: 5000"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="w-full text-start"
                />
              </div>

              {activeTab !== "parties" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-muted">من تاريخ</label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full text-start"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-muted">إلى تاريخ</label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full text-start"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val)}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="alerts">تحصيل مبيعات القطع</TabsTrigger>
          <TabsTrigger value="parties">أرصدة العملاء والموردين</TabsTrigger>
          <TabsTrigger value="suppliers">مديونية موردي القطع</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
          <Card>
            <CardHeader
              title="فواتير بيع قطع الغيار المفتوحة"
              subtitle="السيارة ورقم الشاسيه والقطع والفرع ظاهرة مع كل استحقاق"
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted hidden sm:inline">عدد العرض:</span>
                  <Select
                    value={displayLimit}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDisplayLimit(val === "all" ? "all" : Number(val));
                      setShowAllRows(false);
                    }}
                    className="w-28 text-xs h-8 font-semibold"
                  >
                    <option value={5}>5 فواتير</option>
                    <option value={10}>10 فواتير</option>
                    <option value={20}>20 فاتورة</option>
                    <option value={50}>50 فاتورة</option>
                    <option value="all">عرض الكل</option>
                  </Select>
                </div>
              }
            />
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>الفاتورة</TH>
                    <TH>العميل</TH>
                    <TH>السيارة وقطع الغيار</TH>
                    <TH>تاريخ الفاتورة</TH>
                    <TH>ميعاد الدفع</TH>
                    <TH>الحالة</TH>
                    <TH className="text-end">المتبقي</TH>
                    <TH className="text-end">إجراءات</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredSalesRows.length === 0 ? (
                    <EmptyRow colSpan={8} text="لا توجد فواتير قطع غيار مطابقة" />
                  ) : (
                    visibleSalesRows.map((row) => (
                      <TR key={row.invoice.id}>
                        <TD>
                          {canViewSales ? (
                            <Link
                              to={`/sales/${row.invoice.id}`}
                              className="font-mono text-xs text-brand-700 hover:underline"
                            >
                              {row.invoice.invoiceNumber}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-ink-muted">
                              {row.invoice.invoiceNumber}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <div className="font-medium text-ink">
                            {row.invoice.customerName}
                          </div>
                          <div className="text-xs text-ink-muted">
                            {row.customerPhone || row.customerCode || "—"}
                          </div>
                        </TD>
                        <TD className="min-w-64">
                          <div className="flex items-start gap-2">
                            <CarFront className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-ink">
                                {row.vehicleLabel || "لم تُربط سيارة بالفاتورة"}
                              </div>
                              {(row.vin || row.plateNumber) && (
                                <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-ink-faint" dir="ltr">
                                  {row.vin ? <span>VIN {row.vin}</span> : null}
                                  {row.plateNumber ? <span>PLATE {row.plateNumber}</span> : null}
                                </div>
                              )}
                              <div className="mt-1 text-xs text-ink-muted">
                                {row.partsSummary}
                              </div>
                              {row.branchName ? (
                                <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-faint">
                                  <Building2 className="h-3 w-3" />
                                  {row.branchName}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </TD>
                        <TD>{formatDate(row.invoice.date)}</TD>
                        <TD>{row.invoice.paymentDueDate ? formatDate(row.invoice.paymentDueDate) : "—"}</TD>
                        <TD>
                          <Badge tone={statusTone(row.status)}>
                            {statusLabel(row.status, row.days)}
                          </Badge>
                        </TD>
                        <TD className="text-end font-mono font-semibold text-rose-700 dark:text-rose-400">
                          {formatCurrency(row.invoice.remaining, settings.currency)}
                        </TD>
                        <TD className="text-end">
                          <div className="inline-flex items-center gap-1">
                            <ContactButton
                              phone={row.customerPhone}
                              compact
                              message={`مرحبًا ${row.invoice.customerName}، تذكير باستحقاق ${formatCurrency(row.invoice.remaining, settings.currency)} لفاتورة قطع الغيار ${row.invoice.invoiceNumber}${row.vehicleLabel ? ` الخاصة بـ ${row.vehicleLabel}` : ""}.`}
                            />
                            {canViewSales ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/sales/${row.invoice.id}`)}
                              >
                                عرض
                              </Button>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>

              {filteredSalesRows.length > (typeof displayLimit === "number" ? displayLimit : filteredSalesRows.length) && (
                <div className="pt-3 text-center border-t border-line mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-faint">
                    يتم عرض {visibleSalesRows.length} من أصل {filteredSalesRows.length} فاتورة
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllRows(!showAllRows)}
                    className="text-xs font-bold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 gap-1.5"
                  >
                    {showAllRows ? (
                      <>
                        <ChevronUp className="w-4 h-4" /> عرض أقل (عرض 5 فقط)
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" /> عرض المزيد ({filteredSalesRows.length - visibleSalesRows.length} فواتير متبقية)
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="parties">
          <Card>
            <CardHeader
              title="حسابات عملاء وموردي قطع الغيار"
              subtitle="الأرصدة الدائنة والمدينة وعدد فواتير البيع والتوريد المفتوحة"
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted hidden sm:inline">عدد العرض:</span>
                  <Select
                    value={displayLimit}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDisplayLimit(val === "all" ? "all" : Number(val));
                      setShowAllRows(false);
                    }}
                    className="w-28 text-xs h-8 font-semibold"
                  >
                    <option value={5}>5 عناصر</option>
                    <option value={10}>10 عناصر</option>
                    <option value={20}>20 عنصر</option>
                    <option value={50}>50 عنصر</option>
                    <option value="all">عرض الكل</option>
                  </Select>
                </div>
              }
            />
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>الطرف</TH>
                    <TH>النوع</TH>
                    <TH>الحالة</TH>
                    <TH className="text-end">الرصيد</TH>
                    <TH className="text-end">فواتير مفتوحة</TH>
                    <TH className="text-end">متأخر</TH>
                    <TH>آخر حركة</TH>
                    <TH className="text-end">إجراءات</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredPartyRows.length === 0 ? (
                    <EmptyRow colSpan={8} text="لا توجد أرصدة مطابقة" />
                  ) : (
                    visiblePartyRows.map((row) => (
                      <TR key={`${row.type}-${row.id}`}>
                        <TD>
                          <div className="font-medium text-ink">{row.name}</div>
                          <div className="text-xs text-ink-muted">{row.code || row.phone || "—"}</div>
                        </TD>
                        <TD>
                          <Badge tone={row.type === "customer" ? "blue" : "indigo"}>
                            {row.type === "customer" ? "عميل" : "مورد"}
                          </Badge>
                        </TD>
                        <TD>
                          <Badge tone={row.direction === "theyOweUs" ? "green" : "rose"}>
                            {row.direction === "theyOweUs" ? "مدين للمحل" : "دائن لدى المحل"}
                          </Badge>
                        </TD>
                        <TD className="text-end font-mono font-semibold">
                          {formatCurrency(Math.abs(row.balance), settings.currency)}
                        </TD>
                        <TD className="text-end">{row.openInvoices}</TD>
                        <TD className="text-end">
                          {row.overdueInvoices > 0 ? (
                            <Badge tone="red">{row.overdueInvoices}</Badge>
                          ) : (
                            <span className="text-ink-faint">0</span>
                          )}
                        </TD>
                        <TD>{row.lastActivity ? formatDate(row.lastActivity) : "—"}</TD>
                        <TD className="text-end">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {row.type === "customer" &&
                              canReceiveSales &&
                              customerCredit(row.id) > 0 &&
                              row.openInvoices > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/40 hover:bg-emerald-50 dark:bg-emerald-500/10 gap-1"
                                  title={`تسوية الرصيد الدائن ${formatCurrency(customerCredit(row.id), settings.currency)} من مستحقات ${row.name}`}
                                  onClick={() => {
                                    const settled = settleAllDues(row.id);
                                    if (settled > 0) {
                                      toast.success(
                                        "تسوية الرصيد",
                                        `تم تسوية ${formatCurrency(settled, settings.currency)} من رصيد ${row.name}`
                                      );
                                    }
                                  }}
                                >
                                  <Shuffle className="w-3.5 h-3.5" />
                                  تسوية
                                </Button>
                              )}
                            {row.type === "supplier" &&
                              canPayPurchases &&
                              supplierCredit(row.id) > 0 &&
                              row.openInvoices > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/40 hover:bg-emerald-50 dark:bg-emerald-500/10 gap-1"
                                  title={`تسوية الرصيد الدائن ${formatCurrency(supplierCredit(row.id), settings.currency)} من مستحقات ${row.name}`}
                                  onClick={() => {
                                    const settled = settleSupplierDues(row.id);
                                    if (settled > 0) {
                                      toast.success(
                                        "تسوية الرصيد",
                                        `تم تسوية ${formatCurrency(settled, settings.currency)} من رصيد ${row.name}`
                                      );
                                    }
                                  }}
                                >
                                  <Shuffle className="w-3.5 h-3.5" />
                                  تسوية
                                </Button>
                              )}
                            <ContactButton phone={row.phone} compact />
                          </div>
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>

              {filteredPartyRows.length > (typeof displayLimit === "number" ? displayLimit : filteredPartyRows.length) && (
                <div className="pt-3 text-center border-t border-line mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-faint">
                    يتم عرض {visiblePartyRows.length} من أصل {filteredPartyRows.length} سجل
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllRows(!showAllRows)}
                    className="text-xs font-bold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 gap-1.5"
                  >
                    {showAllRows ? (
                      <>
                        <ChevronUp className="w-4 h-4" /> عرض أقل (عرض 5 فقط)
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" /> عرض المزيد ({filteredPartyRows.length - visiblePartyRows.length} سجلات متبقية)
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers">
          <Card>
            <CardHeader
              title="فواتير توريد قطع الغيار المفتوحة"
              subtitle="راجع القطع الموجودة في كل فاتورة قبل سداد مستحق المورد"
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-muted hidden sm:inline">عدد العرض:</span>
                  <Select
                    value={displayLimit}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDisplayLimit(val === "all" ? "all" : Number(val));
                      setShowAllRows(false);
                    }}
                    className="w-28 text-xs h-8 font-semibold"
                  >
                    <option value={5}>5 فواتير</option>
                    <option value={10}>10 فواتير</option>
                    <option value={20}>20 فاتورة</option>
                    <option value={50}>50 فاتورة</option>
                    <option value="all">عرض الكل</option>
                  </Select>
                </div>
              }
            />
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>الفاتورة</TH>
                    <TH>المورد</TH>
                    <TH>قطع التوريد</TH>
                    <TH>التاريخ</TH>
                    <TH className="text-end">الإجمالي</TH>
                    <TH className="text-end">المدفوع</TH>
                    <TH className="text-end">المتبقي</TH>
                    <TH className="text-end">إجراءات</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredPurchaseRows.length === 0 ? (
                    <EmptyRow colSpan={8} text="لا توجد مستحقات موردي قطع غيار مطابقة" />
                  ) : (
                    visiblePurchaseRows.map((row) => (
                      <TR key={row.invoice.id}>
                        <TD>
                          {canViewPurchases ? (
                            <Link
                              to={`/purchases/${row.invoice.id}`}
                              className="font-mono text-xs text-brand-700 hover:underline"
                            >
                              {row.invoice.invoiceNumber}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-ink-muted">
                              {row.invoice.invoiceNumber}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <div className="font-medium text-ink">
                            {row.invoice.supplierName}
                          </div>
                          <div className="text-xs text-ink-muted">
                            {row.supplierPhone || row.supplierCode || "—"}
                          </div>
                        </TD>
                        <TD className="min-w-56">
                          <div className="flex items-start gap-2">
                            <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                            <div>
                              <div className="text-sm text-ink">{row.partsSummary}</div>
                              <div className="mt-0.5 text-[11px] text-ink-faint">
                                {row.invoice.lines.length} بند توريد
                              </div>
                            </div>
                          </div>
                        </TD>
                        <TD>{formatDate(row.invoice.date)}</TD>
                        <TD className="text-end font-mono">
                          {formatCurrency(row.invoice.total, settings.currency)}
                        </TD>
                        <TD className="text-end font-mono text-emerald-700 dark:text-emerald-400">
                          {formatCurrency(row.invoice.amountPaid, settings.currency)}
                        </TD>
                        <TD className="text-end font-mono font-semibold text-rose-700 dark:text-rose-400">
                          {formatCurrency(row.invoice.remaining, settings.currency)}
                        </TD>
                        <TD className="text-end">
                          <div className="inline-flex items-center gap-1">
                            <ContactButton
                              phone={row.supplierPhone}
                              compact
                              message={`مرحبًا، نراجع مستحق فاتورة توريد قطع الغيار ${row.invoice.invoiceNumber} بقيمة متبقية ${formatCurrency(row.invoice.remaining, settings.currency)}.`}
                            />
                            {canViewPurchases ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/purchases/${row.invoice.id}`)}
                              >
                                عرض
                              </Button>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>

              {filteredPurchaseRows.length > (typeof displayLimit === "number" ? displayLimit : filteredPurchaseRows.length) && (
                <div className="pt-3 text-center border-t border-line mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-faint">
                    يتم عرض {visiblePurchaseRows.length} من أصل {filteredPurchaseRows.length} فاتورة
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllRows(!showAllRows)}
                    className="text-xs font-bold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 gap-1.5"
                  >
                    {showAllRows ? (
                      <>
                        <ChevronUp className="w-4 h-4" /> عرض أقل (عرض 5 فقط)
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" /> عرض المزيد ({filteredPurchaseRows.length - visiblePurchaseRows.length} فواتير متبقية)
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
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
  tone: "green" | "red" | "amber" | "blue";
}) {
  const colors: Record<typeof tone, string> = {
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    red: "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400",
  };

  return (
    <div className="bg-surface border border-line rounded-xl p-4 flex items-center gap-3 shadow-card">
      <div className={`w-11 h-11 rounded-lg grid place-items-center shrink-0 ${colors[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-ink-faint">{label}</div>
        <div className="font-semibold text-ink text-lg truncate">{value}</div>
        <div className="text-[11px] text-ink-faint truncate">{detail}</div>
      </div>
    </div>
  );
}


function ContactButton({
  phone,
  compact,
  message,
}: {
  phone?: string;
  compact?: boolean;
  message?: string;
}) {
  const { isEnabled } = useFeatures();
  if (!isEnabled("whatsappIntegration")) return null;
  const href = whatsappHref(phone, message);
  if (!href) {
    return (
      <span className="inline-flex items-center justify-center h-8 px-2 text-xs text-ink-faint">
        لا يوجد هاتف
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center justify-center gap-1 h-8 px-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
      title="فتح واتساب"
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {compact ? null : <span>واتساب</span>}
    </a>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <TR>
      <TD colSpan={colSpan} className="py-8 text-center text-ink-faint">
        {text}
      </TD>
    </TR>
  );
}
