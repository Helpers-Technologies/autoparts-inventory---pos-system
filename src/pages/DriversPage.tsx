import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Phone, Plus, Receipt, Settings2, Trash2, Truck } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Field, Input } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { Badge } from "../components/ui/Badge";
import { Drawer } from "../components/ui/Drawer";
import { EmptyState } from "../components/ui/EmptyState";
import type { Driver, SalesInvoice } from "../types";
import { formatCurrency, formatDate } from "../lib/format";
import { hasPermission } from "../lib/permissions";

export function DriversPage() {
  const { drivers, addDriver, updateDriver, deleteDriver } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const canAddDriver = hasPermission(currentUser, "drivers", "add");
  const canEditDriver = hasPermission(currentUser, "drivers", "edit");
  const canDeleteDriver = hasPermission(currentUser, "drivers", "delete");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Driver | null>(null);

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      name: fd.get("name") as string,
      phone: fd.get("phone") as string,
      licenseNumber: fd.get("licenseNumber") as string,
    };

    if (editing) {
      updateDriver(editing.id, data);
      toast.success("تم التحديث");
    } else {
      addDriver(data);
      toast.success("تمت الإضافة");
    }
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="السائقين"
        description="إدارة بيانات السائقين وتتبع رحلاتهم"
        actions={
          canAddDriver ? (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> إضافة سائق
            </Button>
          ) : null
        }
      />

      <Card>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>الاسم</TH>
                <TH>رقم الهاتف</TH>
                <TH>رقم الرخصة</TH>
                <TH>عدد الفواتير (رحلات)</TH>
                <TH>إجمالي المبيعات</TH>
                <TH className="w-24"></TH>
              </TR>
            </THead>
            <TBody>
              {drivers.length === 0 ? (
                <TR>
                  <TD colSpan={6} className="text-center py-8 text-ink-faint">
                    لا يوجد سائقين مسجلين
                  </TD>
                </TR>
              ) : (
                drivers.map((d) => {
                  const trips = salesInvoices.filter((inv) => inv.driverId === d.id && !inv.cancelled);
                  const tripsTotal = trips.reduce((acc, inv) => acc + inv.total, 0);

                  return (
                    <TR
                      key={d.id}
                      className="cursor-pointer hover:bg-surface-muted"
                      onClick={() => setViewing(d)}
                    >
                      <TD className="font-medium">{d.name}</TD>
                      <TD>{d.phone || "—"}</TD>
                      <TD>{d.licenseNumber || "—"}</TD>
                      <TD>{trips.length}</TD>
                      <TD className="font-medium text-ink">{formatCurrency(tripsTotal, settings.currency)}</TD>
                      <TD>
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewing(d);
                            }}
                            className="p-1.5 text-ink-faint hover:text-brand-600 transition-colors"
                            title="عرض التفاصيل"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canEditDriver ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditing(d);
                                setOpen(true);
                              }}
                              className="p-1.5 text-ink-faint hover:text-brand-600 transition-colors"
                              title="تعديل"
                            >
                              <Settings2 className="w-4 h-4" />
                            </button>
                          ) : null}
                          {canDeleteDriver ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDelId(d.id);
                              }}
                              className="p-1.5 text-ink-faint hover:text-rose-600 dark:text-rose-400 transition-colors"
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "تعديل بيانات السائق" : "إضافة سائق جديد"}
      >
        <form id="driverForm" onSubmit={handleSave} className="space-y-4 mt-4">
          <Field label="اسم السائق" required>
            <Input name="name" defaultValue={editing?.name} required autoFocus />
          </Field>
          <Field label="رقم الهاتف">
            <Input name="phone" defaultValue={editing?.phone} />
          </Field>
          <Field label="رقم الرخصة / السيارة">
            <Input name="licenseNumber" defaultValue={editing?.licenseNumber} />
          </Field>
          <div className="flex justify-end gap-3 pt-4 border-t border-line-soft">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit">حفظ</Button>
          </div>
        </form>
      </Dialog>

      <DriverDetailsDrawer
        driver={viewing}
        invoices={salesInvoices}
        currency={settings.currency}
        canEdit={canEditDriver}
        onClose={() => setViewing(null)}
        onEdit={(driver) => {
          if (!canEditDriver) return;
          setViewing(null);
          setEditing(driver);
          setOpen(true);
        }}
      />

      <ConfirmDialog
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          if (!delId) return;
          const ok = deleteDriver(delId);
          if (ok) {
            toast.success("تم الحذف");
          } else {
            toast.error("لا يمكن حذف سائق لديه فواتير مرتبطة");
          }
          setDelId(null);
        }}
        title="حذف السائق"
        message="هل أنت متأكد من حذف هذا السائق؟ لا يمكن التراجع عن هذا الإجراء."
        confirmText="حذف نهائي"
        variant="danger"
      />
    </>
  );
}

function DriverDetailsDrawer({
  driver,
  invoices,
  currency,
  canEdit,
  onClose,
  onEdit,
}: {
  driver: Driver | null;
  invoices: SalesInvoice[];
  currency: string;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (driver: Driver) => void;
}) {
  if (!driver) return null;

  const trips = invoices
    .filter((invoice) => invoice.driverId === driver.id && !invoice.cancelled)
    .sort((a, b) => b.date.localeCompare(a.date));
  const cancelledTrips = invoices.filter(
    (invoice) => invoice.driverId === driver.id && invoice.cancelled
  );
  const totalSales = trips.reduce((sum, invoice) => sum + invoice.total, 0);
  const totalReceived = trips.reduce((sum, invoice) => sum + invoice.amountReceived, 0);
  const totalRemaining = trips.reduce((sum, invoice) => sum + invoice.remaining, 0);
  const cashTrips = trips.filter((invoice) => invoice.paymentType === "cash").length;
  const accountTrips = trips.filter((invoice) => invoice.paymentType === "account").length;
  const lastTrip = trips[0];
  const averageTrip = trips.length > 0 ? totalSales / trips.length : 0;
  const uniqueCustomers = new Set(trips.map((invoice) => invoice.customerId)).size;
  const topCustomers = Array.from(
    trips.reduce((map, invoice) => {
      const current = map.get(invoice.customerId) ?? {
        name: invoice.customerName,
        trips: 0,
        total: 0,
      };
      current.trips += 1;
      current.total += invoice.total;
      map.set(invoice.customerId, current);
      return map;
    }, new Map<string, { name: string; trips: number; total: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  return (
    <Drawer
      open={!!driver}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-brand-600" />
          <span>{driver.name}</span>
        </div>
      }
      subtitle="بيانات السائق وتفاصيل رحلاته وفواتيره"
      width={760}
      footer={
        canEdit ? (
          <Button variant="outline" onClick={() => onEdit(driver)}>
            <Settings2 className="w-4 h-4" /> تعديل البيانات
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <InfoBox label="رقم الهاتف" value={driver.phone || "—"} icon={<Phone className="w-4 h-4" />} />
          <InfoBox label="رقم الرخصة / السيارة" value={driver.licenseNumber || "—"} />
          <InfoBox label="تاريخ الإضافة" value={formatDate(driver.createdAt)} />
          <InfoBox label="آخر رحلة" value={lastTrip ? formatDate(lastTrip.date) : "—"} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label="عدد الرحلات" value={trips.length.toString()} />
          <Metric label="إجمالي المبيعات" value={formatCurrency(totalSales, currency)} tone="green" />
          <Metric label="المحصل" value={formatCurrency(totalReceived, currency)} tone="blue" />
          <Metric label="المتبقي" value={formatCurrency(totalRemaining, currency)} tone="amber" />
          <Metric label="متوسط الرحلة" value={formatCurrency(averageTrip, currency)} />
          <Metric label="عملاء مختلفين" value={uniqueCustomers.toString()} />
          <Metric label="رحلات كاش" value={cashTrips.toString()} />
          <Metric label="رحلات آجل" value={accountTrips.toString()} />
        </div>

        <div className="rounded-lg border border-line overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-surface-muted px-3 py-2 border-b border-line">
            <div className="text-sm font-semibold text-ink">تفاصيل الرحلات</div>
            {cancelledTrips.length > 0 ? (
              <Badge tone="slate">ملغاة: {cancelledTrips.length}</Badge>
            ) : null}
          </div>
          {trips.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Receipt className="w-5 h-5" />}
                title="لا توجد رحلات"
                description="ستظهر هنا فواتير المبيعات المرتبطة بهذا السائق."
              />
            </div>
          ) : (
            <div className="max-h-80 overflow-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>الفاتورة</TH>
                    <TH>التاريخ</TH>
                    <TH>العميل</TH>
                    <TH className="text-end">الإجمالي</TH>
                    <TH className="text-end">المتبقي</TH>
                    <TH>الدفع</TH>
                    <TH className="w-14"></TH>
                  </TR>
                </THead>
                <TBody>
                  {trips.map((invoice) => (
                    <TR key={invoice.id}>
                      <TD className="font-mono text-xs">{invoice.invoiceNumber}</TD>
                      <TD>{formatDate(invoice.date)}</TD>
                      <TD className="font-medium text-ink">{invoice.customerName}</TD>
                      <TD className="text-end">{formatCurrency(invoice.total, currency)}</TD>
                      <TD className="text-end">
                        {invoice.remaining > 0 ? (
                          <Badge tone="amber">{formatCurrency(invoice.remaining, currency)}</Badge>
                        ) : (
                          <Badge tone="green">مسدد</Badge>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={invoice.paymentType === "cash" ? "green" : "indigo"}>
                          {invoice.paymentType === "cash" ? "كاش" : "آجل"}
                        </Badge>
                      </TD>
                      <TD>
                        <Link to={`/sales/${invoice.id}`}>
                          <Button size="sm" variant="outline">فتح</Button>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>

        {topCustomers.length > 0 ? (
          <div className="rounded-lg border border-line overflow-hidden">
            <div className="bg-surface-muted px-3 py-2 border-b border-line text-sm font-semibold text-ink">
              أكثر العملاء معه
            </div>
            <div className="divide-y divide-line-soft">
              {topCustomers.map((customer) => (
                <div key={customer.name} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div>
                    <div className="font-medium text-ink">{customer.name}</div>
                    <div className="text-xs text-ink-faint">{customer.trips} رحلة</div>
                  </div>
                  <div className="font-semibold text-ink">
                    {formatCurrency(customer.total, currency)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

function InfoBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-muted p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-faint">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "green" | "blue" | "amber";
}) {
  const colors: Record<"slate" | "green" | "blue" | "amber", string> = {
    slate: "text-ink",
    green: "text-emerald-700 dark:text-emerald-400",
    blue: "text-blue-700 dark:text-blue-400",
    amber: "text-amber-700 dark:text-amber-400",
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`mt-1 text-base font-bold ${colors[tone]}`}>{value}</div>
    </div>
  );
}
