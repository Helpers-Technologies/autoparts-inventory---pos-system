import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Eye, Factory, Search, ScrollText, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Textarea } from "../components/ui/Input";
import { Drawer } from "../components/ui/Drawer";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import type { Supplier, CommissionTier, CommissionType } from "../types";
import { Select } from "../components/ui/Input";
import { hasPermission } from "../lib/permissions";
import { formatSupplierCode } from "../lib/codes";
import { Link, useLocation } from "react-router-dom";

export function SuppliersPage() {
  const { suppliers, addSupplier, updateSupplier, deleteSupplier, archiveSupplier, addCommissionTier, updateCommissionTier, deleteCommissionTier, nextSupplierCode } = useCatalog();
  const { purchaseInvoices } = useInvoicing();
  const { supplierBalance, calculateSupplierCommission } = useReporting();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const loc = useLocation();
  const canAddSupplier = hasPermission(currentUser, "suppliers", "add");
  const canEditSupplier = hasPermission(currentUser, "suppliers", "edit");
  const canDeleteSupplier = hasPermission(currentUser, "suppliers", "delete");
  const canManageCommissions = hasPermission(currentUser, "suppliers", "commissions");

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
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [toDelete, setToDelete] = useState<Supplier | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  
  const [tierDialogOpen, setTierDialogOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<CommissionTier | null>(null);
  const [tierForm, setTierForm] = useState<Omit<CommissionTier, "id">>({
    threshold: 0,
    commissionType: "percentage",
    commissionValue: 0,
    periodDays: 30,
  });

  const [form, setForm] = useState<Omit<Supplier, "id" | "createdAt">>({
    code: "",
    name: "",
    phone: "",
    address: "",
    notes: "",
    commissionNote: "",
  });

  const archivedCount = useMemo(() => suppliers.filter((s) => s.archived).length, [suppliers]);

  const filtered = useMemo(() => {
    const active = suppliers.filter((s) => !s.archived);
    if (!q.trim()) return active;
    const t = q.trim().toLowerCase();
    return active.filter(
      (s) =>
        s.name.toLowerCase().includes(t) ||
        (s.phone ?? "").toLowerCase().includes(t) ||
        (s.code ?? "").toLowerCase().includes(t)
    );
  }, [q, suppliers]);

  function openNew() {
    setEditing(null);
    setForm({
      code: formatSupplierCode(nextSupplierCode),
      name: "",
      phone: "",
      address: "",
      notes: "",
      commissionNote: "",
    });
    setOpen(true);
  }
  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      code: s.code ?? "",
      name: s.name,
      phone: s.phone ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
      commissionNote: s.commissionNote ?? "",
    });
    setOpen(true);
  }
  function submit() {
    if (!form.name.trim()) {
      toast.error("الاسم مطلوب");
      return;
    }
    if (form.phone && form.phone.trim().replace(/\D/g, "").length < 11) {
      toast.error("رقم الهاتف غير صحيح", "يجب أن يحتوي على 11 رقماً على الأقل");
      return;
    }
    if (editing) {
      updateSupplier(editing.id, form);
      toast.success("تم تحديث المورد");
    } else {
      addSupplier(form);
      toast.success("تم إضافة المورد");
    }
    setOpen(false);
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

  const viewingInvoices = viewing
    ? purchaseInvoices.filter((p) => p.supplierId === viewing.id)
    : [];

  return (
    <>
      <PageHeader
        title="الموردين / المصانع"
        description={`إدارة الموردين وأرصدتهم (${suppliers.length})`}
        actions={
          canAddSupplier ? (
            <Button onClick={openNew}>
              <Plus className="w-4 h-4" />
              إضافة مورد
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader
          title="قائمة الموردين"
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
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف أو الكود (/ أو Ctrl+F)"
              className="pe-9"
            />
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Factory className="w-5 h-5" />}
              title="لا يوجد موردون"
              description="ابدأ بإضافة أول مورد لشركتك."
              action={
                canAddSupplier ? (
                  <Button onClick={openNew}><Plus className="w-4 h-4" /> إضافة مورد</Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الكود</TH>
                  <TH>اسم المورد</TH>
                  <TH>الهاتف</TH>
                  <TH>العنوان</TH>
                  <TH>ملاحظة عمولة</TH>
                  <TH className="text-end">الرصيد المستحق</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => {
                  const bal = supplierBalance(s.id);
                  return (
                    <TR key={s.id}>
                      <TD className="text-ink-faint font-mono text-xs">{s.code ?? "—"}</TD>
                      <TD className="font-medium text-ink">{s.name}</TD>
                      <TD className="text-ink-muted">{s.phone ?? "—"}</TD>
                      <TD className="text-ink-muted">{s.address ?? "—"}</TD>
                      <TD className="text-ink-muted text-xs">
                        {s.commissionNote ?? "—"}
                      </TD>
                      <TD className="text-end">
                        {bal > 0 ? (
                          <Badge tone="amber">
                            {formatCurrency(bal, settings.currency)}
                          </Badge>
                        ) : bal < 0 ? (
                          <Badge tone="green">
                            لنا رصيد {formatCurrency(-bal, settings.currency)}
                          </Badge>
                        ) : (
                          <Badge tone="green">مسدد</Badge>
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
                          <Button size="icon" variant="ghost" onClick={() => setViewing(s)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canEditSupplier ? (
                            <Button size="icon" variant="ghost" onClick={() => openEdit(s)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          ) : null}
                          {canDeleteSupplier ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10"
                              onClick={() => setToDelete(s)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
                {showArchived && suppliers.filter((s) => s.archived).map((s) => (
                  <TR key={s.id} className="opacity-50 bg-surface-muted">
                    <TD className="text-ink-faint font-mono text-xs">{s.code ?? "—"}</TD>
                    <TD className="text-ink-faint line-through">{s.name}</TD>
                    <TD className="text-ink-faint">{s.phone ?? "—"}</TD>
                    <TD />
                    <TD />
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "تعديل مورد" : "إضافة مورد"}
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
          <Field label="كود المورد">
            <Input
              value={form.code ?? ""}
              readOnly
              className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70 font-mono"
            />
          </Field>
          <Field label="اسم المورد" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="الهاتف">
            <Input
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="العنوان">
            <Input
              value={form.address ?? ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          <Field label="ملاحظة عمولة / هدف" className="col-span-2">
            <Input
              value={form.commissionNote ?? ""}
              onChange={(e) =>
                setForm({ ...form, commissionNote: e.target.value })
              }
              placeholder="مثل: خصم 2% على الكميات الكبيرة"
            />
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

      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name}
        subtitle="سجل المورد والفواتير"
        width={560}
      >
        {viewing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Info label="الهاتف">{viewing.phone ?? "—"}</Info>
              <Info label="العنوان">{viewing.address ?? "—"}</Info>
              <Info label="الرصيد المستحق">
                <span className={`font-semibold ${supplierBalance(viewing.id) < 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                  {supplierBalance(viewing.id) < 0
                    ? `لنا رصيد ${formatCurrency(-supplierBalance(viewing.id), settings.currency)}`
                    : formatCurrency(supplierBalance(viewing.id), settings.currency)}
                </span>
              </Info>
              <Info label="عدد الفواتير">{viewingInvoices.length}</Info>
              <Info label="ملاحظة عمولة" className="col-span-2">
                {viewing.commissionNote ?? "—"}
              </Info>
              {viewing.notes ? (
                <Info label="ملاحظات" className="col-span-2">
                  {viewing.notes}
                </Info>
              ) : null}
            </div>
            <div>
              <div className="text-sm font-medium mb-2">فواتير المورد</div>
              {viewingInvoices.length === 0 ? (
                <EmptyState title="لا توجد فواتير" />
              ) : (
                <div className="border border-line rounded-lg overflow-hidden">
                  <Table>
                    <THead>
                      <TR>
                        <TH>الفاتورة</TH>
                        <TH>التاريخ</TH>
                        <TH className="text-end">الإجمالي</TH>
                        <TH className="text-end">المتبقي</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {viewingInvoices.map((inv) => (
                        <TR key={inv.id}>
                          <TD className="font-mono text-xs">{inv.invoiceNumber}</TD>
                          <TD>{formatDate(inv.date)}</TD>
                          <TD className="text-end">
                            {formatCurrency(inv.total, settings.currency)}
                          </TD>
                          <TD className="text-end">
                            {inv.overpayment && inv.overpayment > 0 ? (
                              <Badge tone="green">
                                لنا رصيد {formatCurrency(inv.overpayment, settings.currency)}
                              </Badge>
                            ) : inv.remaining > 0 ? (
                              <Badge tone="amber">
                                {formatCurrency(inv.remaining, settings.currency)}
                              </Badge>
                            ) : (
                              <Badge tone="green">مسدد</Badge>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Commissions Section */}
            <div className="pt-4 border-t border-line-soft">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">نظام العمولات والبونص</div>
                {canManageCommissions && (
                  <Button size="sm" variant="outline" onClick={() => {
                    setEditingTier(null);
                    setTierForm({ threshold: 0, commissionType: "percentage", commissionValue: 0, periodDays: 30 });
                    setTierDialogOpen(true);
                  }}>
                    <Plus className="w-3.5 h-3.5" /> إضافة شريحة
                  </Button>
                )}
              </div>

              {calculateSupplierCommission(viewing.id).length === 0 ? (
                <div className="text-xs text-ink-faint bg-surface-muted border border-line-soft rounded-lg p-3 text-center">
                  لا توجد شرائح عمولة محددة لهذا المورد.
                </div>
              ) : (
                <div className="space-y-3">
                  {calculateSupplierCommission(viewing.id).map(res => (
                    <div key={res.tierId} className="bg-surface border border-line rounded-lg p-3 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-xs font-semibold text-ink">
                            شريحة: {formatCurrency(res.threshold, settings.currency)} في {res.periodDays} يوم
                          </div>
                          <div className="text-[11px] text-ink-faint mt-0.5">
                            العمولة: {res.commissionType === "percentage" ? `${res.commissionValue}%` : formatCurrency(res.commissionValue, settings.currency)}
                          </div>
                        </div>
                        {canManageCommissions && (
                          <div className="flex gap-1">
                            <button onClick={() => {
                              const t = viewing.commissionTiers?.find(x => x.id === res.tierId);
                              if (t) {
                                setEditingTier(t);
                                setTierForm({ ...t });
                                setTierDialogOpen(true);
                              }
                            }} className="p-1 hover:bg-surface-muted rounded text-ink-faint hover:text-brand-600 transition-colors">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button onClick={() => deleteCommissionTier(viewing.id, res.tierId)} className="p-1 hover:bg-surface-muted rounded text-ink-faint hover:text-red-600 dark:text-red-400 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-3 pt-2 border-t border-line-soft flex items-center justify-between">
                        <div className="text-[11px]">
                          <span className="text-ink-faint">المشتريات الحالية: </span>
                          <span className="font-medium">{formatCurrency(res.totalPurchases, settings.currency)}</span>
                        </div>
                        <div className="text-xs">
                          <span className="text-ink-faint">البونص: </span>
                          <span className={`font-bold ${res.earned > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-ink-faint"}`}>
                            {formatCurrency(res.earned, settings.currency)}
                          </span>
                        </div>
                      </div>
                      
                      {res.totalPurchases < res.threshold && (
                        <div className="mt-1.5 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-brand-400" 
                            style={{ width: `${Math.min(100, (res.totalPurchases / res.threshold) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg p-3 text-emerald-900 dark:text-emerald-300">
                    <div className="text-[11px] font-medium opacity-75">إجمالي البونص المستحق حالياً</div>
                    <div className="text-lg font-bold leading-tight mt-0.5">
                      {formatCurrency(calculateSupplierCommission(viewing.id).reduce((s, r) => s + r.earned, 0), settings.currency)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

      <Dialog
        open={tierDialogOpen}
        onClose={() => setTierDialogOpen(false)}
        title={editingTier ? "تعديل شريحة عمولة" : "إضافة شريحة عمولة"}
        footer={
          <>
            <Button variant="outline" onClick={() => setTierDialogOpen(false)}>إلغاء</Button>
            <Button onClick={() => {
              if (viewing) {
                if (editingTier) updateCommissionTier(viewing.id, editingTier.id, tierForm);
                else addCommissionTier(viewing.id, tierForm);
                setTierDialogOpen(false);
                toast.success("تم الحفظ بنجاح");
              }
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
              onChange={e => setTierForm({...tierForm, threshold: e.target.value === "" ? 0 : Number(e.target.value)})}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نوع العمولة">
              <Select
                value={tierForm.commissionType}
                onChange={e => setTierForm({...tierForm, commissionType: e.target.value as CommissionType})}
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
                onChange={e => setTierForm({...tierForm, commissionValue: e.target.value === "" ? 0 : Number(e.target.value)})}
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
              onChange={e => setTierForm({...tierForm, periodDays: e.target.value === "" ? 30 : Number(e.target.value)})}
            />
          </Field>
        </div>
      </Dialog>

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

function Info({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-surface-muted border border-line-soft rounded-lg p-3 ${className ?? ""}`}
    >
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="text-sm text-ink mt-1">{children}</div>
    </div>
  );
}
