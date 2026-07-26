import { useMemo, useState } from "react";
import { Archive, CarFront, History, Pencil, Plus, ScanLine, Search, UserRound } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { formatCurrency } from "../lib/format";
import { useAutoPartsPro, isValidVin, vehicleDisplayName } from "../store/AutoPartsProContext";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { CustomerVehicleFormDialog } from "../features/vehicles/CustomerVehicleFormDialog";

export function CustomerGaragePage() {
  const { customers } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { settings } = useSettings();
  const vehicleCatalog = useVehicleCatalog();
  const pro = useAutoPartsPro();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const activeVehicles = pro.customerVehicles.filter((vehicle) => !vehicle.archived);
  const filtered = activeVehicles.filter((vehicle) => {
    const customer = customerById.get(vehicle.customerId);
    const label = vehicleDisplayName(vehicle, vehicleCatalog.vehicleMakes, vehicleCatalog.vehicleModels);
    const haystack = `${label} ${customer?.name ?? ""} ${customer?.phone ?? ""} ${vehicle.vin ?? ""} ${vehicle.plateNumber ?? ""} ${vehicle.engineCode ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const selected = pro.customerVehicles.find((vehicle) => vehicle.id === selectedId);
  const editingVehicle = pro.customerVehicles.find((vehicle) => vehicle.id === editingVehicleId) ?? null;
  const selectedSales = selected
    ? salesInvoices.filter((invoice) => invoice.customerVehicleId === selected.id && !invoice.cancelled)
    : [];
  const selectedGeneration = selected?.generationId
    ? vehicleCatalog.vehicleGenerations.find((generation) => generation.id === selected.generationId)
    : undefined;
  const selectedEngine = selected?.engineId
    ? vehicleCatalog.vehicleEngines.find((engine) => engine.id === selected.engineId)
    : undefined;

  function openAddDialog() {
    setEditingVehicleId(null);
    setDialogOpen(true);
  }

  function openEditDialog(vehicleId: string) {
    setEditingVehicleId(vehicleId);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={CarFront}
        title="سيارات العملاء"
        description="اربط كل عملية بيع بالسيارة الصحيحة، وابحث برقم اللوحة أو رقم الشاسيه، وراجع تاريخ القطع التي خرجت لنفس السيارة."
        stats={[
          { label: "سيارة مسجلة", value: activeVehicles.length },
          { label: "شاسيه مكتمل", value: activeVehicles.filter((vehicle) => vehicle.vin && isValidVin(vehicle.vin)).length },
          { label: "فواتير مرتبطة", value: salesInvoices.filter((invoice) => invoice.customerVehicleId).length },
        ]}
        actions={<Button onClick={openAddDialog} className="bg-amber-400 text-slate-950 hover:bg-amber-300"><Plus className="h-4 w-4" /> تسجيل سيارة</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.85fr]">
        <Card>
          <CardHeader title="السيارات المسجلة" subtitle="البحث يعمل بالعميل، الهاتف، اللوحة، رقم الشاسيه، الماركة والموديل" />
          <CardBody className="space-y-3">
            <div className="relative">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="امسح رقم الشاسيه أو اكتب رقم اللوحة..." className="pr-10" dir="ltr" />
            </div>
            {filtered.length === 0 ? (
              <EmptyState icon={<CarFront className="h-6 w-6" />} title="لا توجد سيارات مطابقة" description="سجل أول سيارة عميل لتفعيل التوافق داخل الكاشير." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((vehicle) => {
                  const customer = customerById.get(vehicle.customerId);
                  const make = vehicleCatalog.vehicleMakes.find((item) => item.id === vehicle.makeId);
                  const model = vehicleCatalog.vehicleModels.find((item) => item.id === vehicle.modelId);
                  const invoiceCount = salesInvoices.filter((invoice) => invoice.customerVehicleId === vehicle.id && !invoice.cancelled).length;
                  return (
                    <button key={vehicle.id} type="button" onClick={() => setSelectedId(vehicle.id)} className={`rounded-2xl border p-4 text-right transition ${selectedId === vehicle.id ? "border-cyan-500 bg-cyan-50/60 dark:bg-cyan-500/10" : "border-line bg-surface hover:border-brand-300"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-900 text-cyan-300">
                            {make?.logoPath ? <img src={make.logoPath} alt="" className="h-7 w-7 object-contain" /> : <CarFront className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-ink" dir="ltr">{make?.name} {model?.name}</div>
                            <div className="mt-0.5 text-xs text-ink-muted">{vehicle.year || "سنة غير محددة"} · {vehicle.plateNumber || "بدون لوحة"}</div>
                          </div>
                        </div>
                        <Badge tone={vehicle.generationId ? "green" : "amber"}>{vehicle.generationId ? "الجيل محدد" : "بدون جيل"}</Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-3 text-xs text-ink-muted">
                        <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {customer?.name || "عميل غير موجود"}</span>
                        <span className="flex items-center gap-1"><History className="h-3.5 w-3.5" /> {invoiceCount} فاتورة</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="بطاقة السيارة" subtitle={selected ? vehicleDisplayName(selected, vehicleCatalog.vehicleMakes, vehicleCatalog.vehicleModels) : "اختر سيارة لعرض تفاصيلها"} />
          <CardBody>
            {!selected ? <EmptyState icon={<ScanLine className="h-6 w-6" />} title="ابدأ بالبحث أو اختيار سيارة" /> : (
              <div className="space-y-4">
                <div className="rounded-2xl bg-slate-950 p-4 text-white">
                  <div className="text-[10px] font-bold tracking-[0.18em] text-cyan-300">رقم الشاسيه (VIN)</div>
                  <div className="mt-3 font-mono text-base tracking-wider" dir="ltr">{selected.vin || "لم يتم تسجيل رقم الشاسيه"}</div>
                  <div className="mt-2 text-sm text-slate-300">اللوحة: <strong className="text-white">{selected.plateNumber || "—"}</strong></div>
                </div>
                {!selected.generationId ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                    لم يتم تحديد جيل السيارة — قد تفشل مطابقة توافق بعض القطع المرتبطة بجيل محدد. عدّل بيانات السيارة وحدد الجيل لضمان دقة المطابقة.
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Info label="العميل" value={customerById.get(selected.customerId)?.name || "—"} />
                  <Info label="الجيل" value={selectedGeneration?.name || "—"} />
                  <Info label="المحرك" value={selectedEngine?.name || selected.engineCode || "—"} />
                  <Info label="العداد" value={selected.mileageKm ? `${selected.mileageKm.toLocaleString("ar-EG")} كم` : "—"} />
                  <Info label="اللون" value={selected.color || "—"} />
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-ink"><History className="h-4 w-4" /> تاريخ المبيعات</div>
                  {selectedSales.length === 0 ? <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-faint">لا توجد فواتير مرتبطة بهذه السيارة بعد.</div> : selectedSales.slice(0, 6).map((invoice) => (
                    <div key={invoice.id} className="mb-2 flex items-center justify-between rounded-xl border border-line p-3 text-sm">
                      <div><div className="font-semibold" dir="ltr">{invoice.invoiceNumber}</div><div className="text-xs text-ink-faint">{invoice.date} · {invoice.lines.length} صنف</div></div>
                      <strong>{formatCurrency(invoice.total, settings.currency)}</strong>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => openEditDialog(selected.id)}><Pencil className="h-4 w-4" /> تعديل بيانات السيارة</Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-red-600"
                    onClick={() => {
                      pro.archiveCustomerVehicle(selected.id, true);
                      setSelectedId(null);
                      toast.success("تمت أرشفة السيارة");
                    }}
                  >
                    <Archive className="h-4 w-4" /> أرشفة السيارة
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <CustomerVehicleFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editingVehicle={editingVehicle}
        onCreated={(vehicleId) => setSelectedId(vehicleId)}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-line p-3"><div className="text-[11px] text-ink-faint">{label}</div><div className="mt-1 font-semibold text-ink">{value}</div></div>;
}
