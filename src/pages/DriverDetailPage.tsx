import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Pencil, Phone, Printer, Receipt } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import { hasPermission } from "../lib/permissions";
import { printAppRoute } from "../lib/print";
import { useAuth } from "../store/AuthContext";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";

export function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { drivers, updateDriver } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const [editOpen, setEditOpen] = useState(false);

  const driver = drivers.find((item) => item.id === id);
  const canEdit = hasPermission(currentUser, "drivers", "edit");
  const trips = useMemo(
    () => salesInvoices
      .filter((invoice) => invoice.driverId === id && !invoice.cancelled)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [id, salesInvoices],
  );
  const cancelledTrips = useMemo(
    () => salesInvoices.filter((invoice) => invoice.driverId === id && invoice.cancelled),
    [id, salesInvoices],
  );

  if (!driver) {
    return (
      <Card>
        <CardBody className="py-12 text-center">
          <div className="text-sm text-ink-muted">السائق غير موجود</div>
          <Button className="mt-4" variant="outline" onClick={() => navigate("/drivers")}>العودة للسائقين</Button>
        </CardBody>
      </Card>
    );
  }
  const driverId = driver.id;

  const totalSales = trips.reduce((sum, invoice) => sum + invoice.total, 0);
  const totalReceived = trips.reduce((sum, invoice) => sum + invoice.amountReceived, 0);
  const totalRemaining = trips.reduce((sum, invoice) => sum + invoice.remaining, 0);
  const cashTrips = trips.filter((invoice) => invoice.paymentType === "cash").length;
  const accountTrips = trips.filter((invoice) => invoice.paymentType === "account").length;
  const averageTrip = trips.length ? totalSales / trips.length : 0;
  const uniqueCustomers = new Set(trips.map((invoice) => invoice.customerId)).size;
  const lastTrip = trips[0];
  const topCustomers = Array.from(
    trips.reduce((map, invoice) => {
      const current = map.get(invoice.customerId) ?? { name: invoice.customerName, trips: 0, total: 0 };
      current.trips += 1;
      current.total += invoice.total;
      map.set(invoice.customerId, current);
      return map;
    }, new Map<string, { name: string; trips: number; total: number }>()),
  )
    .map(([, value]) => value)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  function handleEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const phone = String(formData.get("phone") || "").trim();
    if (phone && phone.replace(/\D/g, "").length !== 11) {
      toast.error("رقم الهاتف غير صحيح", "يجب أن يكون رقم الهاتف مكونًا من 11 رقمًا");
      return;
    }
    updateDriver(driverId, {
      name: String(formData.get("name") || "").trim(),
      phone,
      licenseNumber: String(formData.get("licenseNumber") || "").trim(),
      salary: Number(formData.get("salary")) || undefined,
    });
    toast.success("تم تحديث بيانات السائق");
    setEditOpen(false);
  }

  return (
    <>
      <PageHeader
        title={driver.name}
        description="صفحة السائق الكاملة وتفاصيل الرحلات والتحصيل"
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/drivers")}>
              <ArrowRight className="h-4 w-4" /> رجوع
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const result = await printAppRoute(`/drivers/${driver.id}/statement`);
                if (!result.ok && result.error !== "cancelled") toast.error("تعذرت طباعة كشف الحساب");
              }}
            >
              <Printer className="h-4 w-4" /> كشف حساب
            </Button>
            {canEdit && (
              <Button onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> تعديل البيانات
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardHeader title="بيانات السائق" subtitle="البيانات الأساسية وآخر نشاط" />
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <InfoBox label="رقم الهاتف" value={driver.phone || "—"} icon={<Phone className="h-4 w-4" />} />
            <InfoBox label="المرتب الشهري" value={driver.salary ? formatCurrency(driver.salary, settings.currency) : "—"} />
            <InfoBox label="رقم الرخصة / السيارة" value={driver.licenseNumber || "—"} />
            <InfoBox label="تاريخ الإضافة" value={formatDate(driver.createdAt)} />
            <InfoBox label="آخر رحلة" value={lastTrip ? formatDate(lastTrip.date) : "—"} />
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="عدد الرحلات" value={trips.length.toString()} />
        <Metric label="إجمالي المبيعات" value={formatCurrency(totalSales, settings.currency)} tone="green" />
        <Metric label="المحصل" value={formatCurrency(totalReceived, settings.currency)} tone="blue" />
        <Metric label="المتبقي" value={formatCurrency(totalRemaining, settings.currency)} tone="amber" />
        <Metric label="متوسط الرحلة" value={formatCurrency(averageTrip, settings.currency)} />
        <Metric label="عملاء مختلفون" value={uniqueCustomers.toString()} />
        <Metric label="رحلات كاش" value={cashTrips.toString()} />
        <Metric label="رحلات آجل" value={accountTrips.toString()} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,0.75fr)]">
        <Card>
          <CardHeader
            title="تفاصيل الرحلات"
            subtitle={`${trips.length} رحلة مكتملة`}
            actions={cancelledTrips.length ? <Badge tone="slate">ملغاة: {cancelledTrips.length}</Badge> : undefined}
          />
          <CardBody className="p-0">
            {trips.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={<Receipt className="h-5 w-5" />} title="لا توجد رحلات" description="ستظهر هنا فواتير المبيعات المرتبطة بهذا السائق." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>الفاتورة</TH>
                    <TH>التاريخ</TH>
                    <TH>العميل</TH>
                    <TH className="text-end">الإجمالي</TH>
                    <TH className="text-end">المحصل</TH>
                    <TH className="text-end">المتبقي</TH>
                    <TH>الدفع</TH>
                    <TH className="w-16" />
                  </TR>
                </THead>
                <TBody>
                  {trips.map((invoice) => (
                    <TR key={invoice.id}>
                      <TD className="font-mono text-xs">{invoice.invoiceNumber}</TD>
                      <TD>{formatDate(invoice.date)}</TD>
                      <TD className="font-medium text-ink">{invoice.customerName}</TD>
                      <TD className="text-end">{formatCurrency(invoice.total, settings.currency)}</TD>
                      <TD className="text-end text-emerald-700 dark:text-emerald-400">{formatCurrency(invoice.amountReceived, settings.currency)}</TD>
                      <TD className="text-end">
                        {invoice.remaining > 0 ? <Badge tone="amber">{formatCurrency(invoice.remaining, settings.currency)}</Badge> : <Badge tone="green">مسدد</Badge>}
                      </TD>
                      <TD><Badge tone={invoice.paymentType === "cash" ? "green" : "indigo"}>{invoice.paymentType === "cash" ? "كاش" : "آجل"}</Badge></TD>
                      <TD><Link to={`/sales/${invoice.id}`}><Button size="sm" variant="outline">فتح</Button></Link></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="أكثر العملاء معه" subtitle="حسب إجمالي قيمة الرحلات" />
          <CardBody className="p-0">
            {topCustomers.length ? (
              <div className="divide-y divide-line-soft">
                {topCustomers.map((customer) => (
                  <div key={customer.name} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div>
                      <div className="font-medium text-ink">{customer.name}</div>
                      <div className="text-xs text-ink-faint">{customer.trips} رحلة</div>
                    </div>
                    <div className="font-semibold text-ink">{formatCurrency(customer.total, settings.currency)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-ink-faint">لا توجد بيانات بعد</div>
            )}
          </CardBody>
        </Card>
      </div>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="تعديل بيانات السائق">
        <form onSubmit={handleEdit} className="mt-2 space-y-4">
          <Field label="اسم السائق" required><Input name="name" defaultValue={driver.name} required autoFocus /></Field>
          <Field label="رقم الهاتف (11 رقم)"><Input name="phone" defaultValue={driver.phone} maxLength={11} inputMode="numeric" onChange={(event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 11); }} /></Field>
          <Field label="المرتب الشهري"><Input name="salary" type="number" min={0} step="any" defaultValue={driver.salary} /></Field>
          <Field label="رقم الرخصة / السيارة"><Input name="licenseNumber" defaultValue={driver.licenseNumber} /></Field>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button type="submit">حفظ</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function InfoBox({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="min-h-20 rounded-lg border border-line bg-surface-muted p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-faint">{icon}<span>{label}</span></div>
      <div className="mt-2 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function Metric({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "green" | "blue" | "amber" }) {
  const colors = {
    slate: "text-ink",
    green: "text-emerald-700 dark:text-emerald-400",
    blue: "text-blue-700 dark:text-blue-400",
    amber: "text-amber-700 dark:text-amber-400",
  };
  return (
    <Card className="h-24">
      <CardBody className="flex h-full flex-col justify-center p-3">
        <div className="text-xs text-ink-faint">{label}</div>
        <div className={`mt-1 text-base font-bold tabular-nums ${colors[tone]}`}>{value}</div>
      </CardBody>
    </Card>
  );
}
