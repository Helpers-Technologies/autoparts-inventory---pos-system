import { useMemo, useState } from "react";
import { Shield, RotateCcw, Search, Filter, FilterX } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/Toast";
import { useAuditLog } from "../store/AuditLogContext";
import { formatDateTime } from "../lib/format";
import type { AuditAction, AuditLog } from "../types";

const ACTION_META: Record<
  AuditAction,
  {
    label: string;
    tone: "green" | "blue" | "orange" | "red" | "amber" | "indigo" | "emerald" | "rose" | "slate";
  }
> = {
  invoice_sale_created:    { label: "إنشاء فاتورة مبيعات",    tone: "green" },
  invoice_sale_updated:    { label: "تعديل فاتورة مبيعات",    tone: "blue" },
  invoice_sale_cancelled:  { label: "إلغاء فاتورة مبيعات",    tone: "orange" },
  invoice_sale_deleted:    { label: "حذف فاتورة مبيعات",      tone: "red" },
  invoice_purchase_created:{ label: "إنشاء فاتورة مشتريات",   tone: "green" },
  invoice_purchase_updated:{ label: "تعديل فاتورة مشتريات",   tone: "blue" },
  invoice_purchase_deleted:{ label: "حذف فاتورة مشتريات",     tone: "red" },
  return_sale_created:     { label: "مرتجع مبيعات",            tone: "amber" },
  return_purchase_created: { label: "مرتجع مشتريات",           tone: "amber" },
  stock_adjusted:          { label: "تعديل مخزون",             tone: "indigo" },
  product_created:         { label: "إضافة منتج جديد",         tone: "green" },
  product_updated:         { label: "تعديل بيانات منتج",       tone: "blue" },
  product_deleted:         { label: "حذف منتج",                tone: "red" },
  product_archived:        { label: "أرشفة منتج",              tone: "slate" },
  product_restored:        { label: "استعادة منتج",            tone: "blue" },
  customer_created:        { label: "إضافة عميل جديد",         tone: "green" },
  customer_updated:        { label: "تعديل بيانات عميل",       tone: "blue" },
  customer_deleted:        { label: "حذف عميل",                tone: "red" },
  customer_archived:       { label: "أرشفة عميل",              tone: "slate" },
  customer_restored:       { label: "استعادة عميل",            tone: "blue" },
  supplier_created:        { label: "إضافة مورد جديد",         tone: "green" },
  supplier_updated:        { label: "تعديل بيانات مورد",       tone: "blue" },
  supplier_deleted:        { label: "حذف مورد",                tone: "red" },
  supplier_archived:       { label: "أرشفة مورد",              tone: "slate" },
  supplier_restored:       { label: "استعادة مورد",            tone: "blue" },
  driver_created:          { label: "إضافة سائق جديد",         tone: "green" },
  driver_updated:          { label: "تعديل بيانات سائق",       tone: "blue" },
  driver_deleted:          { label: "حذف سائق",                tone: "red" },
  cash_manual_add:         { label: "إضافة نقدية",             tone: "emerald" },
  cash_manual_remove:      { label: "خصم نقدي",                tone: "rose" },
  shift_opened:            { label: "فتح وردية كاشير",         tone: "emerald" },
  shift_closed:            { label: "تقفيل وردية كاشير",       tone: "indigo" },
  invoice_restored:        { label: "استعادة فاتورة",          tone: "blue" },
  user_login:              { label: "تسجيل دخول المستخدم",     tone: "emerald" },
  user_logout:             { label: "تسجيل خروج المستخدم",     tone: "rose" },
  settings_updated:        { label: "تعديل إعدادات النظام",     tone: "indigo" },
  backup_created:          { label: "إنشاء نسخة احتياطية",     tone: "emerald" },
  backup_restored:         { label: "استعادة نسخة احتياطية",   tone: "amber" },
  quotation_created:       { label: "إنشاء عرض أسعار",         tone: "green" },
  quotation_updated:       { label: "تعديل عرض أسعار",         tone: "blue" },
  quotation_deleted:       { label: "حذف عرض أسعار",           tone: "red" },
  stocktake_created:       { label: "بدء جرد مخزون",           tone: "indigo" },
  branch_created:          { label: "إضافة فرع جديد",          tone: "green" },
  branch_updated:          { label: "تعديل بيانات فرع",        tone: "blue" },
  branch_deleted:          { label: "حذف فرع",                 tone: "red" },
};

type Category = "all" | "sales" | "purchases" | "returns" | "stock" | "deletions" | "cash" | "parties" | "system";

const CATEGORY_ACTIONS: Record<Category, AuditAction[] | null> = {
  all:       null,
  sales:     ["invoice_sale_created", "invoice_sale_updated", "invoice_sale_cancelled", "invoice_sale_deleted", "quotation_created", "quotation_updated", "quotation_deleted"],
  purchases: ["invoice_purchase_created", "invoice_purchase_updated", "invoice_purchase_deleted"],
  returns:   ["return_sale_created", "return_purchase_created"],
  stock:     ["product_created", "product_updated", "product_deleted", "product_archived", "product_restored", "stock_adjusted", "stocktake_created"],
  deletions: ["invoice_sale_deleted", "invoice_purchase_deleted", "product_deleted", "customer_deleted", "supplier_deleted", "driver_deleted", "quotation_deleted", "branch_deleted"],
  cash:      ["cash_manual_add", "cash_manual_remove", "shift_opened", "shift_closed"],
  parties:   ["customer_created", "customer_updated", "customer_deleted", "customer_archived", "customer_restored", "supplier_created", "supplier_updated", "supplier_deleted", "supplier_archived", "supplier_restored", "driver_created", "driver_updated", "driver_deleted"],
  system:    ["user_login", "user_logout", "settings_updated", "backup_created", "backup_restored", "branch_created", "branch_updated", "branch_deleted"],
};

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const { auditLogs, restoreDeletedInvoice } = useAuditLog();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [userId, setUserId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [toRestore, setToRestore] = useState<AuditLog | null>(null);

  const users = useMemo(() => {
    const map = new Map<string, string>();
    auditLogs.forEach((l) => map.set(l.userId, l.userName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [auditLogs]);

  const filtered = useMemo(() => {
    const qLow = q.toLowerCase();
    const actions = CATEGORY_ACTIONS[category];
    return auditLogs.filter((l) => {
      if (actions && !actions.includes(l.action)) return false;
      if (userId && l.userId !== userId) return false;
      if (qLow && !l.entityLabel.toLowerCase().includes(qLow) && !l.details?.toLowerCase().includes(qLow))
        return false;
      const logDate = l.timestamp.slice(0, 10);
      if (dateFrom && logDate < dateFrom) return false;
      if (dateTo && logDate > dateTo) return false;
      return true;
    });
  }, [auditLogs, q, category, userId, dateFrom, dateTo]);

  const visible = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const hasFilters = q || category !== "all" || userId || dateFrom || dateTo;

  function handleQ(v: string) { setQ(v); setPage(0); }
  function handleCategory(v: Category) { setCategory(v); setPage(0); }
  function handleUser(v: string) { setUserId(v); setPage(0); }
  function clearFilters() { setQ(""); setCategory("all"); setUserId(""); setDateFrom(""); setDateTo(""); setPage(0); }

  return (
    <>
      <PageHeader
        title="سجل النشاط"
        description={`آخر ${auditLogs.length.toLocaleString()} عملية مسجلة`}
      />

      <Card className="mb-4 shadow-sm border border-line">
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-brand-500" />
              <span>تصفية السجل</span>
              {hasFilters && (
                <span className="mr-auto text-xs px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-600 font-medium">
                  {filtered.length} نتيجة
                </span>
              )}
            </div>
          }
        />
        <CardBody className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-[1.5fr_1.2fr_1fr_1fr_1fr_auto] gap-3 items-end">
            <Field label="بحث">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <Input
                  value={q}
                  onChange={(e) => handleQ(e.target.value)}
                  placeholder="ابحث في الكيان أو التفاصيل..."
                  className="h-10 pl-9 pr-3 text-xs text-right [text-align-last:right] focus:border-brand-500"
                />
              </div>
            </Field>

            <Field label="التصنيف">
              <Select
                value={category}
                onChange={(e) => handleCategory(e.target.value as Category)}
                className="h-10 text-xs text-right [text-align-last:right] focus:border-brand-500"
              >
                <option value="all">الكل (جميع التصنيفات)</option>
                <option value="sales">فواتير المبيعات وعروض الأسعار</option>
                <option value="purchases">فواتير المشتريات</option>
                <option value="returns">المرتجعات</option>
                <option value="stock">المخزون والمنتجات</option>
                <option value="deletions">عمليات الحذف والإلغاء</option>
                <option value="cash">النقدية والخزينة</option>
                <option value="parties">العملاء والموردين والسائقين</option>
                <option value="system">النظام والنسخ الاحتياطي والفروع</option>
              </Select>
            </Field>

            <Field label="المستخدم">
              <Select
                value={userId}
                onChange={(e) => handleUser(e.target.value)}
                className="h-10 text-xs text-right [text-align-last:right] focus:border-brand-500"
              >
                <option value="">جميع المستخدمين</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="من تاريخ">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(0);
                }}
                className="w-full h-10 px-3 rounded-lg border border-line bg-surface text-ink text-xs focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all [color-scheme:dark]"
              />
            </Field>

            <Field label="إلى تاريخ">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(0);
                }}
                className="w-full h-10 px-3 rounded-lg border border-line bg-surface text-ink text-xs focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all [color-scheme:dark]"
              />
            </Field>

            {hasFilters && (
              <div className="flex items-center gap-2 h-10 pb-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-10 px-3 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  title="إلغاء تفعيل كافة الفلاتر"
                >
                  <FilterX className="w-3.5 h-3.5" />
                  <span>مسح الفلاتر</span>
                </Button>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card className="shadow-sm border border-line overflow-hidden">
        <CardHeader
          title={
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Shield className="w-4.5 h-4.5 text-brand-500" />
                <span>الإجراءات المسجلة</span>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-surface-muted border border-line text-ink-muted font-mono">
                {filtered.length.toLocaleString()} سجل
              </span>
            </div>
          }
        />

        {auditLogs.length === 0 ? (
          <CardBody>
            <div className="text-center py-12">
              <Shield className="w-12 h-12 text-ink-faint mx-auto mb-3 opacity-60" />
              <div className="text-sm font-semibold text-ink-muted">لا توجد سجلات تدقيق بعد</div>
              <div className="text-xs text-ink-faint mt-1">
                تظهر الإجراءات تلقائياً بعد إنشاء الفواتير أو حذف البيانات أو تعديل المخزون
              </div>
            </div>
          </CardBody>
        ) : filtered.length === 0 ? (
          <CardBody>
            <div className="text-center py-12">
              <FilterX className="w-10 h-10 text-ink-faint mx-auto mb-2 opacity-60" />
              <div className="text-sm font-medium text-ink-muted">لا توجد نتائج مطابقة للفلاتر المحددة</div>
              <button
                onClick={clearFilters}
                className="mt-3 text-xs text-brand-500 hover:underline font-medium"
              >
                إعادة ضبط الفلاتر
              </button>
            </div>
          </CardBody>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[950px]">
                <THead>
                  <TR className="bg-surface-muted/70 border-b border-line">
                    <TH className="w-44 py-3 px-4 whitespace-nowrap text-ink-muted text-xs font-semibold">التاريخ والوقت</TH>
                    <TH className="w-48 py-3 px-4 whitespace-nowrap text-ink-muted text-xs font-semibold">الإجراء</TH>
                    <TH className="min-w-[230px] py-3 px-4 whitespace-nowrap text-ink-muted text-xs font-semibold">الكيان</TH>
                    <TH className="w-36 py-3 px-4 whitespace-nowrap text-ink-muted text-xs font-semibold">المستخدم</TH>
                    <TH className="min-w-[280px] py-3 px-4 text-ink-muted text-xs font-semibold">التفاصيل</TH>
                    <TH className="w-28 py-3 px-4 whitespace-nowrap"></TH>
                  </TR>
                </THead>
                <TBody>
                  {visible.map((log) => {
                    const meta = ACTION_META[log.action];
                    return (
                      <TR key={log.id} className="hover:bg-brand-500/5 transition-colors border-b border-line-soft/60">
                        <TD className="py-3 px-4 whitespace-nowrap text-ink-faint text-xs font-mono">
                          {formatDateTime(log.timestamp)}
                        </TD>
                        <TD className="py-3 px-4 whitespace-nowrap">
                          <Badge tone={meta.tone} className="shadow-2xs">{meta.label}</Badge>
                        </TD>
                        <TD className="py-3 px-4 font-semibold text-ink text-sm whitespace-nowrap" dir="auto">
                          <bdi>{log.entityLabel}</bdi>
                        </TD>
                        <TD className="py-3 px-4 text-ink-muted text-xs whitespace-nowrap" dir="auto">
                          <bdi>{log.userName}</bdi>
                        </TD>
                        <TD className="py-3 px-4 text-ink-muted text-xs min-w-[280px] max-w-xl break-words leading-relaxed" dir="auto">
                          {log.details ? <bdi>{log.details}</bdi> : <span className="text-ink-faint">—</span>}
                        </TD>
                        <TD className="py-3 px-4 whitespace-nowrap text-left">
                          {log.snapshot ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setToRestore(log)}
                              className="h-8 px-2.5 text-xs text-brand-600 hover:bg-brand-500/10 border-brand-500/30 gap-1.5 rounded-lg transition-colors"
                              title="إرجاع الفاتورة وحركاتها كما كانت قبل الحذف"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> استعادة
                            </Button>
                          ) : null}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            {visible.length < filtered.length && (
              <div className="p-4 text-center border-t border-line bg-surface-muted/30">
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  className="px-4 py-2 text-xs text-brand-600 hover:text-brand-700 bg-brand-500/10 hover:bg-brand-500/20 rounded-lg font-medium transition-colors"
                >
                  عرض المزيد ({(filtered.length - visible.length).toLocaleString()} متبقٍ)
                </button>
              </div>
            )}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!toRestore}
        onClose={() => setToRestore(null)}
        onConfirm={() => {
          if (!toRestore) return;
          const ok = restoreDeletedInvoice(toRestore.id);
          if (ok) {
            toast.success("تمت الاستعادة", "رجعت الفاتورة وحركات المخزون والخزنة كما كانت");
          } else {
            toast.error(
              "تعذرت الاستعادة",
              "الفاتورة موجودة بالفعل أو رقمها مستخدم في فاتورة أحدث"
            );
          }
          setToRestore(null);
        }}
        title="استعادة الفاتورة المحذوفة"
        message={`سيتم إرجاع ${toRestore?.entityLabel ?? ""} بكامل حركاتها (المخزون والخزنة) كما كانت قبل الحذف. متابعة؟`}
        confirmText="استعادة"
      />
    </>
  );
}
