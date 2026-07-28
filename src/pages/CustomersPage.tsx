import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  Eye,
  Users,
  Search,
  ScrollText,
  Archive,
  ArchiveRestore,
  Wallet,
  UserRound,
  Car,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import type { Customer } from "../types";
import { Link, useLocation } from "react-router-dom";
import { hasPermission } from "../lib/permissions";
import { AddressFields, type AddressDraft } from "../features/shipping/AddressFields";
import { defaultCustomerAddress } from "../lib/shipping";
import { uid } from "../lib/utils";

type Segment = "all" | "debtors" | "creditors" | "inactive";
type SortKey = "recent" | "purchases" | "balance" | "name" | "new";
const EMPTY_ADDRESS: AddressDraft = { label: "العنوان الرئيسي", governorate: "", city: "", addressLine: "", isDefault: true };

interface CustomerRow {
  customer: Customer;
  archived: boolean;
  invoiceCount: number;
  totalPurchases: number;
  lastActivity?: string;
  vehicles: number;
  balance: number;
}

export function CustomersPage() {
  const { customers, addCustomer, updateCustomer, deleteCustomer, archiveCustomer, nextCustomerCode } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { customerBalance } = useReporting();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { customerVehicles } = useAutoPartsPro();
  const toast = useToast();
  const loc = useLocation();
  const canAddCustomer = hasPermission(currentUser, "customers", "add");
  const canEditCustomer = hasPermission(currentUser, "customers", "edit");
  const canDeleteCustomer = hasPermission(currentUser, "customers", "delete");

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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [toDelete, setToDelete] = useState<Customer | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [segment, setSegment] = useState<Segment>("all");
  const [sortBy, setSortBy] = useState<SortKey>("recent");

  const [form, setForm] = useState<Omit<Customer, "id" | "createdAt">>({
    code: "",
    name: "",
    phone: "",
    address: "",
    marketingConsent: "unknown",
    notes: "",
  });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(EMPTY_ADDRESS);

  // ── Per-customer analytics ──
  const allRows = useMemo<CustomerRow[]>(() => {
    return customers.map((c) => {
      const invs = salesInvoices.filter((s) => s.customerId === c.id && !s.cancelled);
      const totalPurchases = invs.reduce((sum, s) => sum + s.total, 0);
      const lastActivity = invs.map((s) => s.date).sort().at(-1);
      const vehicles = customerVehicles.filter((v) => v.customerId === c.id && !v.archived).length;
      return {
        customer: c,
        archived: !!c.archived,
        invoiceCount: invs.length,
        totalPurchases,
        lastActivity,
        vehicles,
        balance: customerBalance(c.id),
      };
    });
  }, [customers, salesInvoices, customerVehicles, customerBalance]);

  const rows = useMemo(() => allRows.filter((r) => !r.archived), [allRows]);
  const archivedRows = useMemo(() => allRows.filter((r) => r.archived), [allRows]);
  const archivedCount = archivedRows.length;

  const stats = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let totalPurchases = 0;
    let receivables = 0;
    let debtors = 0;
    let activeThisMonth = 0;
    for (const r of rows) {
      totalPurchases += r.totalPurchases;
      if (r.balance > 0) {
        receivables += r.balance;
        debtors += 1;
      }
      if (r.lastActivity?.startsWith(ym)) activeThisMonth += 1;
    }
    return { activeCount: rows.length, totalPurchases, receivables, debtors, activeThisMonth };
  }, [rows]);

  const segCounts = useMemo(
    () => ({
      all: rows.length,
      debtors: rows.filter((r) => r.balance > 0).length,
      creditors: rows.filter((r) => r.balance < 0).length,
      inactive: rows.filter((r) => r.invoiceCount === 0).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (t) {
        const matches =
          r.customer.name.toLowerCase().includes(t) ||
          (r.customer.phone ?? "").toLowerCase().includes(t) ||
          (r.customer.code ?? "").toLowerCase().includes(t);
        if (!matches) return false;
      }
      if (segment === "debtors") return r.balance > 0;
      if (segment === "creditors") return r.balance < 0;
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
        list.sort((a, b) => a.customer.name.localeCompare(b.customer.name, "ar"));
        break;
      case "new":
        list.sort((a, b) => (b.customer.createdAt ?? "").localeCompare(a.customer.createdAt ?? ""));
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
    setForm({ code: `CUS-${String(nextCustomerCode).padStart(4, "0")}`, name: "", phone: "", address: "", marketingConsent: "unknown", notes: "" });
    setAddressDraft({ ...EMPTY_ADDRESS });
    setOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      code: c.code ?? "",
      name: c.name,
      phone: c.phone ?? "",
      address: c.address ?? "",
      marketingConsent: c.marketingConsent ?? "unknown",
      notes: c.notes ?? "",
    });
    const address = defaultCustomerAddress(c);
    setAddressDraft(address ? {
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      governorate: address.governorate,
      city: address.city,
      district: address.district,
      addressLine: address.addressLine,
      landmark: address.landmark,
      buildingNumber: address.buildingNumber,
      floor: address.floor,
      apartment: address.apartment,
      postalCode: address.postalCode,
      isDefault: true,
      bosta: address.bosta,
    } : { ...EMPTY_ADDRESS, addressLine: c.address ?? "" });
    setOpen(true);
  }
  function submit() {
    if (!form.name.trim()) {
      toast.error("اسم العميل مطلوب");
      return;
    }
    if (!form.phone?.trim()) {
      toast.error("رقم الهاتف مطلوب");
      return;
    }
    if (form.phone.replace(/\D/g, "").length !== 11) {
      toast.error("رقم الهاتف غير صحيح", "يجب أن يكون 11 رقم بالضبط");
      return;
    }
    if (!addressDraft.addressLine.trim() || !addressDraft.governorate || !addressDraft.city) {
      toast.error("عنوان التوصيل غير مكتمل", "العنوان والمحافظة والمدينة مطلوبة لحساب التوصيل");
      return;
    }
    const timestamp = new Date().toISOString();
    const previousDefault = editing ? defaultCustomerAddress(editing) : undefined;
    const address = {
      ...addressDraft,
      id: previousDefault && !previousDefault.id.startsWith("legacy-") ? previousDefault.id : uid("address"),
      recipientName: addressDraft.recipientName?.trim() || form.name.trim(),
      phone: addressDraft.phone?.trim() || form.phone?.trim(),
      isDefault: true,
      createdAt: previousDefault?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const otherAddresses = editing?.addresses?.filter((item) => item.id !== previousDefault?.id).map((item) => ({ ...item, isDefault: false })) ?? [];
    const payload = { ...form, address: address.addressLine, addresses: [address, ...otherAddresses] };
    if (editing) {
      updateCustomer(editing.id, payload);
      toast.success("تم تحديث العميل");
    } else {
      addCustomer(payload);
      toast.success("تم إضافة العميل");
    }
    setOpen(false);
  }
  function handleDelete() {
    if (!toDelete) return;
    const ok = deleteCustomer(toDelete.id);
    if (ok) {
      toast.success("تم حذف العميل");
    } else {
      archiveCustomer(toDelete.id, true);
      toast.success("تم أرشفة العميل", "العميل محفوظ في الأرشيف ويمكن استعادته");
    }
    setToDelete(null);
  }

  return (
    <>
      <AutoPartsHero
        icon={Users}
        title="عملاء المحل وحساباتهم"
        description="قاعدة بيانات العملاء مع سياراتهم وأرصدتهم وسجل مشترياتهم وكشوف حساباتهم — تابع تعاملات كل عميل من مكان واحد."
        actions={
          canAddCustomer ? (
            <Button onClick={openNew} className="h-10 bg-amber-400 text-slate-950 hover:bg-amber-300">
              <Plus className="w-4 h-4" />
              إضافة عميل
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          icon={<UserRound className="w-5 h-5" />}
          label="إجمالي العملاء"
          value={String(stats.activeCount)}
          detail={archivedCount > 0 ? `${archivedCount} في الأرشيف` : "كل العملاء نشطون"}
          tone="blue"
        />
        <StatCard
          icon={<ShoppingBag className="w-5 h-5" />}
          label="إجمالي مشتريات العملاء"
          value={formatCurrency(stats.totalPurchases, settings.currency)}
          detail="قيمة كل فواتير البيع"
          tone="green"
        />
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="مستحق على العملاء"
          value={formatCurrency(stats.receivables, settings.currency)}
          detail={stats.debtors > 0 ? `${stats.debtors} عميل مدين` : "لا مديونيات"}
          tone="amber"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="نشطون هذا الشهر"
          value={String(stats.activeThisMonth)}
          detail="عميل تعامل خلال الشهر الحالي"
          tone="indigo"
        />
      </div>

      <Card>
        <CardHeader
          title="قائمة العملاء"
          subtitle={`عرض ${visible.length} من ${rows.length} عميل`}
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
              <option value="recent">الأحدث تعاملاً</option>
              <option value="purchases">الأكثر شراءً</option>
              <option value="balance">الأعلى مديونية</option>
              <option value="name">الاسم أبجدياً (أ-ي)</option>
              <option value="new">الأحدث إضافةً</option>
            </Select>
          </div>

          {/* Segment filter chips */}
          <div className="flex flex-wrap gap-1.5">
            <SegmentChip label="الكل" count={segCounts.all} active={segment === "all"} onClick={() => setSegment("all")} />
            <SegmentChip label="عليهم مستحقات" count={segCounts.debtors} active={segment === "debtors"} onClick={() => setSegment("debtors")} tone="amber" />
            <SegmentChip label="لهم رصيد دائن" count={segCounts.creditors} active={segment === "creditors"} onClick={() => setSegment("creditors")} tone="green" />
            <SegmentChip label="بدون تعاملات" count={segCounts.inactive} active={segment === "inactive"} onClick={() => setSegment("inactive")} tone="slate" />
          </div>

          {visible.length === 0 && (!showArchived || archivedRows.length === 0) ? (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title={q.trim() || segment !== "all" ? "لا يوجد عملاء مطابقون" : "لا يوجد عملاء"}
              description={q.trim() || segment !== "all" ? "جرّب تعديل البحث أو الفلتر." : "ابدأ بإضافة أول عميل."}
              action={
                canAddCustomer && !q.trim() && segment === "all" ? (
                  <Button onClick={openNew}><Plus className="w-4 h-4" /> إضافة عميل</Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>العميل</TH>
                  <TH>الهاتف</TH>
                  <TH className="text-center">السيارات</TH>
                  <TH className="text-center">الفواتير</TH>
                  <TH className="text-end">إجمالي المشتريات</TH>
                  <TH>آخر تعامل</TH>
                  <TH className="text-end">الرصيد الحالي</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map(({ customer: c, invoiceCount, totalPurchases, lastActivity, vehicles, balance }) => (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        to={`/customers/${c.id}`}
                        className="flex items-center gap-2.5 text-start group"
                      >
                        <span className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 grid place-items-center text-xs font-bold shrink-0">
                          {initials(c.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium text-ink group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors truncate">{c.name}</span>
                          <span className="block font-mono text-[11px] text-ink-faint">{c.code ?? "—"}</span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-ink-muted" dir="ltr">{c.phone ?? "—"}</TD>
                    <TD className="text-center">
                      {vehicles > 0 ? (
                        <span className="inline-flex items-center gap-1 text-ink-muted">
                          <Car className="w-3.5 h-3.5 text-brand-600" />
                          {vehicles}
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
                        <Badge tone="amber">عليه {formatCurrency(balance, settings.currency)}</Badge>
                      ) : balance < 0 ? (
                        <Badge tone="green">له {formatCurrency(-balance, settings.currency)}</Badge>
                      ) : (
                        <Badge tone="slate">لا مستحق</Badge>
                      )}
                    </TD>
                    <TD className="text-end">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          to={`/customers/${c.id}/statement`}
                          title="كشف حساب"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
                        >
                          <ScrollText className="w-4 h-4" />
                        </Link>
                        <Link
                          to={`/customers/${c.id}`}
                          title="عرض الملف"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        {canEditCustomer ? (
                          <Button size="icon" variant="ghost" title="تعديل" onClick={() => openEdit(c)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        ) : null}
                        {canDeleteCustomer ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="حذف"
                            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10"
                            onClick={() => setToDelete(c)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
                {showArchived && archivedRows.map(({ customer: c }) => (
                  <TR key={c.id} className="opacity-60 bg-surface-muted">
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-lg bg-surface-muted border border-line text-ink-faint grid place-items-center text-xs font-bold shrink-0">
                          {initials(c.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-ink-muted line-through truncate">{c.name}</span>
                          <span className="block font-mono text-[11px] text-ink-faint">{c.code ?? "—"}</span>
                        </span>
                      </div>
                    </TD>
                    <TD className="text-ink-faint" dir="ltr">{c.phone ?? "—"}</TD>
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
                          onClick={() => { archiveCustomer(c.id, false); toast.success("تمت الاستعادة"); }}
                        >
                          <ArchiveRestore className="w-3 h-3" />
                          استعادة
                        </Button>
                        {canDeleteCustomer && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10 w-7 h-7"
                            onClick={() => setToDelete(c)}
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "تعديل عميل" : "إضافة عميل"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={submit}>{editing ? "حفظ" : "إضافة"}</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="كود العميل">
            <Input
              value={form.code ?? ""}
              readOnly={!editing}
              onChange={(e) => editing && setForm({ ...form, code: e.target.value })}
              className={!editing ? "bg-surface-muted cursor-not-allowed text-ink-muted font-mono" : "font-mono"}
            />
          </Field>
          <Field label="اسم العميل" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="الهاتف" required>
            <Input
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              maxLength={11}
              inputMode="numeric"
            />
          </Field>
          <div className="col-span-2 rounded-xl border border-line bg-surface-muted/20 p-3"><div className="mb-3 text-sm font-bold text-ink">عنوان التوصيل الرئيسي</div><AddressFields value={addressDraft} onChange={setAddressDraft} showRecipient={false} /></div>
          <Field
            label="الموافقة على التواصل التسويقي"
            hint="سجّل اختيار العميل قبل إضافته لأي عروض أو حملات. العملاء الرافضون يُستبعدون تلقائيًا."
            className="col-span-2"
          >
            <Select
              value={form.marketingConsent ?? "unknown"}
              onChange={(e) => setForm({ ...form, marketingConsent: e.target.value as Customer["marketingConsent"] })}
            >
              <option value="unknown">لم تُسجّل الموافقة بعد</option>
              <option value="opted_in">موافق على استقبال العروض</option>
              <option value="opted_out">لا يرغب في رسائل تسويقية</option>
            </Select>
          </Field>
          <Field label="ملاحظات" className="col-span-2">
            <Textarea
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="حذف عميل"
        message={`هل أنت متأكد من حذف "${toDelete?.name}"؟`}
        variant="danger"
        confirmText="حذف"
      />
    </>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`;
  return name.trim().slice(0, 2) || "؟";
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
