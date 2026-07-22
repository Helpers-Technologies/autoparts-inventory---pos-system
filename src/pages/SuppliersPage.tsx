import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  Eye,
  Factory,
  Search,
  ScrollText,
  Archive,
  ArchiveRestore,
  Wallet,
  ShoppingBag,
  Package,
  Gift,
} from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Select } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { ConfirmDialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { SupplierFormDialog } from "../features/suppliers/SupplierForm";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import type { Supplier } from "../types";
import { hasPermission } from "../lib/permissions";
import { Link, useLocation } from "react-router-dom";

type Segment = "all" | "payable" | "credit" | "inactive";
type SortKey = "recent" | "purchases" | "balance" | "name" | "new";

interface SupplierRow {
  supplier: Supplier;
  archived: boolean;
  invoiceCount: number;
  totalPurchases: number;
  lastActivity?: string;
  parts: number;
  balance: number;
  commissionEarned: number;
}

export function SuppliersPage() {
  const { suppliers, products, deleteSupplier, archiveSupplier } = useCatalog();
  const { purchaseInvoices } = useInvoicing();
  const { supplierBalance, calculateSupplierCommission } = useReporting();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const loc = useLocation();
  const canAddSupplier = hasPermission(currentUser, "suppliers", "add");
  const canEditSupplier = hasPermission(currentUser, "suppliers", "edit");
  const canDeleteSupplier = hasPermission(currentUser, "suppliers", "delete");

  const [q, setQ] = useState<string>((loc.state as { initialSearch?: string } | null)?.initialSearch ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "/" || (e.ctrlKey && e.key === "f")) && searchRef.current && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [toDelete, setToDelete] = useState<Supplier | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [segment, setSegment] = useState<Segment>("all");
  const [sortBy, setSortBy] = useState<SortKey>("recent");

  // ── Per-supplier analytics ──
  const allRows = useMemo<SupplierRow[]>(() => {
    return suppliers.map((s) => {
      const invs = purchaseInvoices.filter((p) => p.supplierId === s.id);
      const totalPurchases = invs.reduce((sum, p) => sum + p.total, 0);
      const lastActivity = invs.map((p) => p.date).sort().at(-1);
      const parts = products.filter((p) => p.supplierId === s.id && !p.archived).length;
      const commissionEarned = calculateSupplierCommission(s.id).reduce((sum, r) => sum + r.earned, 0);
      return {
        supplier: s,
        archived: !!s.archived,
        invoiceCount: invs.length,
        totalPurchases,
        lastActivity,
        parts,
        balance: supplierBalance(s.id),
        commissionEarned,
      };
    });
  }, [suppliers, products, purchaseInvoices, supplierBalance, calculateSupplierCommission]);

  const rows = useMemo(() => allRows.filter((r) => !r.archived), [allRows]);
  const archivedRows = useMemo(() => allRows.filter((r) => r.archived), [allRows]);
  const archivedCount = archivedRows.length;

  const stats = useMemo(() => {
    let totalPurchases = 0;
    let payables = 0;
    let commission = 0;
    let debtors = 0;
    for (const r of rows) {
      totalPurchases += r.totalPurchases;
      commission += r.commissionEarned;
      if (r.balance > 0) {
        payables += r.balance;
        debtors += 1;
      }
    }
    return { count: rows.length, totalPurchases, payables, commission, debtors };
  }, [rows]);

  const segCounts = useMemo(
    () => ({
      all: rows.length,
      payable: rows.filter((r) => r.balance > 0).length,
      credit: rows.filter((r) => r.balance < 0).length,
      inactive: rows.filter((r) => r.invoiceCount === 0).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (t) {
        const matches =
          r.supplier.name.toLowerCase().includes(t) ||
          (r.supplier.phone ?? "").toLowerCase().includes(t) ||
          (r.supplier.code ?? "").toLowerCase().includes(t);
        if (!matches) return false;
      }
      if (segment === "payable") return r.balance > 0;
      if (segment === "credit") return r.balance < 0;
      if (segment === "inactive") return r.invoiceCount === 0;
      return true;
    });
    list = [...list];
    switch (sortBy) {
      case "purchases":
        list.sort((a, b) => b.totalPurchases - a.totalPurchases);
        break;
      case "balance":
        list.sort((a, b) => b.balance - a.balance);
        break;
      case "name":
        list.sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, "ar"));
        break;
      case "new":
        list.sort((a, b) => (b.supplier.createdAt ?? "").localeCompare(a.supplier.createdAt ?? ""));
        break;
      case "recent":
      default:
        list.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
        break;
    }
    return list;
  }, [rows, q, segment, sortBy]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(s: Supplier) {
    setEditing(s);
    setFormOpen(true);
  }
  function handleDelete() {
    if (!toDelete) return;
    const ok = deleteSupplier(toDelete.id);
    if (ok) {
      toast.success("تم حذف المورد");
    } else {
      archiveSupplier(toDelete.id, true);
      toast.success("تم أرشفة المورد", "المورد محفوظ في الأرشيف ويمكن استعادته");
    }
    setToDelete(null);
  }

  return (
    <>
      <AutoPartsHero
        icon={Factory}
        title="موردو ومصانع قطع الغيار"
        description="قاعدة بيانات الموردين مع مشترياتهم وأرصدتهم والأصناف الموردة وبونص العمولات — تابع كل مورد وكشف حسابه من مكان واحد."
        actions={
          canAddSupplier ? (
            <Button onClick={openNew} className="h-10 bg-amber-400 text-slate-950 hover:bg-amber-300">
              <Plus className="w-4 h-4" />
              إضافة مورد
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          icon={<Factory className="w-5 h-5" />}
          label="إجمالي الموردين"
          value={String(stats.count)}
          detail={archivedCount > 0 ? `${archivedCount} في الأرشيف` : "كل الموردين نشطون"}
          tone="blue"
        />
        <StatCard
          icon={<ShoppingBag className="w-5 h-5" />}
          label="إجمالي المشتريات"
          value={formatCurrency(stats.totalPurchases, settings.currency)}
          detail="قيمة كل فواتير الشراء"
          tone="indigo"
        />
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="مستحق للموردين"
          value={formatCurrency(stats.payables, settings.currency)}
          detail={stats.debtors > 0 ? `${stats.debtors} مورد له مستحقات` : "لا مستحقات"}
          tone="amber"
        />
        <StatCard
          icon={<Gift className="w-5 h-5" />}
          label="بونص عمولات مستحق"
          value={formatCurrency(stats.commission, settings.currency)}
          detail="من شرائح عمولات الموردين"
          tone="green"
        />
      </div>

      <Card>
        <CardHeader
          title="قائمة الموردين"
          subtitle={`عرض ${visible.length} من ${rows.length} مورد`}
          actions={archivedCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-ink-muted"
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive className="w-3.5 h-3.5" />
              {showArchived ? "إخفاء الأرشيف" : `الأرشيف (${archivedCount})`}
            </Button>
          ) : undefined}
        />
        <CardBody className="space-y-3">
          {/* Controls: search + sort */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث بالاسم أو الهاتف أو الكود (/ أو Ctrl+F)"
                className="pe-9"
              />
            </div>
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="w-full sm:w-52"
            >
              <option value="recent">الأحدث توريداً</option>
              <option value="purchases">الأكثر توريداً</option>
              <option value="balance">الأعلى مديونية</option>
              <option value="name">الاسم أبجدياً (أ-ي)</option>
              <option value="new">الأحدث إضافةً</option>
            </Select>
          </div>

          {/* Segment filter chips */}
          <div className="flex flex-wrap gap-1.5">
            <SegmentChip label="الكل" count={segCounts.all} active={segment === "all"} onClick={() => setSegment("all")} />
            <SegmentChip label="مستحق عليهم" count={segCounts.payable} active={segment === "payable"} onClick={() => setSegment("payable")} tone="amber" />
            <SegmentChip label="لنا رصيد" count={segCounts.credit} active={segment === "credit"} onClick={() => setSegment("credit")} tone="green" />
            <SegmentChip label="بدون تعاملات" count={segCounts.inactive} active={segment === "inactive"} onClick={() => setSegment("inactive")} tone="slate" />
          </div>

          {visible.length === 0 && (!showArchived || archivedRows.length === 0) ? (
            <EmptyState
              icon={<Factory className="w-5 h-5" />}
              title={q.trim() || segment !== "all" ? "لا يوجد موردون مطابقون" : "لا يوجد موردون"}
              description={q.trim() || segment !== "all" ? "جرّب تعديل البحث أو الفلتر." : "ابدأ بإضافة أول مورد لشركتك."}
              action={
                canAddSupplier && !q.trim() && segment === "all" ? (
                  <Button onClick={openNew}><Plus className="w-4 h-4" /> إضافة مورد</Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المورد</TH>
                  <TH>الهاتف</TH>
                  <TH className="text-center">أصناف</TH>
                  <TH className="text-center">الفواتير</TH>
                  <TH className="text-end">إجمالي المشتريات</TH>
                  <TH>آخر توريد</TH>
                  <TH className="text-end">الرصيد المستحق</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map(({ supplier: s, invoiceCount, totalPurchases, lastActivity, parts, balance }) => (
                  <TR key={s.id}>
                    <TD>
                      <Link to={`/suppliers/${s.id}`} className="flex items-center gap-2.5 text-start group">
                        <span className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 grid place-items-center shrink-0">
                          <Factory className="w-4 h-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium text-ink group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors truncate">{s.name}</span>
                          <span className="block font-mono text-[11px] text-ink-faint">{s.code ?? "—"}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-ink-muted" dir="ltr">{s.phone ?? "—"}</TD>
                    <TD className="text-center">
                      {parts > 0 ? (
                        <span className="inline-flex items-center gap-1 text-ink-muted">
                          <Package className="w-3.5 h-3.5 text-brand-600" />
                          {parts}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TD>
                    <TD className="text-center text-ink-muted">{invoiceCount > 0 ? invoiceCount : <span className="text-ink-faint">—</span>}</TD>
                    <TD className="text-end font-mono text-ink">{totalPurchases > 0 ? formatCurrency(totalPurchases, settings.currency) : <span className="text-ink-faint">—</span>}</TD>
                    <TD className="text-ink-muted text-xs">{lastActivity ? formatDate(lastActivity) : <span className="text-ink-faint">لا يوجد</span>}</TD>
                    <TD className="text-end">
                      {balance > 0 ? (
                        <Badge tone="amber">{formatCurrency(balance, settings.currency)}</Badge>
                      ) : balance < 0 ? (
                        <Badge tone="green">لنا {formatCurrency(-balance, settings.currency)}</Badge>
                      ) : (
                        <Badge tone="slate">مسدد</Badge>
                      )}
                    </TD>
                    <TD className="text-end">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          to={`/suppliers/${s.id}/statement`}
                          title="كشف حساب"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
                        >
                          <ScrollText className="w-4 h-4" />
                        </Link>
                        <Link
                          to={`/suppliers/${s.id}`}
                          title="عرض الملف"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        {canEditSupplier ? (
                          <Button size="icon" variant="ghost" title="تعديل" onClick={() => openEdit(s)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        ) : null}
                        {canDeleteSupplier ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="حذف"
                            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10"
                            onClick={() => setToDelete(s)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
                {showArchived && archivedRows.map(({ supplier: s }) => (
                  <TR key={s.id} className="opacity-60 bg-surface-muted">
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-lg bg-surface-muted border border-line text-ink-faint grid place-items-center shrink-0">
                          <Factory className="w-4 h-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-ink-muted line-through truncate">{s.name}</span>
                          <span className="block font-mono text-[11px] text-ink-faint">{s.code ?? "—"}</span>
                        </span>
                      </div>
                    </TD>
                    <TD className="text-ink-faint" dir="ltr">{s.phone ?? "—"}</TD>
                    <TD className="text-center text-ink-faint">—</TD>
                    <TD className="text-center text-ink-faint">—</TD>
                    <TD className="text-end text-ink-faint">—</TD>
                    <TD className="text-ink-faint text-xs">مؤرشف</TD>
                    <TD />
                    <TD className="text-end">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-ink-muted h-7 text-xs"
                          onClick={() => { archiveSupplier(s.id, false); toast.success("تمت الاستعادة"); }}
                          title="استعادة من الأرشيف"
                        >
                          <ArchiveRestore className="w-3 h-3" />
                          استعادة
                        </Button>
                        {canDeleteSupplier && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10 w-7 h-7"
                            onClick={() => setToDelete(s)}
                            title="حذف نهائي"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <SupplierFormDialog
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="حذف مورد"
        message={`هل أنت متأكد من حذف المورد "${toDelete?.name}"؟`}
        variant="danger"
        confirmText="حذف"
      />
    </>
  );
}

function SegmentChip({
  label,
  count,
  active,
  onClick,
  tone = "brand",
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "brand" | "amber" | "green" | "slate";
}) {
  const activeColors: Record<typeof tone, string> = {
    brand: "bg-brand-600 text-white border-brand-600",
    amber: "bg-amber-500 text-white border-amber-500",
    green: "bg-emerald-600 text-white border-emerald-600",
    slate: "bg-slate-600 text-white border-slate-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? activeColors[tone] : "border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white/25" : "bg-surface-muted text-ink-faint"}`}>{count}</span>
    </button>
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
  tone: "green" | "red" | "amber" | "blue" | "indigo";
}) {
  const colors: Record<typeof tone, string> = {
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
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
