import { useEffect, useMemo, useState } from "react";
import { CarFront, Check, Plus, Trash2, Wand2, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../../components/ui/Input";
import { YearSelect } from "../../components/ui/YearSelect";
import type { PartAlternativeRelation, Product, ProductAlternative } from "../../types";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";
import { useFeatures } from "../../lib/useFeatures";
import { BarcodeScanInput } from "./BarcodeScanInput";
import { findProductByScan } from "../../lib/partSearch";
import { VEHICLE_COUNTRIES, normalizeVehicleCountryCode } from "../../data/vehicleCountries";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { useVehicleCatalog } from "../../store/VehicleCatalogContext";
import type { ProductFitment } from "../../types";
import { getMakeSearchText } from "../../lib/fuzzySearch";

const UNITS = ["قطعة", "طقم", "زوج", "علبة", "كرتونة", "جركن", "لتر", "متر"];
const AUTO_PART_CATEGORIES = [
  "فلاتر",
  "فرامل",
  "عفشة و تعليق",
  "محرك",
  "ناقل حركة",
  "تبريد وتكييف",
  "كهرباء وإضاءة",
  "سيور وبلي",
  "زيوت وسوائل",
  "بطاريات",
  "شكمان",
  "دركسيون",
  "جسم وهيكل",
  "زجاج ومرايات",
  "كاوتش وجنوط",
  "إكسسوارات",
];

const AUTO_PART_MANUFACTURERS = [
  "Bosch",
  "Denso",
  "NGK",
  "Mann-Filter",
  "Mahle",
  "Brembo",
  "TRW",
  "Sachs",
  "Valeo",
  "Luk",
  "Febi Bilstein",
  "SKF",
  "Monroe",
  "Hankook",
  "Mobis",
  "AISIN",
  "GMB",
  "555",
  "Koyo",
  "NKN",
  "NTN",
  "Lemförder",
  "Gates",
  "Bando",
  "Mando",
  "Sangsin",
  "CTR",
  "Denco",
  "Depo",
  "TYC",
  "Buzooki",
  "Hella",
  "Osram",
];

function generateEAN13(usedBarcodes: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const prefix = "200";
    const body = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
    const partial = prefix + body;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(partial[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    const ean = partial + check;
    if (!usedBarcodes.has(ean)) return ean;
  }
  return "";
}

type FormState = Omit<Product, "id" | "createdAt">;
type FitmentDraft = Omit<ProductFitment, "productId">;
type AlternativeDraft = Omit<ProductAlternative, "productId">;

const ALTERNATIVE_LABELS: Record<PartAlternativeRelation, string> = {
  equivalent: "بديل مكافئ",
  economy: "بديل اقتصادي",
  premium: "بديل أعلى جودة",
  superseded: "رقم بديل/محدّث",
};

const EMPTY: FormState = {
  code: "",
  name: "",
  partNumber: undefined,
  oemNumbers: [],
  partBrand: undefined,
  manufacturer: undefined,
  originCountry: undefined,
  qualityGrade: "aftermarket-premium",
  condition: "new",
  position: undefined,
  rackLocation: undefined,
  warrantyMonths: undefined,
  reorderQuantity: undefined,
  barcode: undefined,
  category: "فلاتر",
  unit: "قطعة",
  retailUnit: undefined,
  purchasePrice: 0,
  wholesalePrice: 0,
  retailPrice: 0,
  piecesPerUnit: undefined,
  quantity: 0,
  looseQuantity: undefined,
  minStock: 5,
  hasExpiry: false,
  expiryDate: undefined,
  supplierId: undefined,
  notes: "",
};

/** Same normalization as the main form's duplicate-part-number check (validate() below). */
function cleanPartNum(value?: string): string {
  return value?.trim().toLowerCase().replace(/[\s./_-]+/g, "") ?? "";
}

export function ProductFormDialog({
  open,
  onClose,
  editing,
  onCreated,
  defaultSupplierId,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Product | null;
  /** Called with the newly created product after a successful add (not on edit). */
  onCreated?: (product: Product) => void;
  /** Pre-selects this supplier when creating a new product. */
  defaultSupplierId?: string;
}) {
  const { addProduct, updateProduct, suppliers, products, nextProductCode } = useCatalog();
  const vehicleCatalog = useVehicleCatalog();
  const toast = useToast();
  const { isEnabled } = useFeatures();
  const barcodeEnabled = isEnabled("barcodeSystem");
  const multiSalePricesEnabled = isEnabled("multiSalePrices");
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const vehicleCatalogEnabled = isEnabled("vehicleCatalog");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fitments, setFitments] = useState<FitmentDraft[]>([]);
  const [fitmentMakeId, setFitmentMakeId] = useState("");
  const [fitmentModelId, setFitmentModelId] = useState("");
  const [fitmentGenerationId, setFitmentGenerationId] = useState("");
  const [fitmentEngineId, setFitmentEngineId] = useState("");
  const [fitmentYearFrom, setFitmentYearFrom] = useState("");
  const [fitmentYearTo, setFitmentYearTo] = useState("");
  const [alternatives, setAlternatives] = useState<AlternativeDraft[]>([]);
  const [alternativeProductId, setAlternativeProductId] = useState("");
  const [alternativeRelation, setAlternativeRelation] = useState<PartAlternativeRelation>("equivalent");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    name: "",
    partNumber: "",
    category: "فلاتر",
    unit: "قطعة",
    originCountry: "",
    wholesalePrice: 0,
    quantity: 0,
    minStock: 5,
  });
  const [quickAddErrors, setQuickAddErrors] = useState<Record<string, string>>({});

  const existingCategories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const allCategories = useMemo(
    () => [...new Set([...AUTO_PART_CATEGORIES, ...existingCategories, ...customCategories])].sort(),
    [existingCategories, customCategories]
  );
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");

  const existingUnits = useMemo(
    () => [...new Set(products.map((p) => p.unit).filter(Boolean))].sort(),
    [products]
  );
  const [customUnits, setCustomUnits] = useState<string[]>([]);
  const allUnits = useMemo(
    () => [...new Set([...UNITS, ...existingUnits, ...customUnits])].sort(),
    [existingUnits, customUnits]
  );
  const [addingUnit, setAddingUnit] = useState(false);
  const [newUnitInput, setNewUnitInput] = useState("");

  const agencyOptions = useMemo(() => {
    const makes = vehicleCatalog.specializedVehicleMakes.filter((m) => m.active);
    const agencyMakes = makes.map((m) => `توكيل ${m.nameAr ? `${m.nameAr} (${m.name})` : m.name}`);
    return ["توكيل السيارة الأصلي", ...agencyMakes];
  }, [vehicleCatalog.specializedVehicleMakes]);

  const existingManufacturers = useMemo(
    () => [...new Set(products.map((p) => p.manufacturer).filter((m): m is string => Boolean(m)))].sort(),
    [products]
  );
  const [customManufacturers, setCustomManufacturers] = useState<string[]>([]);
  const allManufacturers = useMemo(
    () => [...new Set([...agencyOptions, ...AUTO_PART_MANUFACTURERS, ...existingManufacturers, ...customManufacturers])],
    [agencyOptions, existingManufacturers, customManufacturers]
  );
  const [manufacturerDialogOpen, setManufacturerDialogOpen] = useState(false);
  const [manufacturerForm, setManufacturerForm] = useState({
    name: "",
    countryCode: "",
    specialty: "",
    qualityGrade: "",
    notes: "",
  });

  function openAddManufacturerModal(initialName = "") {
    setManufacturerForm({
      name: initialName,
      countryCode: "",
      specialty: "",
      qualityGrade: "",
      notes: "",
    });
    setManufacturerDialogOpen(true);
  }

  function handleSaveManufacturer() {
    const trimmedName = manufacturerForm.name.trim();
    if (!trimmedName) {
      toast.error("اسم الشركة المصنعة مطلوب", "يرجى كتابة اسم الشركة المصنعة أو الماركة.");
      return;
    }
    setCustomManufacturers((prev) => (prev.includes(trimmedName) ? prev : [...prev, trimmedName]));
    set("manufacturer", trimmedName);
    set("partBrand", trimmedName);

    const isAgency = trimmedName.includes("توكيل") || manufacturerForm.qualityGrade === "genuine" || trimmedName.toLowerCase().includes("genuine");
    if (isAgency) {
      set("qualityGrade", "genuine");
      set("originCountry", undefined);
    } else {
      if (manufacturerForm.countryCode && !form.originCountry) {
        set("originCountry", manufacturerForm.countryCode);
      }
      if (manufacturerForm.qualityGrade && form.qualityGrade === "aftermarket-premium") {
        set("qualityGrade", manufacturerForm.qualityGrade as FormState["qualityGrade"]);
      }
    }

    toast.success("تم تسجيل الشركة المصنعة", `تمت إضافة "${trimmedName}" بنجاح.`);
    setManufacturerDialogOpen(false);
  }

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editing) {
      const { id: _id, createdAt: _c, ...rest } = editing;
      void _id;
      void _c;
      setForm(rest);
    } else {
      setForm({ ...EMPTY, code: nextProductCode.toString(), supplierId: defaultSupplierId });
    }
    setFitments(
      editing
        ? vehicleCatalog.productFitments
            .filter((fitment) => fitment.productId === editing.id)
            .map(({ productId: _productId, ...fitment }) => fitment)
        : [],
    );
    setFitmentMakeId("");
    setFitmentModelId("");
    setFitmentGenerationId("");
    setFitmentEngineId("");
    setFitmentYearFrom("");
    setFitmentYearTo("");
    setAlternatives(
      editing
        ? vehicleCatalog.productAlternatives
            .filter((alternative) => alternative.productId === editing.id)
            .map(({ productId: _productId, ...alternative }) => alternative)
        : [],
    );
    setAlternativeProductId("");
    setAlternativeRelation("equivalent");
    setErrors({});
    setAddingCategory(false);
    setNewCategoryInput("");
    setCustomCategories([]);
    setAddingUnit(false);
    setNewUnitInput("");
    setCustomUnits([]);
  }, [editing, open, nextProductCode, defaultSupplierId, vehicleCatalog.productFitments, vehicleCatalog.productAlternatives]);

  const fitmentModels = vehicleCatalog.vehicleModels.filter(
    (model) => model.makeId === fitmentMakeId && model.active,
  );
  const fitmentGenerations = vehicleCatalog.vehicleGenerations.filter(
    (generation) => generation.modelId === fitmentModelId && generation.active,
  );
  const fitmentEngines = vehicleCatalog.vehicleEngines.filter(
    (engine) => engine.generationId === fitmentGenerationId && engine.active,
  );
  const fitmentSelectedGeneration = fitmentGenerations.find((generation) => generation.id === fitmentGenerationId);
  const fitmentYearBounds = fitmentSelectedGeneration?.yearFrom
    ? { startYear: fitmentSelectedGeneration.yearFrom, endYear: fitmentSelectedGeneration.yearTo ?? new Date().getFullYear() }
    : undefined;

  function addFitmentDraft() {
    if (!fitmentMakeId) {
      toast.error("اختر ماركة السيارة أولًا");
      return;
    }
    const duplicate = fitments.some(
      (fitment) =>
        fitment.makeId === fitmentMakeId &&
        fitment.modelId === (fitmentModelId || undefined) &&
        fitment.generationId === (fitmentGenerationId || undefined) &&
        fitment.engineId === (fitmentEngineId || undefined) &&
        fitment.yearFrom === (fitmentYearFrom ? Number(fitmentYearFrom) : undefined) &&
        fitment.yearTo === (fitmentYearTo ? Number(fitmentYearTo) : undefined),
    );
    if (duplicate) {
      toast.info("هذا التوافق مضاف بالفعل");
      return;
    }
    setFitments((items) => [
      ...items,
      {
        id: `draft_fitment_${crypto.randomUUID()}`,
        makeId: fitmentMakeId,
        modelId: fitmentModelId || undefined,
        generationId: fitmentGenerationId || undefined,
        engineId: fitmentEngineId || undefined,
        yearFrom: fitmentYearFrom ? Number(fitmentYearFrom) : undefined,
        yearTo: fitmentYearTo ? Number(fitmentYearTo) : undefined,
        createdAt: new Date().toISOString(),
      },
    ]);
    setFitmentModelId("");
    setFitmentGenerationId("");
    setFitmentEngineId("");
    setFitmentYearFrom("");
    setFitmentYearTo("");
  }

  function addAlternativeDraft() {
    if (!alternativeProductId) {
      toast.error("اختر القطعة البديلة");
      return;
    }
    if (alternatives.some((alternative) => alternative.alternativeProductId === alternativeProductId)) {
      toast.info("هذه القطعة مضافة ضمن البدائل بالفعل");
      return;
    }
    setAlternatives((items) => [
      ...items,
      {
        id: `draft_alternative_${crypto.randomUUID()}`,
        alternativeProductId,
        relation: alternativeRelation,
        createdAt: new Date().toISOString(),
      },
    ]);
    setAlternativeProductId("");
  }

  function handleQuickAddProduct() {
    const name = quickAddForm.name.trim();
    const partNumber = quickAddForm.partNumber.trim();
    const e: Record<string, string> = {};
    if (!name) e.name = "اسم القطعة مطلوب";
    if (!partNumber) {
      e.partNumber = "رقم القطعة مطلوب";
    } else {
      const cleanPn = cleanPartNum(partNumber);
      const duplicate = products.find((p) => p.partNumber && cleanPartNum(p.partNumber) === cleanPn);
      if (duplicate) {
        e.partNumber = `رقم القطعة مكرر مسبقاً (مستخدَم في: ${duplicate.name})`;
      }
    }
    if (!quickAddForm.originCountry) e.originCountry = "بلد المنشأ مطلوب";
    setQuickAddErrors(e);
    if (Object.keys(e).length > 0) return;

    const created = addProduct({
      ...EMPTY,
      code: nextProductCode.toString(),
      name,
      partNumber,
      category: quickAddForm.category,
      unit: quickAddForm.unit,
      originCountry: quickAddForm.originCountry,
      wholesalePrice: quickAddForm.wholesalePrice,
      retailPrice: quickAddForm.wholesalePrice,
      quantity: quickAddForm.quantity,
      minStock: quickAddForm.minStock,
    });
    setAlternativeProductId(created.id);
    setQuickAddForm({ name: "", partNumber: "", category: "فلاتر", unit: "قطعة", originCountry: "", wholesalePrice: 0, quantity: 0, minStock: 5 });
    setQuickAddErrors({});
    setQuickAddOpen(false);
    toast.success("تم إضافة القطعة", "اضغط «إضافة» لربطها كبديل، وتقدر تكمّل باقي بياناتها لاحقًا من صفحة قطع الغيار.");
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.code.trim()) e.code = "الكود مطلوب";
    if (!form.name.trim()) e.name = "اسم المنتج مطلوب";
    if (!form.partNumber?.trim()) e.partNumber = "رقم القطعة مطلوب";
    if (form.qualityGrade !== "genuine" && !form.originCountry?.trim()) e.originCountry = "بلد المنشأ مطلوب";
    if (!form.category.trim()) e.category = "الفئة مطلوبة";
    if (form.purchasePrice < 0) e.purchasePrice = "يجب أن يكون موجباً";
    if (form.wholesalePrice < 0) e.wholesalePrice = "يجب أن يكون موجباً";
    if (form.retailPrice < 0) e.retailPrice = "يجب أن يكون موجباً";
    if (multiSalePricesEnabled && !form.piecesPerUnit && form.retailPrice < form.wholesalePrice) {
      e.retailPrice = "سعر التجزئة يجب أن يكون أكبر من أو يساوي سعر الجملة";
    }
    if (multiSalePricesEnabled && form.piecesPerUnit && !form.retailUnit?.trim()) {
      e.retailUnit = "اسم وحدة التجزئة مطلوب";
    }
    if (form.quantity < 0) e.quantity = "يجب أن يكون موجباً";
    if (form.minStock < 0) e.minStock = "يجب أن يكون موجباً";
    if (expiryTrackingEnabled && form.hasExpiry && !form.expiryDate) e.expiryDate = "تاريخ الصلاحية مطلوب";
    const otherProducts = products.filter((product) => product.id !== editing?.id);
    const normalized = (value?: string) => value?.trim().toLowerCase().replace(/[\s./_-]+/g, "") ?? "";
    if (form.barcode && otherProducts.some((product) => normalized(product.barcode) === normalized(form.barcode))) {
      e.barcode = "هذا الباركود مستخدم لمنتج آخر";
    }
    if (form.partNumber && otherProducts.some((product) => normalized(product.partNumber) === normalized(form.partNumber))) {
      e.partNumber = "رقم القطعة مستخدم لمنتج آخر";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function confirmNewCategory() {
    const trimmed = newCategoryInput.trim();
    if (trimmed) {
      if (!allCategories.includes(trimmed)) {
        setCustomCategories((prev) => [...prev, trimmed]);
      }
      set("category", trimmed);
    }
    setAddingCategory(false);
    setNewCategoryInput("");
  }

  function confirmNewUnit() {
    const trimmed = newUnitInput.trim();
    if (trimmed) {
      if (!allUnits.includes(trimmed)) {
        setCustomUnits((prev) => [...prev, trimmed]);
      }
      set("unit", trimmed);
    }
    setAddingUnit(false);
    setNewUnitInput("");
  }

  function handleSubmit() {
    if (!validate()) return;

    // تطبيع كمية القطع المفردة: لو وصلت/تعدّت محتوى الكرتونة، الزيادة تتحوّل
    // كراتين كاملة — نفس سلوك applyPieceAddition في باقي النظام، عشان ميتخزّنش
    // looseQuantity أكبر من عدد القطع في الوحدة.
    let payload = form;
    if (!barcodeEnabled) payload = { ...payload, barcode: undefined };
    if (!multiSalePricesEnabled) {
      // Don't touch retailPrice here — it's hidden, not deleted. Overwriting it
      // with wholesalePrice would silently destroy a distinct retail price the
      // shop set while the feature was on, with no way to recover it if the
      // feature is re-enabled later.
      //
      // Same logic applies to piecesPerUnit / retailUnit / looseQuantity:
      // they represent real inventory data (how many pieces per carton, the
      // retail unit name, and the loose count already in stock). Wiping them
      // on every save while the feature is off means the shop permanently
      // loses that information the moment they save *any* product — even if
      // the edit was completely unrelated (e.g. changing a price). If the
      // feature is later re-enabled, the data is gone.
    }
    if (!expiryTrackingEnabled) {
      payload = { ...payload, hasExpiry: false, expiryDate: undefined };
    }
    const ppu = form.piecesPerUnit;
    if (multiSalePricesEnabled && ppu && (payload.looseQuantity ?? 0) >= ppu) {
      const loose = payload.looseQuantity ?? 0;
      const extraCartons = Math.floor(loose / ppu);
      const newLoose = loose % ppu;
      const pieceName = payload.retailUnit || "قطعة";
      payload = { ...payload, quantity: payload.quantity + extraCartons, looseQuantity: newLoose };
      setForm(payload);
      toast.info(
        "تم تطبيع كمية القطع",
        `${loose} ${pieceName} = ${extraCartons} ${form.unit} + ${newLoose} ${pieceName}`,
      );
    }

    let savedProduct: Product;
    if (editing) {
      updateProduct(editing.id, payload);
      savedProduct = { ...editing, ...payload };
      toast.success("تم تحديث المنتج");
    } else {
      const created = addProduct(payload);
      savedProduct = created;
      toast.success("تم إضافة المنتج");
      onCreated?.(created);
    }
    vehicleCatalog.productFitments
      .filter((fitment) => fitment.productId === savedProduct.id)
      .forEach((fitment) => vehicleCatalog.deleteProductFitment(fitment.id));
    fitments.forEach((fitment) =>
      vehicleCatalog.addProductFitment({
        productId: savedProduct.id,
        makeId: fitment.makeId,
        modelId: fitment.modelId,
        generationId: fitment.generationId,
        engineId: fitment.engineId,
        yearFrom: fitment.yearFrom,
        yearTo: fitment.yearTo,
        notes: fitment.notes,
      }),
    );
    vehicleCatalog.productAlternatives
      .filter((alternative) => alternative.productId === savedProduct.id)
      .forEach((alternative) => vehicleCatalog.deleteProductAlternative(alternative.id));
    alternatives.forEach((alternative) =>
      vehicleCatalog.addProductAlternative({
        productId: savedProduct.id,
        alternativeProductId: alternative.alternativeProductId,
        relation: alternative.relation,
        notes: alternative.notes,
      }),
    );
    onClose();
  }

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "تعديل منتج" : "إضافة منتج جديد"}
      subtitle="أدخل أرقام القطعة والتوافق ومكان التخزين بدقة لتسريع البيع والاسكان"
      width="2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit}>
            {editing ? "حفظ التعديلات" : "إضافة المنتج"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2.5">

        {barcodeEnabled ? (
          <div className="col-span-1 sm:col-span-2 md:col-span-4 rounded-xl border border-brand-200 bg-brand-50/60 dark:bg-brand-500/10 p-2.5">
            <div className="text-xs font-semibold text-brand-800 dark:text-brand-200 mb-1.5">اسكان إضافة المنتج</div>
            <BarcodeScanInput
              onScan={(code) => {
                const existing = findProductByScan(products.filter((product) => product.id !== editing?.id), code);
                if (existing) {
                  toast.error("الكود مسجل بالفعل", `${existing.product.name} — ${existing.product.partNumber || existing.product.code}`);
                  return;
                }
                set("barcode", code);
                toast.success("تم التقاط الباركود", "أكمل بيانات القطعة ثم احفظ");
              }}
              placeholder="امسح باركود عبوة القطعة لتعبئته تلقائيًا"
            />
          </div>
        ) : null}

        {/* كود المنتج + اسم المنتج */}
        <Field label="كود المنتج" required error={errors.code} className="col-span-1">
          <Input
            value={form.code}
            readOnly
            className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70 font-mono"
          />
        </Field>
        <Field label="اسم المنتج" required error={errors.name} className="col-span-1 sm:col-span-2 md:col-span-3">
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="مثل: فلتر زيت تويوتا كورولا — MANN"
          />
        </Field>

        <Field
          label="رقم القطعة (Part Number)"
          hint="رقم القطعة (Part Number) هو الكود أو الرقم الذي تضعه الشركة المصنعة للقطعة (مثل W 68/3 لشركة MANN أو 0242236571 لشركة Bosch) للتمييز الفني للقطعة وسهولة طلبها."
          required
          error={errors.partNumber}
          className="col-span-1 sm:col-span-2"
        >
          <Input
            value={form.partNumber ?? ""}
            onChange={(e) => set("partNumber", e.target.value || undefined)}
            placeholder="مثل: W 68/3"
            className="font-mono"
            dir="ltr"
          />
        </Field>
        <Field label="الشركة المصنّعة / الماركة" className="col-span-1 sm:col-span-2">
          <div className="flex gap-2">
            <SearchableSelect
              value={form.manufacturer ?? form.partBrand ?? ""}
              onChange={(val) => {
                const brandVal = val || undefined;
                set("manufacturer", brandVal);
                set("partBrand", brandVal);

                if (val) {
                  const isAgency = val.includes("توكيل") || val.toLowerCase().includes("genuine");
                  if (isAgency) {
                    set("qualityGrade", "genuine");
                    set("originCountry", undefined);

                    const matchedMake = vehicleCatalog.specializedVehicleMakes.find(
                      (make) => val.includes(make.name) || (make.nameAr && val.includes(make.nameAr))
                    );
                    if (matchedMake && !fitmentMakeId) {
                      setFitmentMakeId(matchedMake.id);
                    }
                  }
                }
              }}
              options={allManufacturers.map((m) => ({
                value: m,
                label: m,
                searchText: m,
              }))}
              placeholder="اختر أو ابحث عن الشركة..."
              searchPlaceholder="ابحث عن اسم الشركة المصنعة أو التوكيل..."
              minChars={0}
              onCreate={(newBrand) => openAddManufacturerModal(newBrand)}
              createLabel="إضافة شركة مصنعة جديدة:"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => openAddManufacturerModal("")}
              title="إضافة شركة مصنعة جديدة"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </Field>

        <Field
          label="أرقام OEM"
          hint="أرقام OEM (Original Equipment Manufacturer) هي أرقام القطعة الأصلية المعتمدة من شركة السيارة الأم (مثل Toyota أو Hyundai). تُستخدم لتسهيل المطابقة والدعم عند البحث برقم شاسيه السيارة أو البدائل التجاريّة."
          error={errors.oemNumbers}
          className="col-span-1 sm:col-span-2 md:col-span-4"
        >
          <Textarea
            rows={1}
            value={(form.oemNumbers ?? []).join(", ")}
            onChange={(e) => set("oemNumbers", e.target.value.split(/[,\n؛]+/).map((value) => value.trim()).filter(Boolean))}
            placeholder="أدخل أكثر من رقم مفصول بفاصلة — مثال: 90915-YZZJ1, 90915-10003"
            className="font-mono"
            dir="ltr"
          />
        </Field>

        {barcodeEnabled ? (
          <Field label="الباركود" error={errors.barcode} className="col-span-1 sm:col-span-2 md:col-span-4">
            <div className="flex gap-2">
              <Input
                value={form.barcode ?? ""}
                onChange={(e) => set("barcode", e.target.value || undefined)}
                placeholder="امسح باركود العبوة أو اكتبه — البحث يقبل أيضًا Part Number وOEM"
                className="font-mono flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="توليد باركود EAN-13 تلقائي"
                onClick={() => {
                  const used = new Set(products.filter(p => p.barcode).map(p => p.barcode!));
                  const ean = generateEAN13(used);
                  if (ean) set("barcode", ean);
                }}
              >
                <Wand2 className="w-4 h-4" />
                توليد
              </Button>
            </div>
          </Field>
        ) : null}

        <Field label="درجة الجودة" hint={`• أصلي توكيل:\nغلاف وعلبة ماركة السيارة الرسمية (مثل تويوتا أو هيونداي).\n\n• OEM:\nالمصنّع الأصلي للقطعة في علبته التجارية الخاصة (مثل Bosch أو Denso).\n\n• بديل ممتاز:\nقطع غيار تجارية معتمدة عالية الجودة.\n\n• بديل اقتصادي:\nقطع غيار تجارية موفرة للسعر.`} className="col-span-1">
          <Select
            value={form.qualityGrade ?? "aftermarket-premium"}
            onChange={(e) => {
              const val = e.target.value as FormState["qualityGrade"];
              set("qualityGrade", val);
              if (val === "genuine") {
                set("originCountry", undefined);
              }
            }}
          >
            <option value="genuine">أصلي توكيل</option>
            <option value="oem">OEM أصلي مصنع</option>
            <option value="aftermarket-premium">بديل ممتاز</option>
            <option value="aftermarket-economy">بديل اقتصادي</option>
          </Select>
        </Field>
        <Field label="بلد المنشأ" required={form.qualityGrade !== "genuine"} error={errors.originCountry} className="col-span-1">
          <SearchableSelect
            value={normalizeVehicleCountryCode(form.originCountry) ?? form.originCountry ?? ""}
            onChange={(val) => set("originCountry", val || undefined)}
            options={VEHICLE_COUNTRIES.map((c) => ({
              value: c.code,
              label: `${c.flag}  ${c.nameAr} (${c.code})`,
              searchText: `${c.nameAr} ${c.nameEn} ${c.code}`,
            }))}
            placeholder={form.qualityGrade === "genuine" ? "تتبع التوكيل" : "اختر البلد..."}
            searchPlaceholder="ابحث عن دولة..."
            minChars={0}
            disabled={form.qualityGrade === "genuine"}
          />
        </Field>
        <Field label="حالة القطعة" className="col-span-1">
          <Select value={form.condition ?? "new"} onChange={(e) => set("condition", e.target.value as FormState["condition"])}>
            <option value="new">جديدة</option>
            <option value="used">استيراد / مستعملة</option>
            <option value="remanufactured">مجددة</option>
          </Select>
        </Field>
        <Field label="الضمان" className="col-span-1">
          <Select
            value={form.warrantyMonths === undefined || form.warrantyMonths === 0 ? "0" : String(form.warrantyMonths)}
            onChange={(e) => set("warrantyMonths", e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="0">بدون ضمان</option>
            <option value="1">شهر واحد</option>
            <option value="3">3 شهور</option>
            <option value="6">6 شهور</option>
            <option value="12">سنة واحدة (12 شهر)</option>
            <option value="18">سنة ونصف (18 شهر)</option>
            <option value="24">سنتين (24 شهر)</option>
            <option value="36">3 سنوات</option>
            <option value="60">5 سنوات</option>
          </Select>
        </Field>

        {/* الفئة + الوحدة */}
        <Field label="الفئة" required error={errors.category} className="col-span-1 sm:col-span-2 md:col-span-2">
          <div className="flex gap-2">
            <Select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              className="flex-1"
            >
              <option value="">— اختر فئة —</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {form.category && !allCategories.includes(form.category) && (
                <option value={form.category}>{form.category}</option>
              )}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => { setAddingCategory(true); setNewCategoryInput(""); }}
              title="إضافة فئة جديدة"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {addingCategory && (
            <div className="flex gap-1.5 mt-1.5">
              <Input
                autoFocus
                value={newCategoryInput}
                onChange={(e) => setNewCategoryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); confirmNewCategory(); }
                  if (e.key === "Escape") setAddingCategory(false);
                }}
                placeholder="اسم الفئة الجديدة"
                className="flex-1"
              />
              <Button type="button" size="icon" variant="outline" onClick={confirmNewCategory}>
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
              </Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => setAddingCategory(false)}>
                <X className="w-4 h-4 text-red-500" />
              </Button>
            </div>
          )}
        </Field>
        <Field label="الوحدة" className="col-span-1 sm:col-span-2 md:col-span-2">
          <div className="flex gap-2">
            <Select
              value={form.unit}
              onChange={(e) => set("unit", e.target.value)}
              className="flex-1"
            >
              <option value="">— اختر وحدة —</option>
              {allUnits.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
              {form.unit && !allUnits.includes(form.unit) && (
                <option value={form.unit}>{form.unit}</option>
              )}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => { setAddingUnit(true); setNewUnitInput(""); }}
              title="إضافة وحدة جديدة"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {addingUnit && (
            <div className="flex gap-1.5 mt-1.5">
              <Input
                autoFocus
                value={newUnitInput}
                onChange={(e) => setNewUnitInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); confirmNewUnit(); }
                  if (e.key === "Escape") setAddingUnit(false);
                }}
                placeholder="اسم الوحدة الجديدة"
                className="flex-1"
              />
              <Button type="button" size="icon" variant="outline" onClick={confirmNewUnit}>
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
              </Button>
              <Button type="button" size="icon" variant="ghost" onClick={() => setAddingUnit(false)}>
                <X className="w-4 h-4 text-red-500" />
              </Button>
            </div>
          )}
        </Field>

        {/* سعر الشراء + سعر الجملة */}
        <Field label="سعر الشراء" required error={errors.purchasePrice} className="col-span-1">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.purchasePrice}
            onChange={(e) => set("purchasePrice", Number(e.target.value))}
          />
        </Field>
        <Field label={multiSalePricesEnabled ? "سعر الجملة" : "سعر البيع"} required error={errors.wholesalePrice} className="col-span-1">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.wholesalePrice}
            onChange={(e) => set("wholesalePrice", Number(e.target.value))}
          />
        </Field>

        {multiSalePricesEnabled ? (
          <>
            <Field
              label={form.piecesPerUnit ? `سعر ${form.retailUnit || "القطعة"}` : "سعر التجزئة للوحدة"}
              required
              error={errors.retailPrice}
              className="col-span-1"
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.retailPrice}
                onChange={(e) => set("retailPrice", Number(e.target.value))}
              />
            </Field>
            <Field label="عدد القطع في الوحدة" className="col-span-1">
              <Input
                type="number"
                min={1}
                value={form.piecesPerUnit ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : undefined;
                  set("piecesPerUnit", val);
                  if (!val) {
                    set("retailUnit", undefined);
                    set("looseQuantity", undefined);
                  }
                }}
                placeholder={`مثل: 24 قطعة في ${form.unit}`}
              />
            </Field>
          </>
        ) : null}

        {/* حقول التجزئة - تظهر فقط لما يكون فيه عدد قطع */}
        {multiSalePricesEnabled && form.piecesPerUnit ? (
          <>
            <Field label="اسم وحدة التجزئة" required error={errors.retailUnit} className="col-span-1">
              <Input
                value={form.retailUnit ?? ""}
                onChange={(e) => set("retailUnit", e.target.value || undefined)}
                placeholder="مثل: قطعة، كيس، علبة صغيرة"
              />
            </Field>
            <Field label={`كمية القطع المفردة (${form.retailUnit || "قطعة"})`} className="col-span-1">
              <Input
                type="number"
                min={0}
                max={form.piecesPerUnit - 1}
                value={form.looseQuantity ?? 0}
                onChange={(e) => set("looseQuantity", Number(e.target.value) || undefined)}
                placeholder="0"
              />
            </Field>
          </>
        ) : null}

        {/* الكمية الحالية + الحد الأدنى + موقع الرف + كمية إعادة الطلب */}
        <Field label={`الكمية الحالية (${form.unit})`} required error={errors.quantity} className="col-span-1">
          <Input
            type="number"
            min={0}
            value={form.quantity}
            onChange={(e) => set("quantity", Number(e.target.value))}
          />
        </Field>
        <Field label="الحد الأدنى للمخزون" required error={errors.minStock} className="col-span-1">
          <Input
            type="number"
            min={0}
            value={form.minStock}
            onChange={(e) => set("minStock", Number(e.target.value))}
          />
        </Field>
        <Field label="موقع الرف / البِن" className="col-span-1">
          <Input value={form.rackLocation ?? ""} onChange={(e) => set("rackLocation", e.target.value || undefined)} placeholder="مثال: A-03-02" className="font-mono" dir="ltr" />
        </Field>
        <Field label="كمية إعادة الطلب" className="col-span-1">
          <Input type="number" min={0} value={form.reorderQuantity ?? ""} onChange={(e) => set("reorderQuantity", e.target.value ? Number(e.target.value) : undefined)} />
        </Field>

        {/* المورد + تاريخ الصلاحية */}
        <Field label="المورد" className="col-span-1 sm:col-span-2">
          <Select
            value={form.supplierId ?? ""}
            onChange={(e) => set("supplierId", e.target.value ? e.target.value : undefined)}
          >
            <option value="">— غير محدد —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        {expiryTrackingEnabled ? (
          <Field
            label="له تاريخ صلاحية؟"
            required={form.hasExpiry}
            error={form.hasExpiry ? errors.expiryDate : undefined}
            className="col-span-1 sm:col-span-2"
          >
            <div className="flex items-center gap-3 min-h-[36px]">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none whitespace-nowrap">
                <input
                  type="radio"
                  name="hasExp"
                  checked={form.hasExpiry}
                  onChange={() => set("hasExpiry", true)}
                  className="w-4 h-4 border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                />
                نعم
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none whitespace-nowrap">
                <input
                  type="radio"
                  name="hasExp"
                  checked={!form.hasExpiry}
                  onChange={() => {
                    set("hasExpiry", false);
                    set("expiryDate", undefined);
                  }}
                  className="w-4 h-4 border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                />
                لا
              </label>
              {form.hasExpiry && (
                <Input
                  type="date"
                  value={form.expiryDate ?? ""}
                  onChange={(e) => set("expiryDate", e.target.value || undefined)}
                  className="flex-1 min-w-[140px]"
                />
              )}
            </div>
          </Field>
        ) : null}

        <div className="col-span-1 sm:col-span-2 md:col-span-4 rounded-xl border border-line p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div><div className="flex items-center gap-2 font-semibold"><CarFront className="w-4 h-4" />توافق القطعة مع السيارات</div><div className="text-xs text-ink-muted mt-0.5">يمكن ربط القطعة بأكثر من سيارة أو جيل أو محرك</div></div>
            <span className="text-xs text-ink-faint">{fitments.length} توافق</span>
          </div>
          {!vehicleCatalogEnabled ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
              <div className="font-bold">ميزة كتالوج توافق السيارات معطلة</div>
              <div className="mt-0.5">يرجى تفعيل ترخيص الميزة لتتمكن من ربط القطعة بالسيارات المتوافقة.</div>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Field label="الماركة" className="md:col-span-2">
              <SearchableSelect
                value={fitmentMakeId}
                onChange={(value) => {
                  setFitmentMakeId(value);
                  setFitmentModelId("");
                  setFitmentGenerationId("");
                  setFitmentEngineId("");
                }}
                options={vehicleCatalog.specializedVehicleMakes.filter((make) => make.active).map((make) => ({
                  value: make.id,
                  label: make.nameAr ? `${make.nameAr} — ${make.name}` : make.name,
                  image: `/vehicle-logos/${make.slug}.png`,
                  searchText: getMakeSearchText(make),
                }))}
                placeholder="اختر الماركة"
                minChars={1}
              />
            </Field>
            <Field label="الموديل" className="md:col-span-2">
              <SearchableSelect
                value={fitmentModelId}
                onChange={(value) => { setFitmentModelId(value); setFitmentGenerationId(""); setFitmentEngineId(""); }}
                options={fitmentModels.map((model) => ({
                  value: model.id,
                  label: model.nameAr ? `${model.nameAr} — ${model.name}` : model.name
                }))}
                placeholder="كل موديلات الماركة"
                disabled={!fitmentMakeId}
                minChars={1}
              />
            </Field>
            <Field label="الجيل">
              <Select
                value={fitmentGenerationId}
                onChange={(e) => {
                  setFitmentGenerationId(e.target.value);
                  setFitmentEngineId("");
                  setFitmentYearFrom("");
                  setFitmentYearTo("");
                }}
                disabled={!fitmentModelId}
              >
                <option value="">كل الأجيال</option>
                {fitmentGenerations.map((generation) => <option key={generation.id} value={generation.id}>{generation.name}</option>)}
              </Select>
            </Field>
            <Field label="المحرك"><Select value={fitmentEngineId} onChange={(e) => setFitmentEngineId(e.target.value)} disabled={!fitmentGenerationId}><option value="">كل المحركات</option>{fitmentEngines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}{engine.code ? ` — ${engine.code}` : ""}</option>)}</Select></Field>
            <Field label="من سنة" hint={fitmentSelectedGeneration ? `مقفولة على سنين هذا الجيل (${fitmentSelectedGeneration.yearFrom ?? "?"}–${fitmentSelectedGeneration.yearTo ?? "الآن"}) — اختر نفس السنة في «من» و«إلى» لتخصيص القطعة بسنة موديل واحدة فقط.` : undefined}>
              <YearSelect
                value={fitmentYearFrom}
                onChange={(val) => setFitmentYearFrom(val)}
                placeholder="من سنة"
                startYear={fitmentYearBounds?.startYear}
                endYear={fitmentYearBounds?.endYear}
              />
            </Field>
            <Field label="إلى سنة">
              <YearSelect
                value={fitmentYearTo}
                onChange={(val) => setFitmentYearTo(val)}
                placeholder="إلى سنة"
                startYear={fitmentYearBounds?.startYear}
                endYear={fitmentYearBounds?.endYear}
              />
            </Field>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addFitmentDraft}><Plus className="w-4 h-4" />إضافة التوافق</Button>
          {fitments.length ? (
            <div className="space-y-2">
              {fitments.map((fitment) => {
                const make = vehicleCatalog.vehicleMakes.find((item) => item.id === fitment.makeId);
                const model = vehicleCatalog.vehicleModels.find((item) => item.id === fitment.modelId);
                const generation = vehicleCatalog.vehicleGenerations.find((item) => item.id === fitment.generationId);
                const engine = vehicleCatalog.vehicleEngines.find((item) => item.id === fitment.engineId);
                return (
                  <div key={fitment.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted p-2.5 text-sm">
                    <div className="min-w-0"><span className="font-medium" dir="ltr">{make?.name ?? "ماركة"}{model ? ` / ${model.name}` : " / كل الموديلات"}{generation ? ` / ${generation.name}` : ""}{engine ? ` / ${engine.code || engine.name}` : ""}</span><span className="text-xs text-ink-muted ms-2" dir="ltr">{fitment.yearFrom || "?"} — {fitment.yearTo || "الآن"}</span></div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setFitments((items) => items.filter((item) => item.id !== fitment.id))}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </div>
                );
              })}
            </div>
          ) : <div className="text-xs text-ink-faint">لم يتم ربط القطعة بسيارة بعد؛ ستظل قابلة للبحث برقم القطعة وOEM.</div>}
          </>
          )}
        </div>

        <div className="col-span-1 sm:col-span-2 md:col-span-4 rounded-xl border border-line p-3 space-y-2.5">
          <div><div className="font-semibold">البدائل والأرقام المحدّثة</div><div className="text-xs text-ink-muted mt-0.5">اربط القطعة ببديل مكافئ أو اقتصادي أو أعلى جودة ليظهر للبائع فورًا</div></div>
          {!isEnabled("partAlternatives") ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
              <div className="font-bold">ميزة البدائل وCross Reference معطلة</div>
              <div className="mt-0.5">يرجى تفعيل ترخيص الميزة لتتمكن من ربط وإدارة البدائل لقطع الغيار.</div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_190px_auto] gap-2 items-end">
                <Field label="القطعة البديلة">
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <SearchableSelect
                        value={alternativeProductId}
                        onChange={setAlternativeProductId}
                        options={products.filter((product) => !product.archived && product.id !== editing?.id).map((product) => ({ value: product.id, label: `${product.partNumber || product.code} — ${product.name}`, searchText: `${product.name} ${product.partNumber ?? ""} ${product.oemNumbers?.join(" ") ?? ""} ${product.partBrand ?? ""}` }))}
                        placeholder="اختر قطعة من المخزون"
                        minChars={1}
                      />
                    </div>
                    <Button type="button" variant="outline" size="icon" title="إضافة قطعة بديلة جديدة" onClick={() => setQuickAddOpen(true)}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </Field>
                <Field label="نوع البديل"><Select value={alternativeRelation} onChange={(e) => setAlternativeRelation(e.target.value as PartAlternativeRelation)}>{Object.entries(ALTERNATIVE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
                <Button type="button" variant="outline" onClick={addAlternativeDraft}><Plus className="w-4 h-4" />إضافة</Button>
              </div>
              {alternatives.length ? <div className="space-y-2">{alternatives.map((alternative) => { const target = products.find((product) => product.id === alternative.alternativeProductId); return <div key={alternative.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted p-2.5 text-sm"><div><span className="font-mono" dir="ltr">{target?.partNumber || target?.code || "قطعة"}</span><span className="text-ink-muted ms-2">{target?.name}</span><span className="text-xs text-brand-700 ms-2">{ALTERNATIVE_LABELS[alternative.relation]}</span></div><Button type="button" variant="ghost" size="icon" onClick={() => setAlternatives((items) => items.filter((item) => item.id !== alternative.id))}><Trash2 className="w-4 h-4 text-red-500" /></Button></div>; })}</div> : <div className="text-xs text-ink-faint">لا توجد بدائل مرتبطة.</div>}
            </>
          )}
        </div>

        {/* ملاحظات - اختياري */}
        <Field label="ملاحظات" className="col-span-1 sm:col-span-2 md:col-span-4">
          <Textarea
            rows={2}
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>

      </div>

      <Dialog
        open={manufacturerDialogOpen}
        onClose={() => setManufacturerDialogOpen(false)}
        title="تسجيل شركة مصنعة جديدة"
        subtitle="إضافة ماركة أو شركة مصنعة جديدة لقطع الغيار"
        width="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setManufacturerDialogOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSaveManufacturer}>
              <Check className="w-4 h-4" /> حفظ الشركة المصنعة
            </Button>
          </>
        }
      >
        <div className="space-y-4" dir="rtl">
          <Field label="اسم الشركة المصنعة / الماركة" required>
            <Input
              value={manufacturerForm.name}
              onChange={(e) => setManufacturerForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثل: Bosch، Denso، لانسر، Mobis..."
              autoFocus
            />
          </Field>

          <Field label="بلد المنشأ الرئيسي للشركة">
            <SearchableSelect
              value={manufacturerForm.countryCode}
              onChange={(val) => setManufacturerForm((f) => ({ ...f, countryCode: val }))}
              options={VEHICLE_COUNTRIES.map((c) => ({
                value: c.code,
                label: `${c.flag}  ${c.nameAr} (${c.code})`,
                searchText: `${c.nameAr} ${c.nameEn} ${c.code}`,
              }))}
              placeholder="اختر بلد الشركة (اختياري)..."
              searchPlaceholder="ابحث عن دولة..."
              minChars={0}
            />
          </Field>

          <Field label="تخصص الشركة / نوع قطع الغيار">
            <Select
              value={manufacturerForm.specialty}
              onChange={(e) => setManufacturerForm((f) => ({ ...f, specialty: e.target.value }))}
            >
              <option value="">عام (متعدد التخصصات)</option>
              <option value="فلاتر">فلاتر (فلاتر زيت وهواء وتكييف)</option>
              <option value="فرامل">فرامل (تيل وطنابير وسوائل فرامل)</option>
              <option value="عفشة و تعليق">عفشة وتنقيل (مساعدين ومقصات)</option>
              <option value="كهرباء وإضاءة">كهرباء وإضاءة (بوجيهات وفوانيس)</option>
              <option value="محرك">محرك وأجزاء دقيقة</option>
              <option value="زيوت وسوائل">زيوت وسوائل</option>
              <option value="سيور وبلي">سيور وبلي</option>
            </Select>
          </Field>

          <Field
            label="مستوى الجودة الشهير للشركة"
            hint={`• أصلي توكيل:\nغلاف وعلبة التوكيل وماركة السيارة الرسمية.\n\n• OEM:\nالمصنّع الأصلي لشركات السيارات.\n\n• بديل ممتاز:\nقطع غيار تجارية معتمدة عالية الجودة.\n\n• بديل اقتصادي:\nقطع غيار تجارية موفرة للسعر.`}
          >
            <Select
              value={manufacturerForm.qualityGrade}
              onChange={(e) => setManufacturerForm((f) => ({ ...f, qualityGrade: e.target.value }))}
            >
              <option value="">غير محدد</option>
              <option value="genuine">أصلي توكيل (غلاف وعلبة ماركة السيارة الرسمية)</option>
              <option value="oem">OEM (المصنّع الأصلي للقطعة في علبته التجارية)</option>
              <option value="aftermarket-premium">بديل ممتاز (Premium Aftermarket — جودة عالية)</option>
              <option value="aftermarket-economy">بديل اقتصادي (Economy Aftermarket — موفر للسعر)</option>
            </Select>
          </Field>

          <Field label="ملاحظات إضافية">
            <Textarea
              value={manufacturerForm.notes}
              onChange={(e) => setManufacturerForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="أي ملاحظات حول الوكيل أو الضمان أو جودة منتجات الشركة..."
              rows={2}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={quickAddOpen}
        onClose={() => { setQuickAddOpen(false); setQuickAddErrors({}); }}
        title="إضافة قطعة بديلة جديدة"
        subtitle="سجّل الحد الأدنى من البيانات بسرعة، وتقدر تكمّل الباقي (باركود، رقم OEM، توافق السيارات...) لاحقًا من صفحة قطع الغيار"
        width="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setQuickAddOpen(false); setQuickAddErrors({}); }}>إلغاء</Button>
            <Button onClick={handleQuickAddProduct}><Check className="w-4 h-4" /> إضافة القطعة</Button>
          </>
        }
      >
        <div className="space-y-3" dir="rtl">
          <Field label="اسم القطعة" required error={quickAddErrors.name}>
            <Input
              value={quickAddForm.name}
              onChange={(e) => setQuickAddForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثل: فلتر زيت موتور هيونداي إلنترا"
              autoFocus
            />
          </Field>
          <Field label="رقم القطعة" required error={quickAddErrors.partNumber}>
            <Input
              value={quickAddForm.partNumber}
              onChange={(e) => setQuickAddForm((f) => ({ ...f, partNumber: e.target.value }))}
              placeholder="Part Number"
              dir="ltr"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الفئة">
              <Select value={quickAddForm.category} onChange={(e) => setQuickAddForm((f) => ({ ...f, category: e.target.value }))}>
                {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="الوحدة">
              <Select value={quickAddForm.unit} onChange={(e) => setQuickAddForm((f) => ({ ...f, unit: e.target.value }))}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="بلد المنشأ" required error={quickAddErrors.originCountry}>
            <SearchableSelect
              value={quickAddForm.originCountry}
              onChange={(val) => setQuickAddForm((f) => ({ ...f, originCountry: val }))}
              options={VEHICLE_COUNTRIES.map((c) => ({
                value: c.code,
                label: `${c.flag}  ${c.nameAr} (${c.code})`,
                searchText: `${c.nameAr} ${c.nameEn} ${c.code}`,
              }))}
              placeholder="اختر بلد المنشأ..."
              searchPlaceholder="ابحث عن دولة..."
              minChars={0}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="سعر البيع">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={quickAddForm.wholesalePrice}
                onChange={(e) => setQuickAddForm((f) => ({ ...f, wholesalePrice: Number(e.target.value) }))}
              />
            </Field>
            <Field label="الكمية">
              <Input
                type="number"
                min={0}
                value={quickAddForm.quantity}
                onChange={(e) => setQuickAddForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
              />
            </Field>
            <Field label="الحد الأدنى">
              <Input
                type="number"
                min={0}
                value={quickAddForm.minStock}
                onChange={(e) => setQuickAddForm((f) => ({ ...f, minStock: Number(e.target.value) }))}
              />
            </Field>
          </div>
        </div>
      </Dialog>
    </Dialog>
  );
}
