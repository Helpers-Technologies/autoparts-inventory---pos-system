import { useMemo, useState } from "react";
import { Archive, CarFront, History, Plus, ScanLine, Search, ShieldCheck, UserRound } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { formatCurrency } from "../lib/format";
import { useAutoPartsPro, inferMakeNameFromVin, isValidVin, normalizeVin, vehicleDisplayName } from "../store/AutoPartsProContext";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";

type VehicleDraft = {
  customerId: string;
  vin: string;
  plateNumber: string;
  makeId: string;
  modelId: string;
  year: string;
  engineCode: string;
  color: string;
  mileageKm: string;
  notes: string;
};

const EMPTY_DRAFT: VehicleDraft = { customerId: "", vin: "", plateNumber: "", makeId: "", modelId: "", year: "", engineCode: "", color: "", mileageKm: "", notes: "" };

export function CustomerGaragePage() {
  const { customers } = useCatalog();
  const { salesInvoices } = useInvoicing();
  const { settings } = useSettings();
  const vehicleCatalog = useVehicleCatalog();
  const pro = useAutoPartsPro();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VehicleDraft>(EMPTY_DRAFT);
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
  const selectedSales = selected
    ? salesInvoices.filter((invoice) => invoice.customerVehicleId === selected.id && !invoice.cancelled)
    : [];

  const availableModels = vehicleCatalog.vehicleModels.filter((model) => model.makeId === draft.makeId && model.active);

  function setVin(value: string) {
    const vin = normalizeVin(value);
    const inferred = inferMakeNameFromVin(vin);
    const inferredMake = inferred
      ? vehicleCatalog.vehicleMakes.find((make) => make.name.toLowerCase() === inferred.toLowerCase())
      : undefined;
    setDraft((current) => ({ ...current, vin, makeId: current.makeId || inferredMake?.id || "", modelId: current.makeId || !inferredMake ? current.modelId : "" }));
  }

  function saveVehicle() {
    if (!draft.customerId || !draft.makeId) {
      toast.error("بيانات ناقصة", "اختر العميل وماركة السيارة.");
      return;
    }
    if (draft.vin && !isValidVin(draft.vin)) {
      toast.error("رقم VIN غير مكتمل", "رقم الشاسيه القياسي يجب أن يكون 17 حرفًا ورقمًا.");
      return;
    }
    const duplicate = pro.customerVehicles.some((vehicle) =>
      (draft.vin && vehicle.vin === draft.vin) ||
      (draft.plateNumber && vehicle.plateNumber?.toLowerCase() === draft.plateNumber.trim().toLowerCase())
    );
    if (duplicate) {
      toast.error("السيارة مسجلة بالفعل", "راجع رقم الشاسيه أو اللوحة.");
      return;
    }
    const item = pro.addCustomerVehicle({
      customerId: draft.customerId,
      vin: draft.vin || undefined,
      plateNumber: draft.plateNumber || undefined,
      makeId: draft.makeId,
      modelId: draft.modelId || undefined,
      year: draft.year ? Number(draft.year) : undefined,
      engineCode: draft.engineCode || undefined,
      color: draft.color || undefined,
      mileageKm: draft.mileageKm ? Number(draft.mileageKm) : undefined,
      notes: draft.notes || undefined,
    });
    setSelectedId(item.id);
    setDraft(EMPTY_DRAFT);
    setOpen(false);
    toast.success("تم تسجيل السيارة", "يمكن اختيارها الآن من شاشة الكاشير.");
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={CarFront}
        eyebrow="CUSTOMER GARAGE · VIN LOOKUP"
        title="جراج سيارات العملاء"
        description="اربط كل عملية بيع بالعربية الصحيحة، وابحث برقم اللوحة أو VIN، وراجع تاريخ القطع التي خرجت لنفس السيارة."
        stats={[
          { label: "سيارة مسجلة", value: activeVehicles.length },
          { label: "VIN مكتمل", value: activeVehicles.filter((vehicle) => vehicle.vin && isValidVin(vehicle.vin)).length },
          { label: "فواتير مرتبطة", value: salesInvoices.filter((invoice) => invoice.customerVehicleId).length },
        ]}
        actions={<Button onClick={() => setOpen(true)} className="bg-amber-400 text-slate-950 hover:bg-amber-300"><Plus className="h-4 w-4" /> تسجيل سيارة</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.85fr]">
        <Card>
          <CardHeader title="السيارات المسجلة" subtitle="البحث يعمل بالعميل، الهاتف، اللوحة، VIN، الماركة والموديل" />
          <CardBody className="space-y-3">
            <div className="relative">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="امسح VIN أو اكتب رقم اللوحة..." className="pr-10" dir="ltr" />
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
                        <Badge tone={vehicle.vin ? "green" : "amber"}>{vehicle.vin ? "VIN" : "ناقص VIN"}</Badge>
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
                  <div className="text-[10px] font-bold tracking-[0.18em] text-cyan-300" dir="ltr">VEHICLE IDENTITY</div>
                  <div className="mt-3 font-mono text-base tracking-wider" dir="ltr">{selected.vin || "VIN NOT RECORDED"}</div>
                  <div className="mt-2 text-sm text-slate-300">اللوحة: <strong className="text-white">{selected.plateNumber || "—"}</strong></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Info label="العميل" value={customerById.get(selected.customerId)?.name || "—"} />
                  <Info label="كود المحرك" value={selected.engineCode || "—"} />
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
                <Button variant="outline" className="w-full text-red-600" onClick={() => { pro.archiveCustomerVehicle(selected.id, true); setSelectedId(null); }}><Archive className="h-4 w-4" /> أرشفة السيارة</Button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="تسجيل سيارة عميل" subtitle="استخدم قارئ الباركود لمسح VIN أو أدخله يدويًا" width="lg" footer={<><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button onClick={saveVehicle}><ShieldCheck className="h-4 w-4" /> حفظ وربط السيارة</Button></>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="العميل" required><Select value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}><option value="">اختر العميل</option>{customers.filter((customer) => !customer.archived).map((customer) => <option key={customer.id} value={customer.id}>{customer.name} {customer.phone ? `— ${customer.phone}` : ""}</option>)}</Select></Field>
          <Field label="رقم اللوحة"><Input value={draft.plateNumber} onChange={(event) => setDraft({ ...draft, plateNumber: event.target.value })} placeholder="أ ب ج 1234" /></Field>
          <Field label="VIN / رقم الشاسيه" hint={draft.vin ? `${draft.vin.length}/17${inferMakeNameFromVin(draft.vin) ? ` · متوقع ${inferMakeNameFromVin(draft.vin)}` : ""}` : "يمكن مسحه بقارئ الباركود"} className="md:col-span-2"><div className="relative"><ScanLine className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" /><Input value={draft.vin} onChange={(event) => setVin(event.target.value)} className="pr-10 font-mono tracking-wider" dir="ltr" placeholder="17 CHARACTER VIN" /></div></Field>
          <Field label="الماركة" required><Select value={draft.makeId} onChange={(event) => setDraft({ ...draft, makeId: event.target.value, modelId: "" })}><option value="">اختر الماركة</option>{vehicleCatalog.specializedVehicleMakes.filter((make) => make.active).map((make) => <option key={make.id} value={make.id}>{make.nameAr || make.name}</option>)}</Select></Field>
          <Field label="الموديل"><Select value={draft.modelId} disabled={!draft.makeId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}><option value="">اختر الموديل</option>{availableModels.map((model) => <option key={model.id} value={model.id}>{model.nameAr || model.name}</option>)}</Select></Field>
          <Field label="سنة الصنع"><Input type="number" min="1950" max="2035" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} placeholder="2022" /></Field>
          <Field label="كود المحرك"><Input value={draft.engineCode} onChange={(event) => setDraft({ ...draft, engineCode: event.target.value.toUpperCase() })} dir="ltr" placeholder="G4FC / SQRE4T15" /></Field>
          <Field label="اللون"><Input value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></Field>
          <Field label="قراءة العداد"><Input type="number" value={draft.mileageKm} onChange={(event) => setDraft({ ...draft, mileageKm: event.target.value })} placeholder="كم" /></Field>
          <Field label="ملاحظات" className="md:col-span-2"><Textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-line p-3"><div className="text-[11px] text-ink-faint">{label}</div><div className="mt-1 font-semibold text-ink">{value}</div></div>;
}
