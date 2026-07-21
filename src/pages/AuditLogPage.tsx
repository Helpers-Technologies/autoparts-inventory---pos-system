import { useMemo, useState } from "react";
import { Shield, RotateCcw } from "lucide-react";
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
  cash:      ["cash_manual_add", "cash_manual_remove"],
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

      <Card>
        <CardHeader title="تصفية السجل" />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="بحث">
              <Input
                value={q}
                onChange={(e) => handleQ(e.target.value)}
                placeholder="ابحث في الكيان أو التفاصيل..."
              />
            </Field>
            <Field label="التصنيف">
              <Select value={category} onChange={(e) => handleCategory(e.target.value as Category)}>
                <option value="all">الكل</option>
                <option value="sales">فواتير المبيعات وعروض الأسعار</option>
                <option value="purchases">فواتير المشتريات</option>
                <option value="returns">المرتجعات</option>
                <option value="stock">المخزون والمنتجات</option>
                <option value="deletions">عمليات الحذف والالغاء</option>
                <option value="cash">النقدية والخزينة</option>
                <option value="parties">العملاء والموردين والسائقين</option>
                <option value="system">النظام والنسخ الاحتياطي والفروع</option>
              </Select>
            </Field>
            <Field label="المستخدم">
              <Select value={userId} onChange={(e) => handleUser(e.target.value)}>
                <option value="">جميع المستخدمين</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex gap-2 items-end flex-wrap">
            <Field label="من تاريخ">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
                className="h-10 px-3 rounded-lg border border-line bg-surface text-ink text-sm outline-none focus:border-brand-500 w-40"
              />
            </Field>
            <Field label="إلى تاريخ">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
                className="h-10 px-3 rounded-lg border border-line bg-surface text-ink text-sm outline-none focus:border-brand-500 w-40"
              />
            </Field>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-10 px-3 text-xs text-ink-faint hover:text-ink transition-colors self-end"
              >
                مسح الفلاتر
              </button>
            )}
            {hasFilters && (
              <span className="text-xs text-ink-faint self-end pb-2">
                {filtered.length} نتيجة
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="الإجراءات المسجلة"
          subtitle={hasFilters ? `${filtered.length} نتيجة` : undefined}
        />

        {auditLogs.length === 0 ? (
          <CardBody>
            <div className="text-center py-12">
              <Shield className="w-10 h-10 text-ink-faint mx-auto mb-3" />
              <div className="text-sm font-medium text-ink-muted">لا توجد سجلات تدقيق بعد</div>
              <div className="text-xs text-ink-faint mt-1">
                تظهر الإجراءات تلقائياً بعد إنشاء الفواتير أو حذف البيانات أو تعديل المخزون
              </div>
            </div>
          </CardBody>
        ) : filtered.length === 0 ? (
          <CardBody>
            <div className="text-center py-12 text-sm text-ink-faint">لا توجد نتائج مطابقة</div>
          </CardBody>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-40">التاريخ والوقت</TH>
                    <TH className="w-52">الإجراء</TH>
                    <TH>الكيان</TH>
                    <TH className="w-36">المستخدم</TH>
                    <TH>التفاصيل</TH>
                    <TH className="w-28"></TH>
                  </TR>
                </THead>
                <TBody>
                  {visible.map((log) => {
                    const meta = ACTION_META[log.action];
                    return (
                      <TR key={log.id}>
                        <TD className="whitespace-nowrap text-ink-faint text-xs font-mono">
                          {formatDateTime(log.timestamp)}
                        </TD>
                        <TD>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </TD>
                        <TD className="font-medium text-ink text-sm">{log.entityLabel}</TD>
                        <TD className="text-ink-muted text-sm">{log.userName}</TD>
                        <TD className="text-ink-faint text-xs">{log.details ?? "—"}</TD>
                        <TD>
                          {log.snapshot ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setToRestore(log)}
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
              <div className="p-4 text-center border-t border-line-soft">
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  className="text-sm text-brand-600 hover:text-brand-800 font-medium"
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
