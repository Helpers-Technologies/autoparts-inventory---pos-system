import { useEffect, useMemo, useState } from "react";
import { CarFront, ChevronLeft, Gauge, Plus, Search, Settings2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { VehicleSpecializationDialog } from "../features/vehicles/VehicleSpecializationDialog";
import { VEHICLE_COUNTRIES, vehicleCountryLabel } from "../data/vehicleCountries";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";

const FUEL_LABELS = {
  petrol: "بنزين",
  diesel: "ديزل",
  hybrid: "هايبرد",
  electric: "كهرباء",
  other: "أخرى",
} as const;

export function VehicleCatalogPage() {
  const catalog = useVehicleCatalog();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [selectedMakeId, setSelectedMakeId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [makeDialog, setMakeDialog] = useState(false);
  const [modelDialog, setModelDialog] = useState(false);
  const [generationDialog, setGenerationDialog] = useState(false);
  const [engineGenerationId, setEngineGenerationId] = useState("");
  const [specializationDialog, setSpecializationDialog] = useState(false);

  const [makeForm, setMakeForm] = useState({ name: "", nameAr: "", countryCode: "" });
  const [modelForm, setModelForm] = useState({ name: "", nameAr: "", vehicleType: "Passenger Car" });
  const [generationForm, setGenerationForm] = useState({ name: "", yearFrom: "", yearTo: "", bodyTypes: "" });
  const [engineForm, setEngineForm] = useState({
    name: "",
    code: "",
    capacityCc: "",
    fuelType: "petrol" as keyof typeof FUEL_LABELS,
    powerHp: "",
  });

  const makes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.specializedVehicleMakes
      .filter((make) => make.active)
      .filter((make) => (countryFilter ? make.countryCode === countryFilter : true))
      .filter((make) =>
        needle ? `${make.name} ${make.nameAr ?? ""} ${vehicleCountryLabel(make.countryCode)}`.toLowerCase().includes(needle) : true,
      )
      .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999) || a.name.localeCompare(b.name));
  }, [catalog.specializedVehicleMakes, countryFilter, query]);

  const specializedMakeIds = useMemo(
    () => new Set(catalog.specializedVehicleMakes.map((make) => make.id)),
    [catalog.specializedVehicleMakes],
  );
  const specializedModelIds = useMemo(
    () => new Set(catalog.vehicleModels.filter((model) => specializedMakeIds.has(model.makeId)).map((model) => model.id)),
    [catalog.vehicleModels, specializedMakeIds],
  );
  const availableCountries = useMemo(
    () => VEHICLE_COUNTRIES.filter((country) =>
      catalog.specializedVehicleMakes.some((make) => make.active && make.countryCode === country.code),
    ),
    [catalog.specializedVehicleMakes],
  );

  useEffect(() => {
    if (countryFilter && !availableCountries.some((country) => country.code === countryFilter)) {
      setCountryFilter("");
    }
    if (selectedMakeId && !specializedMakeIds.has(selectedMakeId)) {
      setSelectedMakeId("");
      setSelectedModelId("");
    }
  }, [availableCountries, countryFilter, selectedMakeId, specializedMakeIds]);

  const selectedMake = catalog.vehicleMakes.find((make) => make.id === selectedMakeId);
  const makeModels = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    return catalog.vehicleModels
      .filter((model) => model.makeId === selectedMakeId && model.active)
      .filter((model) =>
        needle ? `${model.name} ${model.nameAr ?? ""} ${model.vehicleType ?? ""}`.toLowerCase().includes(needle) : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog.vehicleModels, modelQuery, selectedMakeId]);
  const selectedModel = catalog.vehicleModels.find((model) => model.id === selectedModelId);
  const generations = catalog.vehicleGenerations
    .filter((generation) => generation.modelId === selectedModelId && generation.active)
    .sort((a, b) => (b.yearFrom ?? 0) - (a.yearFrom ?? 0));

  function chooseMake(id: string) {
    setSelectedMakeId(id);
    setSelectedModelId("");
    setModelQuery("");
  }

  function submitMake() {
    if (!makeForm.name.trim()) return;
    const created = catalog.addVehicleMake({
      name: makeForm.name.trim(),
      nameAr: makeForm.nameAr.trim() || undefined,
      countryCode: makeForm.countryCode || undefined,
      active: true,
    });
    if (
      !catalog.vehicleCatalogPreferences.includeAllMakes &&
      (!created.countryCode || !catalog.vehicleCatalogPreferences.selectedCountryCodes.includes(created.countryCode))
    ) {
      catalog.updateVehicleCatalogPreferences({
        selectedMakeIds: [...catalog.vehicleCatalogPreferences.selectedMakeIds, created.id],
      });
    }
    setMakeForm({ name: "", nameAr: "", countryCode: "" });
    setMakeDialog(false);
    chooseMake(created.id);
    toast.success("تمت إضافة الماركة");
  }

  function submitModel() {
    if (!selectedMakeId || !modelForm.name.trim()) return;
    const created = catalog.addVehicleModel({
      makeId: selectedMakeId,
      name: modelForm.name.trim(),
      nameAr: modelForm.nameAr.trim() || undefined,
      vehicleType: modelForm.vehicleType.trim() || undefined,
      active: true,
    });
    setModelForm({ name: "", nameAr: "", vehicleType: "Passenger Car" });
    setModelDialog(false);
    setSelectedModelId(created.id);
    toast.success("تمت إضافة الموديل");
  }

  function submitGeneration() {
    if (!selectedModelId || !generationForm.name.trim()) return;
    catalog.addVehicleGeneration({
      modelId: selectedModelId,
      name: generationForm.name.trim(),
      yearFrom: generationForm.yearFrom ? Number(generationForm.yearFrom) : undefined,
      yearTo: generationForm.yearTo ? Number(generationForm.yearTo) : undefined,
      bodyTypes: generationForm.bodyTypes
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      active: true,
    });
    setGenerationForm({ name: "", yearFrom: "", yearTo: "", bodyTypes: "" });
    setGenerationDialog(false);
    toast.success("تمت إضافة الجيل");
  }

  function submitEngine() {
    if (!engineGenerationId || !engineForm.name.trim()) return;
    catalog.addVehicleEngine({
      generationId: engineGenerationId,
      name: engineForm.name.trim(),
      code: engineForm.code.trim() || undefined,
      capacityCc: engineForm.capacityCc ? Number(engineForm.capacityCc) : undefined,
      fuelType: engineForm.fuelType,
      powerHp: engineForm.powerHp ? Number(engineForm.powerHp) : undefined,
      active: true,
    });
    setEngineForm({ name: "", code: "", capacityCc: "", fuelType: "petrol", powerHp: "" });
    setEngineGenerationId("");
    toast.success("تمت إضافة المحرك");
  }

  return (
    <>
      <PageHeader
        title="كتالوج السيارات"
        description="الماركات والموديلات والأجيال والمحركات المستخدمة لربط قطع الغيار"
        actions={<div className="flex items-center gap-2"><Button variant="outline" onClick={() => setSpecializationDialog(true)}><Settings2 className="w-4 h-4" />تخصص المحل</Button><Button onClick={() => setMakeDialog(true)}><Plus className="w-4 h-4" />إضافة ماركة</Button></div>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CatalogStat label="ماركات تخصص المحل" value={catalog.specializedVehicleMakes.filter((item) => item.active).length} />
        <CatalogStat label="الموديلات المتاحة" value={catalog.vehicleModels.filter((item) => item.active && specializedMakeIds.has(item.makeId)).length} />
        <CatalogStat label="الأجيال" value={catalog.vehicleGenerations.filter((item) => item.active && specializedModelIds.has(item.modelId)).length} />
        <CatalogStat label="كل ماركات الكتالوج" value={catalog.vehicleMakes.filter((item) => item.active).length} />
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50/70 dark:bg-brand-500/10 dark:border-brand-500/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-sm font-semibold">{catalog.vehicleCatalogPreferences.includeAllMakes ? "النشاط يعرض كل ماركات السيارات" : `النشاط مخصص لـ ${catalog.specializedVehicleMakes.filter((make) => make.active).length} ماركة`}</div><div className="text-xs text-ink-muted mt-0.5">يُطبق الاختيار على الكتالوج ودليل قطع الغيار وربط المنتجات بالسيارات</div></div>
        <div className="flex flex-wrap gap-1.5">{catalog.vehicleCatalogPreferences.selectedCountryCodes.map((code) => <Badge key={code} tone="blue">{vehicleCountryLabel(code)}</Badge>)}{catalog.vehicleCatalogPreferences.selectedMakeIds.length ? <Badge tone="indigo">+ {catalog.vehicleCatalogPreferences.selectedMakeIds.length} ماركة محددة</Badge> : null}</div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.4fr)] gap-4 items-start">
        <Card>
          <CardHeader title="الماركات" subtitle="اختر الماركة لعرض الموديلات" />
          <CardBody className="space-y-3">
            <div className="relative">
              <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم العربي أو الإنجليزي..." className="pe-9" />
            </div>
            <Select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}>
              <option value="">كل دول تخصص المحل</option>
              {availableCountries.map((country) => <option key={country.code} value={country.code}>{country.flag} {country.nameAr}</option>)}
            </Select>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3 gap-2 max-h-[610px] overflow-y-auto pe-1">
              {makes.map((make) => (
                <button
                  key={make.id}
                  type="button"
                  onClick={() => chooseMake(make.id)}
                  className={`rounded-xl border p-3 min-h-28 flex flex-col items-center justify-center gap-2 transition-colors ${selectedMakeId === make.id ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line bg-surface hover:border-brand-300"}`}
                >
                  {make.logoPath ? (
                    <img src={make.logoPath} alt={make.name} loading="lazy" className="w-16 h-12 object-contain" />
                  ) : (
                    <CarFront className="w-10 h-10 text-ink-faint" />
                  )}
                  <span className="text-sm font-semibold text-center line-clamp-2" dir="ltr">{make.name}</span>
                  {make.nameAr ? <span className="text-[11px] text-ink-muted">{make.nameAr}</span> : null}
                  <span className="text-[10px] text-ink-faint">{vehicleCountryLabel(make.countryCode)}</span>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          {!selectedMake ? (
            <CardBody><EmptyState icon={<CarFront className="w-6 h-6" />} title="اختر ماركة" description="ستظهر الموديلات والأجيال والمحركات هنا" /></CardBody>
          ) : (
            <>
              <CardHeader
                title={selectedMake.nameAr ? `${selectedMake.nameAr} — ${selectedMake.name}` : selectedMake.name}
                subtitle={`${makeModels.length} موديل ظاهر`}
                actions={<Button size="sm" onClick={() => setModelDialog(true)}><Plus className="w-4 h-4" />موديل</Button>}
              />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-surface-muted p-3">
                  <div><div className="text-xs text-ink-faint">بلد تصنيف الماركة</div><div className="text-sm font-semibold mt-1">{vehicleCountryLabel(selectedMake.countryCode)}</div></div>
                  <Select className="max-w-56" value={selectedMake.countryCode ?? ""} onChange={(event) => catalog.updateVehicleMake(selectedMake.id, { countryCode: event.target.value || undefined })}>
                    <option value="">غير محدد</option>
                    {VEHICLE_COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.flag} {country.nameAr}</option>)}
                  </Select>
                </div>
                <div className="relative">
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                  <Input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="بحث في موديلات الماركة..." className="pe-9" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
                  <div className="border border-line rounded-xl overflow-hidden max-h-[520px] overflow-y-auto">
                    {makeModels.length === 0 ? (
                      <div className="p-5 text-center text-sm text-ink-faint">لا توجد موديلات بعد</div>
                    ) : makeModels.map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        onClick={() => setSelectedModelId(model.id)}
                        className={`w-full p-3 text-start border-b border-line last:border-b-0 flex items-center justify-between gap-2 ${selectedModelId === model.id ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10" : "hover:bg-surface-muted"}`}
                      >
                        <span className="min-w-0"><span className="block text-sm font-medium truncate" dir="ltr">{model.name}</span>{model.nameAr ? <span className="block text-xs text-ink-muted truncate">{model.nameAr}</span> : null}</span>
                        <ChevronLeft className="w-4 h-4 shrink-0" />
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {!selectedModel ? (
                      <EmptyState icon={<Settings2 className="w-5 h-5" />} title="اختر موديل" description="لعرض الأجيال والمحركات" />
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div><h3 className="font-semibold" dir="ltr">{selectedModel.name}</h3><p className="text-xs text-ink-muted">{selectedModel.vehicleType || "نوع غير محدد"}</p></div>
                          <Button variant="outline" size="sm" onClick={() => setGenerationDialog(true)}><Plus className="w-4 h-4" />جيل</Button>
                        </div>
                        {generations.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-faint">أضف الجيل وسنوات الإنتاج ثم المحركات</div>
                        ) : generations.map((generation) => {
                          const engines = catalog.vehicleEngines.filter((engine) => engine.generationId === generation.id && engine.active);
                          return (
                            <div key={generation.id} className="rounded-xl border border-line p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div><div className="font-medium">{generation.name}</div><div className="text-xs text-ink-muted" dir="ltr">{generation.yearFrom || "?"} — {generation.yearTo || "حتى الآن"}</div></div>
                                <Button variant="ghost" size="sm" onClick={() => setEngineGenerationId(generation.id)}><Gauge className="w-4 h-4" />محرك</Button>
                              </div>
                              {generation.bodyTypes?.length ? <div className="flex gap-1 flex-wrap">{generation.bodyTypes.map((type) => <Badge key={type} tone="slate">{type}</Badge>)}</div> : null}
                              {engines.length ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {engines.map((engine) => <div key={engine.id} className="rounded-lg bg-surface-muted p-2 text-xs"><div className="font-medium">{engine.name} {engine.code ? `(${engine.code})` : ""}</div><div className="text-ink-muted">{engine.capacityCc ? `${engine.capacityCc} cc · ` : ""}{engine.fuelType ? FUEL_LABELS[engine.fuelType] : ""}{engine.powerHp ? ` · ${engine.powerHp} hp` : ""}</div></div>)}
                                </div>
                              ) : <div className="text-xs text-ink-faint">لم تُضف محركات لهذا الجيل</div>}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              </CardBody>
            </>
          )}
        </Card>
      </div>

      <Dialog open={makeDialog} onClose={() => setMakeDialog(false)} title="إضافة ماركة سيارة" width="sm" footer={<><Button variant="outline" onClick={() => setMakeDialog(false)}>إلغاء</Button><Button onClick={submitMake}>إضافة</Button></>}>
        <div className="space-y-3"><Field label="الاسم بالإنجليزية" required><Input value={makeForm.name} onChange={(e) => setMakeForm((form) => ({ ...form, name: e.target.value }))} dir="ltr" /></Field><Field label="الاسم بالعربية"><Input value={makeForm.nameAr} onChange={(e) => setMakeForm((form) => ({ ...form, nameAr: e.target.value }))} /></Field><Field label="بلد تصنيف الماركة"><Select value={makeForm.countryCode} onChange={(e) => setMakeForm((form) => ({ ...form, countryCode: e.target.value }))}><option value="">غير محدد</option>{VEHICLE_COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.flag} {country.nameAr}</option>)}</Select></Field></div>
      </Dialog>

      <Dialog open={modelDialog} onClose={() => setModelDialog(false)} title={`إضافة موديل إلى ${selectedMake?.name ?? "الماركة"}`} width="sm" footer={<><Button variant="outline" onClick={() => setModelDialog(false)}>إلغاء</Button><Button onClick={submitModel}>إضافة</Button></>}>
        <div className="space-y-3"><Field label="اسم الموديل بالإنجليزية" required><Input value={modelForm.name} onChange={(e) => setModelForm((form) => ({ ...form, name: e.target.value }))} dir="ltr" /></Field><Field label="اسم الموديل بالعربية"><Input value={modelForm.nameAr} onChange={(e) => setModelForm((form) => ({ ...form, nameAr: e.target.value }))} /></Field><Field label="نوع المركبة"><Input value={modelForm.vehicleType} onChange={(e) => setModelForm((form) => ({ ...form, vehicleType: e.target.value }))} /></Field></div>
      </Dialog>

      <Dialog open={generationDialog} onClose={() => setGenerationDialog(false)} title={`إضافة جيل إلى ${selectedModel?.name ?? "الموديل"}`} width="sm" footer={<><Button variant="outline" onClick={() => setGenerationDialog(false)}>إلغاء</Button><Button onClick={submitGeneration}>إضافة</Button></>}>
        <div className="grid grid-cols-2 gap-3"><Field label="اسم/كود الجيل" required className="col-span-2"><Input value={generationForm.name} onChange={(e) => setGenerationForm((form) => ({ ...form, name: e.target.value }))} placeholder="مثال: E170 أو الجيل الحادي عشر" /></Field><Field label="من سنة"><Input type="number" min={1900} max={2100} value={generationForm.yearFrom} onChange={(e) => setGenerationForm((form) => ({ ...form, yearFrom: e.target.value }))} /></Field><Field label="إلى سنة"><Input type="number" min={1900} max={2100} value={generationForm.yearTo} onChange={(e) => setGenerationForm((form) => ({ ...form, yearTo: e.target.value }))} /></Field><Field label="أشكال الهيكل" className="col-span-2"><Input value={generationForm.bodyTypes} onChange={(e) => setGenerationForm((form) => ({ ...form, bodyTypes: e.target.value }))} placeholder="Sedan, Hatchback, SUV" /></Field></div>
      </Dialog>

      <Dialog open={Boolean(engineGenerationId)} onClose={() => setEngineGenerationId("")} title="إضافة محرك" width="sm" footer={<><Button variant="outline" onClick={() => setEngineGenerationId("")}>إلغاء</Button><Button onClick={submitEngine}>إضافة</Button></>}>
        <div className="grid grid-cols-2 gap-3"><Field label="اسم المحرك" required><Input value={engineForm.name} onChange={(e) => setEngineForm((form) => ({ ...form, name: e.target.value }))} placeholder="1.6 MPI" /></Field><Field label="كود المحرك"><Input value={engineForm.code} onChange={(e) => setEngineForm((form) => ({ ...form, code: e.target.value }))} dir="ltr" /></Field><Field label="السعة cc"><Input type="number" value={engineForm.capacityCc} onChange={(e) => setEngineForm((form) => ({ ...form, capacityCc: e.target.value }))} /></Field><Field label="الوقود"><Select value={engineForm.fuelType} onChange={(e) => setEngineForm((form) => ({ ...form, fuelType: e.target.value as keyof typeof FUEL_LABELS }))}>{Object.entries(FUEL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field><Field label="القوة hp" className="col-span-2"><Input type="number" value={engineForm.powerHp} onChange={(e) => setEngineForm((form) => ({ ...form, powerHp: e.target.value }))} /></Field></div>
      </Dialog>

      <VehicleSpecializationDialog open={specializationDialog} onClose={() => setSpecializationDialog(false)} />
    </>
  );
}

function CatalogStat({ label, value }: { label: string; value: number }) {
  return <Card><CardBody><div className="text-xs text-ink-muted">{label}</div><div className="mt-1 text-2xl font-bold">{value.toLocaleString("ar-EG")}</div></CardBody></Card>;
}
