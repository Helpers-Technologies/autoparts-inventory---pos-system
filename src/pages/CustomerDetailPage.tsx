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
  Car,
  Phone,
  MapPin,
  CalendarClock,
  ArchiveRestore,
  Search,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
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
import { useAutoPartsPro, vehicleDisplayName } from "../store/AutoPartsProContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { useFeatures } from "../lib/useFeatures";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import type { Customer } from "../types";
import { hasPermission } from "../lib/permissions";
import { printAppRoute } from "../lib/print";
import { CustomerVehicleFormDialog } from "../features/vehicles/CustomerVehicleFormDialog";
import { AddressFields, type AddressDraft } from "../features/shipping/AddressFields";
import { defaultCustomerAddress } from "../lib/shipping";
import { uid } from "../lib/utils";

const EMPTY_ADDRESS: AddressDraft = { label: "العنوان الرئيسي", governorate: "", city: "", addressLine: "", isDefault: true };

function whatsappHref(phone: string | undefined, message: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  const normalized = digits.startsWith("0") ? `20${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { customers, updateCustomer, deleteCustomer, archiveCustomer } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { customerBalance } = useReporting();
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { customerVehicles } = useAutoPartsPro();
  const { vehicleMakes, vehicleModels } = useVehicleCatalog();
  const { isEnabled } = useFeatures();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const vehicleCatalogEnabled = isEnabled("vehicleCatalog");

  const canEdit = hasPermission(currentUser, "customers", "edit");
  const canDelete = hasPermission(currentUser, "customers", "delete");

  const customer = customers.find((c) => c.id === id);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [form, setForm] = useState<Omit<Customer, "id" | "createdAt">>({
    code: "",
    name: "",
    phone: "",
    address: "",
    marketingConsent: "unknown",
    creditLimit: undefined,
    notes: "",
  });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(EMPTY_ADDRESS);

  const invoices = useMemo(
    () => (customer ? salesInvoices.filter((s) => s.customerId === customer.id) : []),
    [salesInvoices, customer]
  );
  const activeInvoices = useMemo(() => invoices.filter((s) => !s.cancelled), [invoices]);
  const vehicles = useMemo(
    () => (customer ? customerVehicles.filter((v) => v.customerId === customer.id && !v.archived) : []),
    [customerVehicles, customer]
  );
  const balance = customer ? customerBalance(customer.id) : 0;
  const totalPurchases = useMemo(
    () => activeInvoices.reduce((sum, s) => sum + s.total, 0),
    [activeInvoices]
  );

  const filteredInvoices = useMemo(() => {
    const t = invoiceQuery.trim().toLowerCase();
    const sorted = [...invoices].sort((a, b) => b.date.localeCompare(a.date));
    if (!t) return sorted;
    return sorted.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(t) ||
        (inv.vehicleLabel ?? "").toLowerCase().includes(t)
    );
  }, [invoices, invoiceQuery]);

  if (!customer) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8">
            <div className="text-ink font-medium">العميل غير موجود</div>
            <Button className="mt-4" onClick={() => navigate("/customers")}>
              <ArrowRight className="w-4 h-4" /> العودة لقائمة العملاء
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  function openEdit() {
    if (!customer) return;
    setForm({
      code: customer.code ?? "",
      name: customer.name,
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      marketingConsent: customer.marketingConsent ?? "unknown",
      creditLimit: customer.creditLimit,
      notes: customer.notes ?? "",
    });
    const address = defaultCustomerAddress(customer);
    setAddressDraft(address ? { label: address.label, recipientName: address.recipientName, phone: address.phone, governorate: address.governorate, city: address.city, district: address.district, addressLine: address.addressLine, landmark: address.landmark, buildingNumber: address.buildingNumber, floor: address.floor, apartment: address.apartment, postalCode: address.postalCode, isDefault: true, bosta: address.bosta } : { ...EMPTY_ADDRESS, addressLine: customer.address ?? "" });
    setEditOpen(true);
  }

  function submitEdit() {
    if (!customer) return;
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
    const previousDefault = defaultCustomerAddress(customer);
    const address = { ...addressDraft, id: previousDefault && !previousDefault.id.startsWith("legacy-") ? previousDefault.id : uid("address"), recipientName: addressDraft.recipientName?.trim() || form.name.trim(), phone: addressDraft.phone?.trim() || form.phone?.trim(), isDefault: true, createdAt: previousDefault?.createdAt ?? timestamp, updatedAt: timestamp };
    const others = customer.addresses?.filter((item) => item.id !== previousDefault?.id).map((item) => ({ ...item, isDefault: false })) ?? [];
    updateCustomer(customer.id, { ...form, address: address.addressLine, addresses: [address, ...others] });
    toast.success("تم تحديث بيانات العميل");
    setEditOpen(false);
  }

  function handleDelete() {
    if (!customer) return;
    const ok = deleteCustomer(customer.id);
    if (ok) {
      toast.success("تم حذف العميل");
    } else {
      archiveCustomer(customer.id, true);
      toast.success("تم أرشفة العميل", "العميل محفوظ في الأرشيف ويمكن استعادته من قائمة العملاء");
    }
    setDeleteOpen(false);
    navigate("/customers");
  }

  const whatsappMessage =
    balance > 0
      ? `مرحبًا ${customer.name}، تذكير بمستحق ${formatCurrency(balance, settings.currency)} على حسابكم لدى ${settings.companyNameAr || settings.companyName}.`
      : `مرحبًا ${customer.name}، نتواصل معكم بخصوص حسابكم لدى ${settings.companyNameAr || settings.companyName}.`;
  const whatsappUrl = whatsappHref(customer.phone, whatsappMessage);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`${customer.code ?? "بدون كود"} • ${customer.phone ?? "بدون هاتف"} • عميل منذ ${customer.createdAt ? formatDate(customer.createdAt) : "—"}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/customers")}>
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const result = await printAppRoute(`/customers/${customer.id}/statement`);
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
              <Button variant="outline" onClick={openEdit}>
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

      {customer.archived ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm">
          <span className="text-ink-muted">هذا العميل مؤرشف حاليًا ولا يظهر في القائمة الرئيسية.</span>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { archiveCustomer(customer.id, false); toast.success("تمت استعادة العميل"); }}
          >
            <ArchiveRestore className="w-3.5 h-3.5" /> استعادة
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="الرصيد الحالي"
          value={balance > 0 ? formatCurrency(balance, settings.currency) : balance < 0 ? formatCurrency(-balance, settings.currency) : "لا يوجد مستحق"}
          detail={
            customer.creditLimit
              ? `${balance > 0 ? "مديونية على العميل" : balance < 0 ? "رصيد دائن للعميل" : "الحساب متوازن"} — الحد الائتماني: ${formatCurrency(customer.creditLimit, settings.currency)}`
              : balance > 0 ? "مديونية على العميل" : balance < 0 ? "رصيد دائن للعميل" : "الحساب متوازن"
          }
          tone={customer.creditLimit && balance > customer.creditLimit ? "red" : balance > 0 ? "amber" : balance < 0 ? "green" : "blue"}
        />
        <StatCard
          icon={<ShoppingBag className="w-5 h-5" />}
          label="إجمالي المشتريات"
          value={formatCurrency(totalPurchases, settings.currency)}
          detail="قيمة كل فواتير البيع"
          tone="indigo"
        />
        <StatCard
          icon={<Receipt className="w-5 h-5" />}
          label="عدد الفواتير"
          value={String(invoices.length)}
          detail={invoices.length !== activeInvoices.length ? `منها ${invoices.length - activeInvoices.length} ملغاة` : "كل الفواتير سارية"}
          tone="blue"
        />
        <StatCard
          icon={<Car className="w-5 h-5" />}
          label="عدد السيارات"
          value={String(vehicles.length)}
          detail="مسجّلة في جراج العميل"
          tone="green"
        />
      </div>

      <Card>
        <CardHeader title="بيانات العميل" />
        <CardBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Info label="الهاتف" icon={<Phone className="w-3.5 h-3.5" />}>
              <span dir="ltr">{customer.phone ?? "—"}</span>
            </Info>
            <Info label="العنوان" icon={<MapPin className="w-3.5 h-3.5" />}>
              {customer.address ?? "—"}
            </Info>
            <Info label="الكود">
              <span className="font-mono">{customer.code ?? "—"}</span>
            </Info>
            <Info label="عميل منذ" icon={<CalendarClock className="w-3.5 h-3.5" />}>
              {customer.createdAt ? formatDate(customer.createdAt) : "—"}
            </Info>
            <Info label="التواصل التسويقي">
              {customer.marketingConsent === "opted_in"
                ? "موافق على العروض"
                : customer.marketingConsent === "opted_out"
                  ? "لا يرغب في الرسائل"
                  : "لم تُسجّل الموافقة"}
            </Info>
            {customer.notes ? (
              <Info label="ملاحظات" className="sm:col-span-2 xl:col-span-4">
                {customer.notes}
              </Info>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="عناوين التوصيل المحفوظة" subtitle="يستخدم الكاشير العنوان الافتراضي ويحسب السعر حسب المحافظة والمدينة" actions={canEdit ? <Button size="sm" variant="outline" onClick={openEdit}><Pencil className="h-3.5 w-3.5" /> تعديل الرئيسي</Button> : undefined} />
        <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(customer.addresses?.length ? customer.addresses : defaultCustomerAddress(customer) ? [defaultCustomerAddress(customer)!] : []).map((address) => (
            <div key={address.id} className="rounded-xl border border-line bg-surface-muted/30 p-3">
              <div className="flex items-center justify-between gap-2"><div className="font-semibold text-ink">{address.label}</div>{address.isDefault ? <Badge tone="blue">افتراضي</Badge> : null}</div>
              <div className="mt-2 text-sm text-ink-muted">{address.governorate || "محافظة غير محددة"}، {address.city || "مدينة غير محددة"}{address.district ? `، ${address.district}` : ""}</div>
              <div className="mt-1 text-sm text-ink">{address.addressLine}</div>
              {address.phone ? <div className="mt-2 font-mono text-xs text-ink-faint" dir="ltr">{address.phone}</div> : null}
            </div>
          ))}
        </CardBody>
      </Card>

      {vehicleCatalogEnabled && (
      <Card>
        <CardHeader
          title="سيارات العميل"
          subtitle={vehicles.length > 0 ? `${vehicles.length} سيارة مسجّلة` : undefined}
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => { setEditingVehicleId(null); setVehicleDialogOpen(true); }} className="gap-1.5">
                <Car className="w-3.5 h-3.5" /> إضافة مركبة جديدة
              </Button>
              <Link to="/customer-garage">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Car className="w-3.5 h-3.5" /> إدارة السيارات
                </Button>
              </Link>
            </div>
          }
        />
        <CardBody>
          {vehicles.length === 0 ? (
            <EmptyState
              icon={<Car className="w-5 h-5" />}
              title="لا توجد سيارات مسجّلة"
              description="سجّل أول سيارة للعميل لربطها بفواتير البيع."
              action={<Button size="sm" onClick={() => setVehicleDialogOpen(true)}><Car className="w-4 h-4" /> تسجيل سيارة</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {vehicles.map((v) => {
                const vehicleInvoiceCount = activeInvoices.filter((inv) => inv.customerVehicleId === v.id).length;
                return (
                  <div key={v.id} className="rounded-lg border border-line bg-surface-muted p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium text-ink">
                        <Car className="w-4 h-4 text-brand-600 shrink-0" />
                        {vehicleDisplayName(v, vehicleMakes, vehicleModels)}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {vehicleInvoiceCount > 0 ? (
                          <Badge tone="slate">{vehicleInvoiceCount} فاتورة</Badge>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => { setEditingVehicleId(v.id); setVehicleDialogOpen(true); }}
                          className="rounded-md p-1 text-ink-faint hover:bg-surface hover:text-brand-600"
                          title="تعديل بيانات السيارة"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-ink-faint" dir="ltr">
                      {v.plateNumber ? <span>PLATE {v.plateNumber}</span> : null}
                      {v.vin ? <span>VIN {v.vin}</span> : null}
                    </div>
                    {(v.color || v.mileageKm || v.engineCode) ? (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                        {v.color ? <span>اللون: {v.color}</span> : null}
                        {v.mileageKm ? <span>الكيلومترات: {v.mileageKm.toLocaleString("ar-EG")}</span> : null}
                        {v.engineCode ? <span dir="ltr">Engine {v.engineCode}</span> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
      )}

      <Card>
        <CardHeader
          title="سجل الفواتير"
          subtitle={`${filteredInvoices.length} من ${invoices.length} فاتورة`}
          actions={
            invoices.length > 0 ? (
              <div className="relative w-56">
                <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
                <Input
                  value={invoiceQuery}
                  onChange={(e) => setInvoiceQuery(e.target.value)}
                  placeholder="بحث برقم الفاتورة أو السيارة"
                  className="pe-9 h-8 text-xs"
                />
              </div>
            ) : undefined
          }
        />
        <CardBody>
          {invoices.length === 0 ? (
            <EmptyState icon={<Receipt className="w-5 h-5" />} title="لا توجد فواتير لهذا العميل" />
          ) : filteredInvoices.length === 0 ? (
            <EmptyState title="لا توجد فواتير مطابقة للبحث" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الفاتورة</TH>
                  <TH>السيارة</TH>
                  <TH>التاريخ</TH>
                  <TH className="text-end">الإجمالي</TH>
                  <TH className="text-end">المدفوع</TH>
                  <TH className="text-end">الحالة</TH>
                  <TH className="text-end"></TH>
                </TR>
              </THead>
              <TBody>
                {filteredInvoices.map((inv) => (
                  <TR key={inv.id} className={inv.cancelled ? "opacity-50" : undefined}>
                    <TD className={`font-mono text-xs ${inv.cancelled ? "text-ink-faint line-through" : ""}`}>
                      {inv.invoiceNumber}
                    </TD>
                    <TD className="text-ink-muted text-xs">{inv.vehicleLabel ?? "—"}</TD>
                    <TD>{formatDate(inv.date)}</TD>
                    <TD className="text-end">{formatCurrency(inv.total, settings.currency)}</TD>
                    <TD className="text-end text-ink-muted">{formatCurrency(inv.amountReceived, settings.currency)}</TD>
                    <TD className="text-end">
                      {inv.cancelled ? (
                        <Badge tone="slate">ملغاة</Badge>
                      ) : inv.overpayment && inv.overpayment > 0 ? (
                        <Badge tone="green">رصيد دائن {formatCurrency(inv.overpayment, settings.currency)}</Badge>
                      ) : inv.remaining > 0 ? (
                        <Badge tone="amber">متبقي {formatCurrency(inv.remaining, settings.currency)}</Badge>
                      ) : (
                        <Badge tone="green">مسدد</Badge>
                      )}
                    </TD>
                    <TD className="text-end">
                      <Link to={`/sales/${inv.id}`} className="text-xs text-brand-700 hover:underline">
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

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="تعديل عميل"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button onClick={submitEdit}>حفظ</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="كود العميل">
            <Input
              value={form.code ?? ""}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="font-mono"
            />
          </Field>
          <Field label="اسم العميل" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
          <Field label="الحد الائتماني" hint="أقصى مديونية مسموحة للبيع الآجل — اتركه فارغاً لعدم وضع حد">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.creditLimit ?? ""}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value === "" ? undefined : Number(e.target.value) })}
              placeholder="بدون حد"
            />
          </Field>
          <Field
            label="الموافقة على التواصل التسويقي"
            hint="لا ترسل عروضًا للعميل إذا اختار عدم استقبال الرسائل."
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
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="حذف عميل"
        message={`هل أنت متأكد من حذف "${customer.name}"؟`}
        variant="danger"
        confirmText="حذف"
      />

      <CustomerVehicleFormDialog
        open={vehicleDialogOpen}
        onClose={() => setVehicleDialogOpen(false)}
        initialCustomerId={customer.id}
        editingVehicle={customerVehicles.find((v) => v.id === editingVehicleId) ?? null}
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
