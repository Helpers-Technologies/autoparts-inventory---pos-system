import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CarFront, ChevronLeft, Gauge, Link, Pencil, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Input";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { useToast } from "../components/ui/Toast";
import { VehicleSpecializationDialog } from "../features/vehicles/VehicleSpecializationDialog";
import { VEHICLE_COUNTRIES, vehicleCountryLabel } from "../data/vehicleCountries";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { useCatalog } from "../store/CatalogContext";
import type { VehicleMake, VehicleModel, VehicleGeneration, VehicleEngine } from "../types";
import { getMakeSearchText, isFuzzyMatch } from "../lib/fuzzySearch";

function readImageAsResizedDataUrl(file: File, maxSize = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("تعذر قراءة الصورة"));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("تعذر معالجة الصورة"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const FUEL_LABELS = {
  petrol: "بنزين",
  diesel: "ديزل",
  hybrid: "هايبرد",
  electric: "كهرباء",
  other: "أخرى",
} as const;

const VEHICLE_TYPE_OPTIONS = [
  { value: "سيارة ركاب (ملاكي)", label: "سيارة ركاب (ملاكي)" },
  { value: "سيدان (Sedan)", label: "سيدان (Sedan)" },
  { value: "SUV / دفع رباعي", label: "SUV / دفع رباعي" },
  { value: "كروس أوفر (Crossover)", label: "كروس أوفر (Crossover)" },
  { value: "هاتشباك (Hatchback)", label: "هاتشباك (Hatchback)" },
  { value: "كوبيه (Coupe)", label: "كوبيه (Coupe)" },
  { value: "بيك آب / نص نقل", label: "بيك آب / نص نقل (Pick-up)" },
  { value: "فان (Van)", label: "فان (Van)" },
  { value: "شاحنة / نقل ثقيل", label: "شاحنة / نقل ثقيل (Truck)" },
  { value: "حافلة / باص", label: "حافلة / باص (Bus)" },
  { value: "دراجة نارية / موتوسيكل", label: "دراجة نارية / موتوسيكل" },
  { value: "أخرى", label: "أخرى" },
] as const;

const VEHICLE_TYPE_MAP: Record<string, string> = {
  "Passenger Car": "سيارة ركاب (ملاكي)",
  "Commercial Vehicle": "سيارة تجارية / نقل",
  Motorcycle: "دراجة نارية / موتوسيكل",
  Truck: "شاحنة / نقل ثقيل",
  Bus: "حافلة / باص",
};

function formatVehicleType(type?: string): string {
  if (!type) return "نوع غير محدد";
  return VEHICLE_TYPE_MAP[type] || type;
}

function generationYears(yearFrom: number, yearTo?: number): number[] {
  const end = yearTo ?? new Date().getFullYear();
  const years: number[] = [];
  for (let year = yearFrom; year <= end; year += 1) years.push(year);
  return years;
}

export function VehicleCatalogPage() {
  const catalog = useVehicleCatalog();
  const { products } = useCatalog();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [selectedMakeId, setSelectedMakeId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");

  const [makeDialog, setMakeDialog] = useState(false);
  const [modelDialog, setModelDialog] = useState(false);
  const [generationDialog, setGenerationDialog] = useState(false);
  const [engineGenerationId, setEngineGenerationId] = useState("");
  const [specializationDialog, setSpecializationDialog] = useState(false);
  const [showPreferenceBanner, setShowPreferenceBanner] = useState(() => {
    return localStorage.getItem("dismiss_catalog_pref_banner") !== "true";
  });

  // Editing state
  const [editingMake, setEditingMake] = useState<VehicleMake | null>(null);
  const [editingModel, setEditingModel] = useState<VehicleModel | null>(null);
  const [editingGeneration, setEditingGeneration] = useState<VehicleGeneration | null>(null);
  const [editingEngine, setEditingEngine] = useState<VehicleEngine | null>(null);

  // Deleting confirm state
  const [deletingMake, setDeletingMake] = useState<VehicleMake | null>(null);
  const [deletingModel, setDeletingModel] = useState<VehicleModel | null>(null);
  const [deletingGeneration, setDeletingGeneration] = useState<VehicleGeneration | null>(null);
  const [deletingEngine, setDeletingEngine] = useState<VehicleEngine | null>(null);

  // Bulk Fitment Tool state
  const [bulkFitmentOpen, setBulkFitmentOpen] = useState(false);
  const [bulkMakeId, setBulkMakeId] = useState("");
  const [bulkModelId, setBulkModelId] = useState("");
  const [bulkGenerationId, setBulkGenerationId] = useState("");
  const [bulkEngineId, setBulkEngineId] = useState("");
  const [bulkYearFrom, setBulkYearFrom] = useState("");
  const [bulkYearTo, setBulkYearTo] = useState("");
  const [bulkProductQuery, setBulkProductQuery] = useState("");
  const [bulkCategoryFilter, setBulkCategoryFilter] = useState("");
  const [bulkSelectedProductIds, setBulkSelectedProductIds] = useState<Set<string>>(new Set());

  // Arriving from "قطع الغيار" with a pre-selected set of products (its "ربط
  // توافق سيارة" bulk-action button) — open the bulk fitment tool with them
  // already checked, then clear the nav state so a refresh/back doesn't reopen it.
  useEffect(() => {
    const incomingIds = (location.state as { bulkFitmentProductIds?: string[] } | null)?.bulkFitmentProductIds;
    if (incomingIds && incomingIds.length > 0) {
      setBulkSelectedProductIds(new Set(incomingIds));
      setBulkFitmentOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const [makeForm, setMakeForm] = useState({ name: "", nameAr: "", countryCode: "", logoDataUrl: "" });
  const [modelForm, setModelForm] = useState({ name: "", nameAr: "", vehicleType: "سيارة ركاب (ملاكي)" });
  const [generationForm, setGenerationForm] = useState({ name: "", yearFrom: "", yearTo: "", bodyTypes: "" });
  const [engineForm, setEngineForm] = useState({
    name: "",
    code: "",
    capacityCc: "",
    fuelType: "petrol" as keyof typeof FUEL_LABELS,
    powerHp: "",
  });

  const makes = useMemo(() => {
    return catalog.specializedVehicleMakes
      .filter((make) => make.active)
      .filter((make) => isFuzzyMatch(query, [getMakeSearchText(make)]))
      .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999) || a.name.localeCompare(b.name));
  }, [catalog.specializedVehicleMakes, query]);

  const specializedMakeIds = useMemo(
    () => new Set(catalog.specializedVehicleMakes.map((make) => make.id)),
    [catalog.specializedVehicleMakes],
  );
  const specializedModelIds = useMemo(
    () => new Set(catalog.vehicleModels.filter((model) => specializedMakeIds.has(model.makeId)).map((model) => model.id)),
    [catalog.vehicleModels, specializedMakeIds],
  );
  useEffect(() => {
    if (selectedMakeId && !specializedMakeIds.has(selectedMakeId)) {
      setSelectedMakeId("");
      setSelectedModelId("");
    }
  }, [selectedMakeId, specializedMakeIds]);

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
    const name = makeForm.name.trim();
    if (!name) return;
    const dup = catalog.vehicleMakes.some((m) => m.id !== editingMake?.id && m.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      toast.error("اسم الماركة مكرر مسبقاً");
      return;
    }

    if (editingMake) {
      catalog.updateVehicleMake(editingMake.id, {
        name,
        nameAr: makeForm.nameAr.trim() || undefined,
        countryCode: makeForm.countryCode || undefined,
        logoPath: makeForm.logoDataUrl || editingMake.logoPath,
      });
      toast.success("تم تحديث الماركة");
    } else {
      const created = catalog.addVehicleMake({
        name,
        nameAr: makeForm.nameAr.trim() || undefined,
        countryCode: makeForm.countryCode || undefined,
        logoPath: makeForm.logoDataUrl || undefined,
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
      chooseMake(created.id);
      toast.success("تمت إضافة الماركة");
    }
    setMakeForm({ name: "", nameAr: "", countryCode: "", logoDataUrl: "" });
    setEditingMake(null);
    setMakeDialog(false);
  }

  async function handleMakeLogoChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("اختر ملف صورة صالح");
      return;
    }
    try {
      const dataUrl = await readImageAsResizedDataUrl(file);
      setMakeForm((form) => ({ ...form, logoDataUrl: dataUrl }));
    } catch {
      toast.error("تعذر تحميل الصورة", "جرّب صورة أخرى بصيغة JPG أو PNG");
    }
  }

  function submitModel() {
    const name = modelForm.name.trim();
    if (!selectedMakeId || !name) return;
    const dup = catalog.vehicleModels.some((m) => m.makeId === selectedMakeId && m.id !== editingModel?.id && m.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      toast.error("اسم الموديل مكرر مسبقاً لهذه الماركة");
      return;
    }

    if (editingModel) {
      catalog.updateVehicleModel(editingModel.id, {
        name,
        nameAr: modelForm.nameAr.trim() || undefined,
        vehicleType: modelForm.vehicleType.trim() || undefined,
      });
      toast.success("تم تحديث الموديل");
    } else {
      const created = catalog.addVehicleModel({
        makeId: selectedMakeId,
        name,
        nameAr: modelForm.nameAr.trim() || undefined,
        vehicleType: modelForm.vehicleType.trim() || undefined,
        active: true,
      });
      setSelectedModelId(created.id);
      toast.success("تمت إضافة الموديل");
    }
    setModelForm({ name: "", nameAr: "", vehicleType: "سيارة ركاب (ملاكي)" });
    setEditingModel(null);
    setModelDialog(false);
  }

  function submitGeneration() {
    const name = generationForm.name.trim();
    if (!selectedModelId || !name) return;
    const dup = catalog.vehicleGenerations.some((g) => g.modelId === selectedModelId && g.id !== editingGeneration?.id && g.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      toast.error("اسم الجيل مكرر مسبقاً لهذا الموديل");
      return;
    }

    if (editingGeneration) {
      catalog.updateVehicleGeneration(editingGeneration.id, {
        name,
        yearFrom: generationForm.yearFrom ? Number(generationForm.yearFrom) : undefined,
        yearTo: generationForm.yearTo ? Number(generationForm.yearTo) : undefined,
        bodyTypes: generationForm.bodyTypes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      toast.success("تم تحديث الجيل");
    } else {
      catalog.addVehicleGeneration({
        modelId: selectedModelId,
        name,
        yearFrom: generationForm.yearFrom ? Number(generationForm.yearFrom) : undefined,
        yearTo: generationForm.yearTo ? Number(generationForm.yearTo) : undefined,
        bodyTypes: generationForm.bodyTypes
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        active: true,
      });
      toast.success("تمت إضافة الجيل");
    }
    setGenerationForm({ name: "", yearFrom: "", yearTo: "", bodyTypes: "" });
    setEditingGeneration(null);
    setGenerationDialog(false);
  }

  function submitEngine() {
    const name = engineForm.name.trim();
    if (!engineGenerationId || !name) return;
    const dup = catalog.vehicleEngines.some((e) => e.generationId === engineGenerationId && e.id !== editingEngine?.id && e.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) {
      toast.error("اسم المحرك مكرر مسبقاً لهذا الجيل");
      return;
    }

    if (editingEngine) {
      catalog.updateVehicleEngine(editingEngine.id, {
        name,
        code: engineForm.code.trim() || undefined,
        capacityCc: engineForm.capacityCc ? Number(engineForm.capacityCc) : undefined,
        fuelType: engineForm.fuelType,
        powerHp: engineForm.powerHp ? Number(engineForm.powerHp) : undefined,
      });
      toast.success("تم تحديث المحرك");
    } else {
      catalog.addVehicleEngine({
        generationId: engineGenerationId,
        name,
        code: engineForm.code.trim() || undefined,
        capacityCc: engineForm.capacityCc ? Number(engineForm.capacityCc) : undefined,
        fuelType: engineForm.fuelType,
        powerHp: engineForm.powerHp ? Number(engineForm.powerHp) : undefined,
        active: true,
      });
      toast.success("تمت إضافة المحرك");
    }
    setEngineForm({ name: "", code: "", capacityCc: "", fuelType: "petrol", powerHp: "" });
    setEditingEngine(null);
    setEngineGenerationId("");
  }

  function handleBulkFitmentSubmit() {
    if (!bulkMakeId || bulkSelectedProductIds.size === 0) {
      toast.error("بيانات ناقصة", "اختر الماركة وحدد صنفاً واحداً على الأقل.");
      return;
    }
    catalog.addBulkProductFitments(Array.from(bulkSelectedProductIds), {
      makeId: bulkMakeId,
      modelId: bulkModelId || undefined,
      generationId: bulkGenerationId || undefined,
      engineId: bulkEngineId || undefined,
      yearFrom: bulkYearFrom ? Number(bulkYearFrom) : undefined,
      yearTo: bulkYearTo ? Number(bulkYearTo) : undefined,
    });
    toast.success(`تم ربط التوافق لـ ${bulkSelectedProductIds.size} صنف بنجاح`);
    setBulkFitmentOpen(false);
    setBulkSelectedProductIds(new Set());
  }

  const filteredBulkProducts = useMemo(() => {
    const q = bulkProductQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (p.archived) return false;
      if (bulkCategoryFilter && p.category !== bulkCategoryFilter) return false;
      if (!q) return true;
      return `${p.name} ${p.partNumber || ""} ${p.code}`.toLowerCase().includes(q);
    });
  }, [products, bulkProductQuery, bulkCategoryFilter]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort(),
    [products]
  );

  const bulkModels = useMemo(
    () => catalog.vehicleModels.filter((m) => m.makeId === bulkMakeId && m.active),
    [catalog.vehicleModels, bulkMakeId]
  );
  const bulkGenerations = useMemo(
    () => catalog.vehicleGenerations.filter((g) => g.modelId === bulkModelId && g.active),
    [catalog.vehicleGenerations, bulkModelId]
  );
  const bulkEngines = useMemo(
    () => catalog.vehicleEngines.filter((e) => e.generationId === bulkGenerationId && e.active),
    [catalog.vehicleEngines, bulkGenerationId]
  );

  return (
    <>
      <PageHeader
        title="كتالوج السيارات"
        description="الماركات والموديلات والأجيال والمحركات المستخدمة لربط قطع الغيار"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setBulkFitmentOpen(true)} title="ربط مواصفات سيارة بأصناف متعددة">
              <Link className="w-4 h-4 text-indigo-600" />
              أداة التوافق الجماعي
            </Button>
            <Button variant="outline" onClick={() => setSpecializationDialog(true)}>
              <Settings2 className="w-4 h-4" />
              تخصص المحل
            </Button>
            <Button onClick={() => { setEditingMake(null); setMakeForm({ name: "", nameAr: "", countryCode: "", logoDataUrl: "" }); setMakeDialog(true); }}>
              <Plus className="w-4 h-4" />
              إضافة ماركة
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CatalogStat label="ماركات تخصص المحل" value={catalog.specializedVehicleMakes.filter((item) => item.active).length} />
        <CatalogStat label="الموديلات المتاحة" value={catalog.vehicleModels.filter((item) => item.active && specializedMakeIds.has(item.makeId)).length} />
        <CatalogStat label="الأجيال" value={catalog.vehicleGenerations.filter((item) => item.active && specializedModelIds.has(item.modelId)).length} />
        <CatalogStat label="كل ماركات الكتالوج" value={catalog.vehicleMakes.filter((item) => item.active).length} />
      </div>

      {showPreferenceBanner && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/70 dark:bg-brand-500/10 dark:border-brand-500/30 px-4 py-3 flex items-center justify-between gap-3 relative">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              {catalog.vehicleCatalogPreferences.includeAllMakes
                ? "النشاط يعرض كل ماركات السيارات"
                : `النشاط مخصص لـ ${catalog.specializedVehicleMakes.filter((make) => make.active).length} ماركة`}
            </div>
            <div className="text-xs text-ink-muted mt-0.5">
              يُطبق الاختيار على الكتالوج ودليل قطع الغيار وربط المنتجات بالسيارات
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-wrap gap-1.5">
              {catalog.vehicleCatalogPreferences.selectedCountryCodes.map((code: string) => (
                <Badge key={code} tone="blue">
                  {vehicleCountryLabel(code)}
                </Badge>
              ))}
              {catalog.vehicleCatalogPreferences.selectedMakeIds.length ? (
                <Badge tone="indigo">
                  + {catalog.vehicleCatalogPreferences.selectedMakeIds.length} ماركة محددة
                </Badge>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowPreferenceBanner(false);
                localStorage.setItem("dismiss_catalog_pref_banner", "true");
              }}
              className="text-ink-faint hover:text-ink-muted p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors"
              title="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.4fr)] gap-4 items-start">
        <Card>
          <CardHeader title="الماركات" subtitle="اختر الماركة لعرض الموديلات" />
          <CardBody className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث عن ماركة بالعربي أو الإنجليزي..."
                className="ps-9"
                aria-label="البحث في ماركات تخصص المحل"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3 gap-2 max-h-[610px] overflow-y-auto pe-1">
              {makes.map((make) => (
                <div
                  key={make.id}
                  className={`relative group rounded-xl border p-3 min-h-28 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer ${selectedMakeId === make.id ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line bg-surface hover:border-brand-300"}`}
                  onClick={() => chooseMake(make.id)}
                >
                  <div className="absolute top-1.5 end-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-surface/90 rounded-md p-0.5 border border-line">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingMake(make);
                        setMakeForm({
                          name: make.name,
                          nameAr: make.nameAr || "",
                          countryCode: make.countryCode || "",
                          logoDataUrl: make.logoPath || "",
                        });
                        setMakeDialog(true);
                      }}
                      className="p-1 text-ink-muted hover:text-brand-600 rounded"
                      title="تعديل الماركة"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingMake(make);
                      }}
                      className="p-1 text-red-500 hover:text-red-700 rounded"
                      title="حذف الماركة"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {make.logoPath ? (
                    <img src={make.logoPath} alt={make.name} loading="lazy" className="w-16 h-12 object-contain" />
                  ) : (
                    <CarFront className="w-10 h-10 text-ink-faint" />
                  )}
                  <span className="text-sm font-semibold text-center line-clamp-2" dir="ltr">{make.name}</span>
                  {make.nameAr ? <span className="text-[11px] text-ink-muted">{make.nameAr}</span> : null}
                  <span className="text-[10px] text-ink-faint">{vehicleCountryLabel(make.countryCode)}</span>
                </div>
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
                actions={<Button size="sm" onClick={() => { setEditingModel(null); setModelForm({ name: "", nameAr: "", vehicleType: "سيارة ركاب (ملاكي)" }); setModelDialog(true); }}><Plus className="w-4 h-4" />موديل</Button>}
              />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-surface-muted p-3">
                  <div><div className="text-xs text-ink-faint">بلد تصنيف الماركة</div><div className="text-sm font-semibold mt-1">{vehicleCountryLabel(selectedMake.countryCode)}</div></div>
                  <SearchableSelect
                    className="max-w-56"
                    value={selectedMake.countryCode ?? ""}
                    onChange={(val) => catalog.updateVehicleMake(selectedMake.id, { countryCode: val || undefined })}
                    options={VEHICLE_COUNTRIES.map((country) => ({
                      value: country.code,
                      label: `${country.flag} ${country.nameAr}`,
                      searchText: `${country.nameAr} ${country.nameEn} ${country.code}`,
                    }))}
                    placeholder="غير محدد"
                    searchPlaceholder="ابحث عن دولة..."
                  />
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
                      <div
                        key={model.id}
                        onClick={() => setSelectedModelId(model.id)}
                        className={`group p-3 text-start border-b border-line last:border-b-0 flex items-center justify-between gap-2 cursor-pointer ${selectedModelId === model.id ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10" : "hover:bg-surface-muted"}`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate" dir="ltr">{model.name}</span>
                          {model.nameAr ? <span className="block text-xs text-ink-muted truncate">{model.nameAr}</span> : null}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingModel(model);
                              setModelForm({
                                name: model.name,
                                nameAr: model.nameAr || "",
                                vehicleType: model.vehicleType || "سيارة ركاب (ملاكي)",
                              });
                              setModelDialog(true);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-ink-muted hover:text-brand-600 rounded"
                            title="تعديل الموديل"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingModel(model);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-red-500 hover:text-red-700 rounded"
                            title="حذف الموديل"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <ChevronLeft className="w-4 h-4 shrink-0" />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {!selectedModel ? (
                      <EmptyState icon={<Settings2 className="w-5 h-5" />} title="اختر موديل" description="لعرض الأجيال والمحركات" />
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div><h3 className="font-semibold" dir="ltr">{selectedModel.name}</h3><p className="text-xs text-ink-muted">{formatVehicleType(selectedModel.vehicleType)}</p></div>
                          <Button variant="outline" size="sm" onClick={() => { setEditingGeneration(null); setGenerationForm({ name: "", yearFrom: "", yearTo: "", bodyTypes: "" }); setGenerationDialog(true); }}><Plus className="w-4 h-4" />جيل</Button>
                        </div>
                        {generations.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-faint">أضف الجيل وسنوات الإنتاج ثم المحركات</div>
                        ) : generations.map((generation) => {
                          const engines = catalog.vehicleEngines.filter((engine) => engine.generationId === generation.id && engine.active);
                          return (
                            <div key={generation.id} className="rounded-xl border border-line p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-medium flex items-center gap-2">
                                    <span>{generation.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingGeneration(generation);
                                        setGenerationForm({
                                          name: generation.name,
                                          yearFrom: generation.yearFrom ? String(generation.yearFrom) : "",
                                          yearTo: generation.yearTo ? String(generation.yearTo) : "",
                                          bodyTypes: generation.bodyTypes?.join(", ") || "",
                                        });
                                        setGenerationDialog(true);
                                      }}
                                      className="text-ink-faint hover:text-brand-600 p-0.5"
                                      title="تعديل الجيل"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeletingGeneration(generation)}
                                      className="text-ink-faint hover:text-red-600 p-0.5"
                                      title="حذف الجيل"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <div className="text-xs text-ink-muted" dir="ltr">{generation.yearFrom || "?"} — {generation.yearTo || "حتى الآن"}</div>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => { setEditingEngine(null); setEngineForm({ name: "", code: "", capacityCc: "", fuelType: "petrol", powerHp: "" }); setEngineGenerationId(generation.id); }}><Gauge className="w-4 h-4" />محرك</Button>
                              </div>
                              {generation.bodyTypes?.length ? <div className="flex gap-1 flex-wrap">{generation.bodyTypes.map((type: string) => <Badge key={type} tone="slate">{type}</Badge>)}</div> : null}
                              {generation.yearFrom ? (
                                <div>
                                  <div className="text-[11px] text-ink-faint mb-1">السنين — كل سنة موديل منفصلة (فروقات في التصنيع والتعديلات)</div>
                                  <div className="flex gap-1 flex-wrap" dir="ltr">
                                    {generationYears(generation.yearFrom, generation.yearTo).map((year) => (
                                      <Badge key={year} tone="blue">{year}</Badge>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {engines.length ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {engines.map((engine) => (
                                    <div key={engine.id} className="rounded-lg bg-surface-muted p-2 text-xs flex items-center justify-between gap-2">
                                      <div>
                                        <div className="font-medium">{engine.name} {engine.code ? `(${engine.code})` : ""}</div>
                                        <div className="text-ink-muted">{engine.capacityCc ? `${engine.capacityCc} cc · ` : ""}{engine.fuelType ? FUEL_LABELS[engine.fuelType as keyof typeof FUEL_LABELS] : ""}{engine.powerHp ? ` · ${engine.powerHp} hp` : ""}</div>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingEngine(engine);
                                            setEngineForm({
                                              name: engine.name,
                                              code: engine.code || "",
                                              capacityCc: engine.capacityCc ? String(engine.capacityCc) : "",
                                              fuelType: engine.fuelType && engine.fuelType in FUEL_LABELS
                                                ? engine.fuelType as keyof typeof FUEL_LABELS
                                                : "petrol",
                                              powerHp: engine.powerHp ? String(engine.powerHp) : "",
                                            });
                                            setEngineGenerationId(generation.id);
                                          }}
                                          className="text-ink-faint hover:text-brand-600 p-1"
                                          title="تعديل المحرك"
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setDeletingEngine(engine)}
                                          className="text-ink-faint hover:text-red-600 p-1"
                                          title="حذف المحرك"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
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

      {/* ── Dialogs for Adding/Editing Makes, Models, Generations, Engines ── */}
      <Dialog
        open={makeDialog}
        onClose={() => { setMakeDialog(false); setEditingMake(null); setMakeForm({ name: "", nameAr: "", countryCode: "", logoDataUrl: "" }); }}
        title={editingMake ? `تعديل ماركة: ${editingMake.name}` : "إضافة ماركة سيارة"}
        width="sm"
        footer={<><Button variant="outline" onClick={() => { setMakeDialog(false); setEditingMake(null); setMakeForm({ name: "", nameAr: "", countryCode: "", logoDataUrl: "" }); }}>إلغاء</Button><Button onClick={submitMake}>{editingMake ? "حفظ التعديل" : "إضافة"}</Button></>}
      >
        <div className="space-y-3">
          <Field label="الاسم بالإنجليزية" required><Input value={makeForm.name} onChange={(e) => setMakeForm((form) => ({ ...form, name: e.target.value }))} dir="ltr" /></Field>
          <Field label="الاسم بالعربية"><Input value={makeForm.nameAr} onChange={(e) => setMakeForm((form) => ({ ...form, nameAr: e.target.value }))} /></Field>
          <Field label="بلد تصنيف الماركة">
            <SearchableSelect
              value={makeForm.countryCode}
              onChange={(val) => setMakeForm((form) => ({ ...form, countryCode: val }))}
              options={VEHICLE_COUNTRIES.map((country) => ({
                value: country.code,
                label: `${country.flag} ${country.nameAr}`,
                searchText: `${country.nameAr} ${country.code}`,
              }))}
              placeholder="غير محدد"
              searchPlaceholder="ابحث عن دولة..."
              minChars={0}
            />
          </Field>
          <Field label="شعار الماركة (اختياري)">
            <div className="flex items-center gap-3">
              <div className="w-16 h-12 rounded-lg border border-line bg-surface-muted flex items-center justify-center overflow-hidden shrink-0">
                {makeForm.logoDataUrl ? (
                  <img src={makeForm.logoDataUrl} alt="معاينة الشعار" className="w-full h-full object-contain" />
                ) : (
                  <CarFront className="w-6 h-6 text-ink-faint" />
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleMakeLogoChange(e.target.files?.[0] ?? null)}
                className="flex-1 text-xs text-ink-muted file:me-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700 dark:file:bg-brand-500/10 dark:file:text-brand-300 cursor-pointer"
              />
              {makeForm.logoDataUrl ? (
                <button type="button" onClick={() => setMakeForm((form) => ({ ...form, logoDataUrl: "" }))} className="text-ink-faint hover:text-ink shrink-0">
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          </Field>
        </div>
      </Dialog>

      <Dialog open={modelDialog} onClose={() => { setModelDialog(false); setEditingModel(null); }} title={editingModel ? `تعديل موديل: ${editingModel.name}` : `إضافة موديل إلى ${selectedMake?.name ?? "الماركة"}`} width="sm" footer={<><Button variant="outline" onClick={() => { setModelDialog(false); setEditingModel(null); }}>إلغاء</Button><Button onClick={submitModel}>{editingModel ? "حفظ التعديل" : "إضافة"}</Button></>}>
        <div className="space-y-3"><Field label="اسم الموديل بالإنجليزية" required><Input value={modelForm.name} onChange={(e) => setModelForm((form) => ({ ...form, name: e.target.value }))} dir="ltr" /></Field><Field label="اسم الموديل بالعربية"><Input value={modelForm.nameAr} onChange={(e) => setModelForm((form) => ({ ...form, nameAr: e.target.value }))} /></Field><Field label="نوع المركبة"><Select value={modelForm.vehicleType} onChange={(e) => setModelForm((form) => ({ ...form, vehicleType: e.target.value }))}>{VEHICLE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</Select></Field></div>
      </Dialog>

      <Dialog open={generationDialog} onClose={() => { setGenerationDialog(false); setEditingGeneration(null); }} title={editingGeneration ? `تعديل جيل: ${editingGeneration.name}` : `إضافة جيل إلى ${selectedModel?.name ?? "الموديل"}`} width="sm" footer={<><Button variant="outline" onClick={() => { setGenerationDialog(false); setEditingGeneration(null); }}>إلغاء</Button><Button onClick={submitGeneration}>{editingGeneration ? "حفظ التعديل" : "إضافة"}</Button></>}>
        <div className="grid grid-cols-2 gap-3"><Field label="اسم/كود الجيل" required className="col-span-2"><Input value={generationForm.name} onChange={(e) => setGenerationForm((form) => ({ ...form, name: e.target.value }))} placeholder="مثال: E170 أو الجيل الحادي عشر" /></Field><Field label="من سنة"><Input type="number" min={1900} max={2100} value={generationForm.yearFrom} onChange={(e) => setGenerationForm((form) => ({ ...form, yearFrom: e.target.value }))} /></Field><Field label="إلى سنة"><Input type="number" min={1900} max={2100} value={generationForm.yearTo} onChange={(e) => setGenerationForm((form) => ({ ...form, yearTo: e.target.value }))} /></Field><Field label="أشكال الهيكل" className="col-span-2"><Input value={generationForm.bodyTypes} onChange={(e) => setGenerationForm((form) => ({ ...form, bodyTypes: e.target.value }))} placeholder="Sedan, Hatchback, SUV" /></Field></div>
      </Dialog>

      <Dialog open={Boolean(engineGenerationId)} onClose={() => { setEngineGenerationId(""); setEditingEngine(null); }} title={editingEngine ? `تعديل محرك: ${editingEngine.name}` : "إضافة محرك"} width="sm" footer={<><Button variant="outline" onClick={() => { setEngineGenerationId(""); setEditingEngine(null); }}>إلغاء</Button><Button onClick={submitEngine}>{editingEngine ? "حفظ التعديل" : "إضافة"}</Button></>}>
        <div className="grid grid-cols-2 gap-3"><Field label="اسم المحرك" required><Input value={engineForm.name} onChange={(e) => setEngineForm((form) => ({ ...form, name: e.target.value }))} placeholder="1.6 MPI" /></Field><Field label="كود المحرك"><Input value={engineForm.code} onChange={(e) => setEngineForm((form) => ({ ...form, code: e.target.value }))} dir="ltr" /></Field><Field label="السعة cc"><Input type="number" value={engineForm.capacityCc} onChange={(e) => setEngineForm((form) => ({ ...form, capacityCc: e.target.value }))} /></Field><Field label="الوقود"><Select value={engineForm.fuelType} onChange={(e) => setEngineForm((form) => ({ ...form, fuelType: e.target.value as keyof typeof FUEL_LABELS }))}>{Object.entries(FUEL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field><Field label="القوة hp" className="col-span-2"><Input type="number" value={engineForm.powerHp} onChange={(e) => setEngineForm((form) => ({ ...form, powerHp: e.target.value }))} /></Field></div>
      </Dialog>

      {/* ── Bulk Fitment Tool Dialog ── */}
      <Dialog
        open={bulkFitmentOpen}
        onClose={() => setBulkFitmentOpen(false)}
        title="أداة التوافق الجماعي لقطع الغيار"
        subtitle="حدد مواصفات السيارة ثم اختر قطع الغيار المراد ربط التوافق بها دفعة واحدة"
        width="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkFitmentOpen(false)}>إلغاء</Button>
            <Button onClick={handleBulkFitmentSubmit} disabled={!bulkMakeId || bulkSelectedProductIds.size === 0}>
              <Link className="w-4 h-4 ml-1" />
              ربط التوافق لـ ({bulkSelectedProductIds.size}) صنف
            </Button>
          </>
        }
      >
        <div className="space-y-4" dir="rtl">
          <div className="p-3 bg-surface-muted rounded-xl border border-line space-y-3">
            <h4 className="text-xs font-bold text-ink-muted">1. تحديد مواصفات السيارة:</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="الماركة" required>
                <Select value={bulkMakeId} onChange={(e) => { setBulkMakeId(e.target.value); setBulkModelId(""); setBulkGenerationId(""); setBulkEngineId(""); }}>
                  <option value="">اختر الماركة...</option>
                  {catalog.specializedVehicleMakes.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.nameAr || m.name})</option>)}
                </Select>
              </Field>
              <Field label="الموديل (اختياري)">
                <Select value={bulkModelId} onChange={(e) => { setBulkModelId(e.target.value); setBulkGenerationId(""); setBulkEngineId(""); }} disabled={!bulkMakeId}>
                  <option value="">كل الموديلات</option>
                  {bulkModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label="الجيل (اختياري)">
                <Select value={bulkGenerationId} onChange={(e) => { setBulkGenerationId(e.target.value); setBulkEngineId(""); }} disabled={!bulkModelId}>
                  <option value="">كل الأجيال</option>
                  {bulkGenerations.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.yearFrom || "?"}-{g.yearTo || "?"})</option>)}
                </Select>
              </Field>
              <Field label="المحرك (اختياري)">
                <Select value={bulkEngineId} onChange={(e) => setBulkEngineId(e.target.value)} disabled={!bulkGenerationId}>
                  <option value="">كل المحركات</option>
                  {bulkEngines.map((e) => <option key={e.id} value={e.id}>{e.name} {e.code ? `(${e.code})` : ""}</option>)}
                </Select>
              </Field>
              <Field label="من سنة">
                <Input type="number" value={bulkYearFrom} onChange={(e) => setBulkYearFrom(e.target.value)} placeholder="مثال: 2012" />
              </Field>
              <Field label="إلى سنة">
                <Input type="number" value={bulkYearTo} onChange={(e) => setBulkYearTo(e.target.value)} placeholder="مثال: 2018" />
              </Field>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-ink-muted">
                2. اختيار الأصناف المراد ربطها ({bulkSelectedProductIds.size} صنف محدد):
              </h4>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  if (bulkSelectedProductIds.size === filteredBulkProducts.length) {
                    setBulkSelectedProductIds(new Set());
                  } else {
                    setBulkSelectedProductIds(new Set(filteredBulkProducts.map((p) => p.id)));
                  }
                }}
              >
                {bulkSelectedProductIds.size === filteredBulkProducts.length ? "إلغاء تحديد الكل" : "تحديد الكل المفلتر"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={bulkProductQuery}
                onChange={(e) => setBulkProductQuery(e.target.value)}
                placeholder="ابحث بالاسم، رقم القطعة، الكود..."
                className="flex-1"
              />
              <Select value={bulkCategoryFilter} onChange={(e) => setBulkCategoryFilter(e.target.value)} className="w-44">
                <option value="">كل الفئات</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="border border-line rounded-xl max-h-56 overflow-y-auto divide-y divide-line bg-surface">
              {filteredBulkProducts.length === 0 ? (
                <div className="p-4 text-center text-xs text-ink-faint">لا توجد أصناف مطابقة للبحث</div>
              ) : filteredBulkProducts.map((p) => (
                <label key={p.id} className="flex items-center gap-3 p-2.5 hover:bg-surface-muted cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                    checked={bulkSelectedProductIds.has(p.id)}
                    onChange={() => {
                      setBulkSelectedProductIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-ink block truncate">{p.name}</span>
                    <span className="text-ink-faint font-mono text-[11px] block" dir="ltr">{p.partNumber || p.code} · {p.category}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialogs */}
      <ConfirmDialog open={!!deletingMake} onClose={() => setDeletingMake(null)} onConfirm={() => { if (deletingMake) { catalog.deleteVehicleMake(deletingMake.id); if (selectedMakeId === deletingMake.id) chooseMake(""); toast.success("تم حذف الماركة"); setDeletingMake(null); } }} title="حذف ماركة" message={`هل أنت متأكد من حذف الماركة "${deletingMake?.name}"؟`} variant="danger" confirmText="حذف" />
      <ConfirmDialog open={!!deletingModel} onClose={() => setDeletingModel(null)} onConfirm={() => { if (deletingModel) { catalog.deleteVehicleModel(deletingModel.id); if (selectedModelId === deletingModel.id) setSelectedModelId(""); toast.success("تم حذف الموديل"); setDeletingModel(null); } }} title="حذف موديل" message={`هل أنت متأكد من حذف الموديل "${deletingModel?.name}"؟`} variant="danger" confirmText="حذف" />
      <ConfirmDialog open={!!deletingGeneration} onClose={() => setDeletingGeneration(null)} onConfirm={() => { if (deletingGeneration) { catalog.deleteVehicleGeneration(deletingGeneration.id); toast.success("تم حذف الجيل"); setDeletingGeneration(null); } }} title="حذف جيل" message={`هل أنت متأكد من حذف الجيل "${deletingGeneration?.name}"؟`} variant="danger" confirmText="حذف" />
      <ConfirmDialog open={!!deletingEngine} onClose={() => setDeletingEngine(null)} onConfirm={() => { if (deletingEngine) { catalog.deleteVehicleEngine(deletingEngine.id); toast.success("تم حذف المحرك"); setDeletingEngine(null); } }} title="حذف محرك" message={`هل أنت متأكد من حذف المحرك "${deletingEngine?.name}"؟`} variant="danger" confirmText="حذف" />

      <VehicleSpecializationDialog open={specializationDialog} onClose={() => setSpecializationDialog(false)} />
    </>
  );
}

function CatalogStat({ label, value }: { label: string; value: number }) {
  return <Card><CardBody><div className="text-xs text-ink-muted">{label}</div><div className="mt-1 text-2xl font-bold">{value.toLocaleString("ar-EG")}</div></CardBody></Card>;
}
