import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Pencil,
  Trash2,
  Printer,
  MessageCircle,
  Wallet,
  ShoppingBag,
  Receipt,
  Package,
  Phone,
  MapPin,
  CalendarClock,
  ArchiveRestore,
  Search,
  Plus,
  Gift,
  Percent,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field, Select } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { SupplierFormDialog } from "../features/suppliers/SupplierForm";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useFeatures } from "../lib/useFeatures";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import type { CommissionTier, CommissionType } from "../types";
import { hasPermission } from "../lib/permissions";
import { printAppRoute } from "../lib/print";

function whatsappHref(phone: string | undefined, message: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  const normalized = digits.startsWith("0") ? `20${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function SupplierDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const {
    suppliers,
    products,
    deleteSupplier,
    archiveSupplier,
    addCommissionTier,
    updateCommissionTier,
    deleteCommissionTier,
  } = useCatalog();
  const { purchaseInvoices } = useInvoicing();
  const { supplierBalance, calculateSupplierCommission } = useReporting();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const supplierCommissionsEnabled = isEnabled("supplierCommissions");

  const canEdit = hasPermission(currentUser, "suppliers", "edit");
  const canDelete = hasPermission(currentUser, "suppliers", "delete");
  const canManageCommissions = hasPermission(currentUser, "suppliers", "commissions");

  const supplier = suppliers.find((s) => s.id === id);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState("");

  const [tierDialogOpen, setTierDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<CommissionTier | null>(null);
  const [tierForm, setTierForm] = useState<Omit<CommissionTier, "id">>({
    threshold: 0,
    commissionType: "percentage",
    commissionValue: 0,
    periodDays: 30,
  });

  const invoices = useMemo(
    () => (supplier ? purchaseInvoices.filter((p) => p.supplierId === supplier.id) : []),
    [purchaseInvoices, supplier]
  );
  const suppliedParts = useMemo(
    () => (supplier ? products.filter((p) => p.supplierId === supplier.id && !p.archived) : []),
    [products, supplier]
  );
  const balance = supplier ? supplierBalance(supplier.id) : 0;
  const totalPurchases = useMemo(() => invoices.reduce((sum, p) => sum + p.total, 0), [invoices]);
  const totalPaid = useMemo(() => invoices.reduce((sum, p) => sum + p.amountPaid, 0), [invoices]);
  const commissions = supplier ? calculateSupplierCommission(supplier.id) : [];
  const commissionEarned = commissions.reduce((s, r) => s + r.earned, 0);

  const filteredInvoices = useMemo(() => {
    const t = invoiceQuery.trim().toLowerCase();
    const sorted = [...invoices].sort((a, b) => b.date.localeCompare(a.date));
    if (!t) return sorted;
    return sorted.filter((inv) => inv.invoiceNumber.toLowerCase().includes(t));
  }, [invoices, invoiceQuery]);

  if (!supplier) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8">
            <div className="text-ink font-medium">المورد غير موجود</div>
            <Button className="mt-4" onClick={() => navigate("/suppliers")}>
              <ArrowRight className="w-4 h-4" /> العودة لقائمة الموردين
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  function handleDelete() {
    if (!supplier) return;
    const ok = deleteSupplier(supplier.id);
    if (ok) {
      toast.success("تم حذف المورد");
    } else {
      archiveSupplier(supplier.id, true);
      toast.success("تم أرشفة المورد", "المورد محفوظ في الأرشيف ويمكن استعادته من قائمة الموردين");
    }
    setDeleteOpen(false);
    navigate("/suppliers");
  }

  function openNewTier() {
    setEditingTier(null);
    setTierForm({ threshold: 0, commissionType: "percentage", commissionValue: 0, periodDays: 30 });
    setTierDialogOpen(true);
  }

  const whatsappMessage =
    balance > 0
      ? `مرحبًا ${supplier.name}، نراجع مستحقاتكم البالغة ${formatCurrency(balance, settings.currency)} لدى ${settings.companyNameAr || settings.companyName}.`
      : `مرحبًا ${supplier.name}، نتواصل معكم بخصوص حسابكم لدى ${settings.companyNameAr || settings.companyName}.`;
  const whatsappUrl = whatsappHref(supplier.phone, whatsappMessage);

  return (
    <>
      <PageHeader
        title={supplier.name}
        description={`${supplier.code ?? "بدون كود"} • ${supplier.phone ?? "بدون هاتف"} • مورد منذ ${supplier.createdAt ? formatDate(supplier.createdAt) : "—"}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/suppliers")}>
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const result = await printAppRoute(`/suppliers/${supplier.id}/statement`);
                if (!result.ok && result.error !== "cancelled") {
                  toast.error("تعذرت الطباعة");
                }
              }}
            >
              <Printer className="w-4 h-4" /> كشف حساب
            </Button>
            {whatsappEnabled && whatsappUrl ? (
              <a href={whatsappUrl} target="_blank" rel="noreferrer">
                <Button variant="outline">
                  <MessageCircle className="w-4 h-4" /> واتساب
                </Button>
              </a>
            ) : null}
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="w-4 h-4" /> تعديل
              </Button>
            ) : null}
            {canDelete ? (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="w-4 h-4" /> حذف
              </Button>
            ) : null}
          </>
        }
      />

      {supplier.archived ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm">
          <span className="text-ink-muted">هذا المورد مؤرشف حاليًا ولا يظهر في القائمة الرئيسية.</span>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { archiveSupplier(supplier.id, false); toast.success("تمت استعادة المورد"); }}
          >
            <ArchiveRestore className="w-3.5 h-3.5" /> استعادة
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="الرصيد المستحق"
          value={balance > 0 ? formatCurrency(balance, settings.currency) : balance < 0 ? formatCurrency(-balance, settings.currency) : "مسدد بالكامل"}
          detail={balance > 0 ? "مستحق عليك للمورد" : balance < 0 ? "رصيد لنا لدى المورد" : "لا مستحقات"}
          tone={balance > 0 ? "amber" : balance < 0 ? "green" : "blue"}
        />
        <StatCard
          icon={<ShoppingBag className="w-5 h-5" />}
          label="إجمالي المشتريات"
          value={formatCurrency(totalPurchases, settings.currency)}
          detail={`المدفوع: ${formatCurrency(totalPaid, settings.currency)}`}
          tone="indigo"
        />
        <StatCard
          icon={<Package className="w-5 h-5" />}
          label="أصناف موردة"
          value={String(suppliedParts.length)}
          detail="قطعة مرتبطة بالمورد"
          tone="blue"
        />
        <StatCard
          icon={<Gift className="w-5 h-5" />}
          label="بونص مستحق"
          value={supplierCommissionsEnabled ? formatCurrency(commissionEarned, settings.currency) : "—"}
          detail={
            supplierCommissionsEnabled
              ? commissions.length > 0
                ? `${commissions.length} شريحة عمولة`
                : "لا توجد شرائح"
              : "ميزة معطلة"
          }
          tone="green"
        />
      </div>

      <Card>
        <CardHeader title="بيانات المورد" />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Info label="الهاتف" icon={<Phone className="w-3.5 h-3.5" />}>
              <span dir="ltr">{supplier.phone ?? "—"}</span>
            </Info>
            <Info label="العنوان" icon={<MapPin className="w-3.5 h-3.5" />}>
              {supplier.address ?? "—"}
            </Info>
            <Info label="الكود">
              <span className="font-mono">{supplier.code ?? "—"}</span>
            </Info>
            <Info label="مورد منذ" icon={<CalendarClock className="w-3.5 h-3.5" />}>
              {supplier.createdAt ? formatDate(supplier.createdAt) : "—"}
            </Info>
            <Info label="ملاحظة عمولة / هدف" className="sm:col-span-2">
              {supplier.commissionNote ?? "—"}
            </Info>
            {supplier.notes ? (
              <Info label="ملاحظات" className="sm:col-span-2">
                {supplier.notes}
              </Info>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {supplierCommissionsEnabled ? (
        <Card>
          <CardHeader
            title="نظام العمولات والبونص"
            subtitle="شرائح مكافآت المشتريات ونسبة تحقّقها خلال الفترة"
            actions={
              canManageCommissions ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openNewTier}>
                  <Plus className="w-3.5 h-3.5" /> إضافة شريحة
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {commissions.length === 0 ? (
              <EmptyState
                icon={<Percent className="w-5 h-5" />}
                title="لا توجد شرائح عمولة"
                description="أضف شريحة عمولة لتتبّع البونص المستحق تلقائيًا مع كل عملية شراء."
                action={
                  canManageCommissions ? (
                    <Button size="sm" onClick={openNewTier}><Plus className="w-4 h-4" /> إضافة شريحة</Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {commissions.map((res) => {
                    const pct = res.threshold > 0 ? Math.min(100, (res.totalPurchases / res.threshold) * 100) : 100;
                    const achieved = res.totalPurchases >= res.threshold;
                    return (
                      <div key={res.tierId} className="bg-surface border border-line rounded-lg p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-ink">
                              شريحة {formatCurrency(res.threshold, settings.currency)} / {res.periodDays} يوم
                            </div>
                            <div className="text-[11px] text-ink-faint mt-0.5">
                              العمولة: {res.commissionType === "percentage" ? `${res.commissionValue}%` : formatCurrency(res.commissionValue, settings.currency)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {achieved ? <Badge tone="green">مُحقّقة</Badge> : <Badge tone="amber">{Math.round(pct)}%</Badge>}
                            {canManageCommissions && (
                              <>
                                <button
                                  onClick={() => {
                                    const t = supplier.commissionTiers?.find((x) => x.id === res.tierId);
                                    if (t) {
                                      setEditingTier(t);
                                      setTierForm({ ...t });
                                      setTierDialogOpen(true);
                                    }
                                  }}
                                  className="p-1 hover:bg-surface-muted rounded text-ink-faint hover:text-brand-600 transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteCommissionTier(supplier.id, res.tierId)}
                                  className="p-1 hover:bg-surface-muted rounded text-ink-faint hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-ink-faint">المشتريات: </span>
                            <span className="font-medium text-ink">{formatCurrency(res.totalPurchases, settings.currency)}</span>
                          </div>
                          <div>
                            <span className="text-ink-faint">البونص: </span>
                            <span className={`font-bold ${res.earned > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-ink-faint"}`}>
                              {formatCurrency(res.earned, settings.currency)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${achieved ? "bg-emerald-500" : "bg-brand-400"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg p-3 flex items-center justify-between text-emerald-900 dark:text-emerald-300">
                  <div className="text-xs font-medium opacity-80">إجمالي البونص المستحق حاليًا</div>
                  <div className="text-lg font-bold leading-tight">
                    {formatCurrency(commissionEarned, settings.currency)}
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="نظام العمولات والبونص" subtitle="شرائح مكافآت المشتريات ونسبة تحقّقها خلال الفترة" />
          <CardBody>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
              <div className="font-bold">ميزة عمولات وبونص الموردين معطلة</div>
              <div className="mt-0.5">يرجى تفعيل ترخيص الميزة لإدارة شرائح العمولة لهذا المورد.</div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="أصناف يوردها المورد"
          subtitle={suppliedParts.length > 0 ? `${suppliedParts.length} صنف` : undefined}
        />
        <CardBody>
          {suppliedParts.length === 0 ? (
            <EmptyState
              icon={<Package className="w-5 h-5" />}
              title="لا توجد أصناف مرتبطة بهذا المورد"
              description="تُربط الأصناف بالمورد من صفحة المنتجات أو عند تسجيل فاتورة شراء."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الصنف</TH>
                  <TH>رقم القطعة</TH>
                  <TH className="text-center">المخزون</TH>
                  <TH className="text-end">سعر الشراء</TH>
                </TR>
              </THead>
              <TBody>
                {suppliedParts.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link to={`/products`} className="font-medium text-ink hover:text-brand-700 dark:hover:text-brand-300 transition-colors">
                        {p.name}
                      </Link>
                      {p.partBrand ? <div className="text-[11px] text-ink-faint">{p.partBrand}</div> : null}
                    </TD>
                    <TD className="font-mono text-xs text-ink-muted" dir="ltr">{p.partNumber || p.code || "—"}</TD>
                    <TD className="text-center">
                      <Badge tone={p.quantity <= 0 ? "red" : p.quantity <= p.minStock ? "amber" : "green"}>
                        {p.quantity}
                      </Badge>
                    </TD>
                    <TD className="text-end font-mono">{formatCurrency(p.purchasePrice, settings.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="سجل فواتير الشراء"
          subtitle={`${filteredInvoices.length} من ${invoices.length} فاتورة`}
          actions={
            invoices.length > 0 ? (
              <div className="relative w-56">
                <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
                <Input
                  value={invoiceQuery}
                  onChange={(e) => setInvoiceQuery(e.target.value)}
                  placeholder="بحث برقم الفاتورة"
                  className="pe-9 h-8 text-xs"
                />
              </div>
            ) : undefined
          }
        />
        <CardBody>
          {invoices.length === 0 ? (
            <EmptyState icon={<Receipt className="w-5 h-5" />} title="لا توجد فواتير شراء من هذا المورد" />
          ) : filteredInvoices.length === 0 ? (
            <EmptyState title="لا توجد فواتير مطابقة للبحث" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الفاتورة</TH>
                  <TH>التاريخ</TH>
                  <TH className="text-end">الإجمالي</TH>
                  <TH className="text-end">المدفوع</TH>
                  <TH className="text-end">الحالة</TH>
                  <TH className="text-end"></TH>
                </TR>
              </THead>
              <TBody>
                {filteredInvoices.map((inv) => (
                  <TR key={inv.id}>
                    <TD className="font-mono text-xs">{inv.invoiceNumber}</TD>
                    <TD>{formatDate(inv.date)}</TD>
                    <TD className="text-end">{formatCurrency(inv.total, settings.currency)}</TD>
                    <TD className="text-end text-ink-muted">{formatCurrency(inv.amountPaid, settings.currency)}</TD>
                    <TD className="text-end">
                      {inv.overpayment && inv.overpayment > 0 ? (
                        <Badge tone="green">لنا رصيد {formatCurrency(inv.overpayment, settings.currency)}</Badge>
                      ) : inv.remaining > 0 ? (
                        <Badge tone="amber">متبقي {formatCurrency(inv.remaining, settings.currency)}</Badge>
                      ) : (
                        <Badge tone="green">مسدد</Badge>
                      )}
                    </TD>
                    <TD className="text-end">
                      <Link to={`/purchases/${inv.id}`} className="text-xs text-brand-700 hover:underline">
                        عرض
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit supplier dialog */}
      <SupplierFormDialog open={editOpen} editing={supplier} onClose={() => setEditOpen(false)} />

      {/* Commission tier dialog */}
      <Dialog
        open={supplierCommissionsEnabled && tierDialogOpen}
        onClose={() => setTierDialogOpen(false)}
        title={editingTier ? "تعديل شريحة عمولة" : "إضافة شريحة عمولة"}
        footer={
          <>
            <Button variant="outline" onClick={() => setTierDialogOpen(false)}>إلغاء</Button>
            <Button onClick={() => {
              if (editingTier) updateCommissionTier(supplier.id, editingTier.id, tierForm);
              else addCommissionTier(supplier.id, tierForm);
              setTierDialogOpen(false);
              toast.success("تم الحفظ بنجاح");
            }}>حفظ</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="الحد الأدنى للمشتريات" required hint="المبلغ الذي يجب تجاوزه لاستحقاق العمولة">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={tierForm.threshold || ""}
              placeholder="مثلاً: 50000"
              onChange={(e) => setTierForm({ ...tierForm, threshold: e.target.value === "" ? 0 : Number(e.target.value) })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نوع العمولة">
              <Select
                value={tierForm.commissionType}
                onChange={(e) => setTierForm({ ...tierForm, commissionType: e.target.value as CommissionType })}
              >
                <option value="percentage">نسبة مئوية (%)</option>
                <option value="fixed">مبلغ ثابت</option>
              </Select>
            </Field>
            <Field label="القيمة">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={tierForm.commissionValue || ""}
                placeholder={tierForm.commissionType === "percentage" ? "مثلاً: 2" : "مثلاً: 500"}
                onChange={(e) => setTierForm({ ...tierForm, commissionValue: e.target.value === "" ? 0 : Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="الفترة الزمنية (أيام)">
            <Input
              type="number"
              min={1}
              step={1}
              value={tierForm.periodDays || ""}
              placeholder="مثلاً: 30"
              onChange={(e) => setTierForm({ ...tierForm, periodDays: e.target.value === "" ? 30 : Number(e.target.value) })}
            />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="حذف مورد"
        message={`هل أنت متأكد من حذف المورد "${supplier.name}"؟`}
        variant="danger"
        confirmText="حذف"
      />
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
