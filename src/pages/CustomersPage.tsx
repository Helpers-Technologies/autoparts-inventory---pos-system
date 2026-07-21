import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Eye, Users, Search, ScrollText, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Drawer } from "../components/ui/Drawer";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import type { Customer } from "../types";
import { Link, useLocation } from "react-router-dom";
import { hasPermission } from "../lib/permissions";

export function CustomersPage() {
  const { customers, addCustomer, updateCustomer, deleteCustomer, archiveCustomer, nextCustomerCode } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { customerBalance } = useReporting();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
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
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [toDelete, setToDelete] = useState<Customer | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [form, setForm] = useState<Omit<Customer, "id" | "createdAt">>({
    code: "",
    name: "",
    phone: "",
    address: "",
    shippingDirection: undefined,
    notes: "",
  });

  const archivedCount = useMemo(() => customers.filter((c) => c.archived).length, [customers]);

  const filtered = useMemo(() => {
    const active = customers.filter((c) => !c.archived);
    if (!q.trim()) return active;
    const t = q.trim().toLowerCase();
    return active.filter(
      (c) =>
        c.name.toLowerCase().includes(t) ||
        (c.phone ?? "").toLowerCase().includes(t) ||
        (c.code ?? "").toLowerCase().includes(t)
    );
  }, [q, customers]);

  function openNew() {
    setEditing(null);
    setForm({ code: `CUS-${String(nextCustomerCode).padStart(4, "0")}`, name: "", phone: "", address: "", shippingDirection: undefined, notes: "" });
    setOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    setForm({
      code: c.code ?? "",
      name: c.name,
      phone: c.phone ?? "",
      address: c.address ?? "",
      shippingDirection: c.shippingDirection,
      notes: c.notes ?? "",
    });
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
    if (!form.address?.trim()) {
      toast.error("العنوان مطلوب");
      return;
    }
    if (!form.shippingDirection) {
      toast.error("اتجاه الشحن مطلوب");
      return;
    }
    if (editing) {
      updateCustomer(editing.id, form);
      toast.success("تم تحديث العميل");
    } else {
      addCustomer(form);
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

  const viewingInvoices = viewing
    ? salesInvoices.filter((s) => s.customerId === viewing.id)
    : [];

  return (
    <>
      <PageHeader
        title="العملاء"
        description={`إدارة العملاء وأرصدتهم (${customers.length})`}
        actions={
          canAddCustomer ? (
            <Button onClick={openNew}>
              <Plus className="w-4 h-4" />
              إضافة عميل
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader
          title="قائمة العملاء"
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
              icon={<Users className="w-5 h-5" />}
              title="لا يوجد عملاء"
              description="ابدأ بإضافة أول عميل."
              action={
                canAddCustomer ? (
                  <Button onClick={openNew}><Plus className="w-4 h-4" /> إضافة عميل</Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الكود</TH>
                  <TH>اسم العميل</TH>
                  <TH>الهاتف</TH>
                  <TH>الاتجاه</TH>
                  <TH className="text-end">الرصيد الحالي</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const bal = customerBalance(c.id);
                  return (
                    <TR key={c.id}>
                      <TD className="text-ink-muted font-mono text-xs">{c.code ?? "—"}</TD>
                      <TD className="font-medium text-ink">{c.name}</TD>
                      <TD className="text-ink-muted">{c.phone ?? "—"}</TD>
                      <TD>
                        {c.shippingDirection === "qibli" ? (
                          <Badge tone="amber">قبلي</Badge>
                        ) : c.shippingDirection === "bahri" ? (
                          <Badge tone="blue">بحري</Badge>
                        ) : (
                          <span className="text-ink-faint text-xs">—</span>
                        )}
                      </TD>
                      <TD className="text-end">
                        {bal > 0 ? (
                          <Badge tone="amber">عليه {formatCurrency(bal, settings.currency)}</Badge>
                        ) : bal < 0 ? (
                          <Badge tone="green">له رصيد {formatCurrency(-bal, settings.currency)}</Badge>
                        ) : (
                          <Badge tone="green">لا يوجد مستحق</Badge>
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
                          <Button size="icon" variant="ghost" onClick={() => setViewing(c)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canEditCustomer ? (
                            <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          ) : null}
                          {canDeleteCustomer ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10"
                              onClick={() => setToDelete(c)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
                {showArchived && customers.filter((c) => c.archived).map((c) => (
                  <TR key={c.id} className="opacity-50 bg-surface-muted">
                    <TD className="text-ink-faint font-mono text-xs">{c.code ?? "—"}</TD>
                    <TD className="text-ink-muted line-through">{c.name}</TD>
                    <TD className="text-ink-faint">{c.phone ?? "—"}</TD>
                    <TD />
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
          <Field label="العنوان" required>
            <Input
              value={form.address ?? ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          <Field label="اتجاه الشحن" required className="col-span-2">
            <Select
              value={form.shippingDirection ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  shippingDirection: (e.target.value as "qibli" | "bahri") || undefined,
                })
              }
            >
              <option value="">— غير محدد —</option>
              <option value="qibli">قبلي (جنوب)</option>
              <option value="bahri">بحري (شمال)</option>
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

      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name}
        subtitle="ملف العميل وسجل الفواتير"
        width={560}
      >
        {viewing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Info label="الهاتف">{viewing.phone ?? "—"}</Info>
              <Info label="العنوان">{viewing.address ?? "—"}</Info>
              <Info label="الرصيد الحالي">
                {(() => {
                  const b = customerBalance(viewing.id);
                  return (
                    <span className={`font-semibold ${b > 0 ? "text-rose-700 dark:text-rose-400" : b < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-ink"}`}>
                      {b > 0
                        ? `${formatCurrency(b, settings.currency)} (مديونية)`
                        : b < 0
                          ? `${formatCurrency(-b, settings.currency)} (رصيد دائن)`
                          : "لا يوجد مستحق"}
                    </span>
                  );
                })()}
              </Info>
              <Info label="عدد الفواتير">{viewingInvoices.length}</Info>
              {viewing.notes ? (
                <Info label="ملاحظات" className="col-span-2">
                  {viewing.notes}
                </Info>
              ) : null}
            </div>
            <div>
              <div className="text-sm font-medium mb-2">سجل الفواتير</div>
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
                        <TH className="text-end"></TH>
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
                                رصيد دائن {formatCurrency(inv.overpayment, settings.currency)}
                              </Badge>
                            ) : inv.remaining > 0 ? (
                              <Badge tone="amber">
                                {formatCurrency(inv.remaining, settings.currency)}
                              </Badge>
                            ) : (
                              <Badge tone="green">مسدد</Badge>
                            )}
                          </TD>
                          <TD className="text-end">
                            <Link
                              to={`/sales/${inv.id}`}
                              className="text-xs text-brand-700 hover:underline"
                            >
                              عرض
                            </Link>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

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
      className={`bg-surface-muted border border-line rounded-lg p-3 ${className ?? ""}`}
    >
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="text-sm text-ink mt-1">{children}</div>
    </div>
  );
}
