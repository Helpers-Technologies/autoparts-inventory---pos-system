import { useState, useEffect } from "react";
import { ScanLine, ShieldCheck } from "lucide-react";
import { formatEgyptianPlateNumber, validateEgyptianPlateNumber } from "../../lib/plateNumber";
import { YearSelect } from "../../components/ui/YearSelect";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../../components/ui/Input";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { useToast } from "../../components/ui/Toast";
import {
  useAutoPartsPro,
  inferMakeNameFromVin,
  isValidVin,
  normalizeVin,
} from "../../store/AutoPartsProContext";
import { useCatalog } from "../../store/CatalogContext";
import { useVehicleCatalog } from "../../store/VehicleCatalogContext";

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

const EMPTY_DRAFT: VehicleDraft = {
  customerId: "",
  vin: "",
  plateNumber: "",
  makeId: "",
  modelId: "",
  year: "",
  engineCode: "",
  color: "",
  mileageKm: "",
  notes: "",
};

export function CustomerVehicleFormDialog({
  open,
  onClose,
  initialCustomerId = "",
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initialCustomerId?: string;
  onCreated?: (vehicleId: string) => void;
}) {
  const { customers } = useCatalog();
  const vehicleCatalog = useVehicleCatalog();
  const pro = useAutoPartsPro();
  const toast = useToast();
  const [draft, setDraft] = useState<VehicleDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY_DRAFT, customerId: initialCustomerId });
    }
  }, [open, initialCustomerId]);

  const availableModels = vehicleCatalog.vehicleModels.filter(
    (model) => model.makeId === draft.makeId && model.active
  );

  function setVin(value: string) {
    const vin = normalizeVin(value);
    const inferred = inferMakeNameFromVin(vin);
    const inferredMake = inferred
      ? vehicleCatalog.vehicleMakes.find(
          (make) => make.name.toLowerCase() === inferred.toLowerCase()
        )
      : undefined;
    setDraft((current) => ({
      ...current,
      vin,
      makeId: current.makeId || inferredMake?.id || "",
      modelId: current.makeId || !inferredMake ? current.modelId : "",
    }));
  }

  function saveVehicle() {
    if (!draft.customerId || !draft.makeId) {
      toast.error("بيانات ناقصة", "اختر العميل وماركة السيارة.");
      return;
    }
    if (draft.vin && !isValidVin(draft.vin)) {
      toast.error("رقم الشاسيه غير مكتمل", "رقم الشاسيه القياسي يجب أن يكون 17 حرفًا ورقمًا.");
      return;
    }
    const duplicate = pro.customerVehicles.some(
      (vehicle) =>
        (draft.vin && vehicle.vin === draft.vin) ||
        (draft.plateNumber &&
          vehicle.plateNumber?.toLowerCase() === draft.plateNumber.trim().toLowerCase())
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
    toast.success("تم تسجيل السيارة", "تمت إضافة السيارة بنجاح.");
    onCreated?.(item.id);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="تسجيل سيارة عميل جديدة"
      subtitle="أدخل بيانات السيارة لربطها بالعميل"
      width="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={saveVehicle}>
            <ShieldCheck className="h-4 w-4" /> حفظ وربط السيارة
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2" dir="rtl">
        <Field label="العميل" required>
          <Select
            value={draft.customerId}
            onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}
          >
            <option value="">اختر العميل</option>
            {customers
              .filter((customer) => !customer.archived)
              .map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} {customer.phone ? `— ${customer.phone}` : ""}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label="رقم اللوحة"
          hint={
            draft.plateNumber && !validateEgyptianPlateNumber(draft.plateNumber).isValid
              ? validateEgyptianPlateNumber(draft.plateNumber).message
              : "مثال: أ ب ج 1 2 3 4 (2-3 أحرف و 3-4 أرقام)"
          }
        >
          <Input
            value={draft.plateNumber}
            onChange={(event) => setDraft({ ...draft, plateNumber: formatEgyptianPlateNumber(event.target.value) })}
            placeholder="أ ب ج 1 2 3 4"
            className="font-semibold tracking-wider text-center"
          />
        </Field>
        <Field
          label="رقم الشاسيه (VIN)"
          hint={
            draft.vin
              ? `${draft.vin.length}/17${
                  inferMakeNameFromVin(draft.vin)
                    ? ` · متوقع ${inferMakeNameFromVin(draft.vin)}`
                    : ""
                }`
              : "يمكن مسحه بقارئ الباركود"
          }
          className="md:col-span-2"
        >
          <div className="relative">
            <ScanLine className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" />
            <Input
              value={draft.vin}
              onChange={(event) => setVin(event.target.value)}
              className="pr-10 font-mono tracking-wider"
              dir="ltr"
              placeholder="رقم الشاسيه القياسي (17 حرف/رقم)"
            />
          </div>
        </Field>
        <Field label="الماركة" required>
          <SearchableSelect
            value={draft.makeId}
            onChange={(val) => setDraft((current) => ({ ...current, makeId: val, modelId: "" }))}
            options={vehicleCatalog.specializedVehicleMakes
              .filter((make) => make.active)
              .map((make) => ({
                value: make.id,
                label: make.nameAr ? `${make.nameAr} (${make.name})` : make.name,
                image: make.logoPath || `/vehicle-logos/${make.slug}.png`,
                searchText: `${make.name} ${make.nameAr ?? ""}`,
              }))}
            placeholder="اختر الماركة..."
            searchPlaceholder="ابحث عن ماركة السيارة..."
            minChars={0}
          />
        </Field>
        <Field label="الموديل">
          <SearchableSelect
            value={draft.modelId}
            onChange={(val) => setDraft((current) => ({ ...current, modelId: val }))}
            options={availableModels.map((model) => ({
              value: model.id,
              label: model.nameAr ? `${model.nameAr} (${model.name})` : model.name,
              searchText: `${model.name} ${model.nameAr ?? ""}`,
            }))}
            placeholder="اختر الموديل..."
            searchPlaceholder="ابحث عن الموديل..."
            disabled={!draft.makeId}
            minChars={0}
          />
        </Field>
        <Field label="سنة الصنع">
          <YearSelect
            value={draft.year}
            onChange={(val) => setDraft({ ...draft, year: val })}
            placeholder="اختر سنة الصنع"
          />
        </Field>
        <Field label="كود المحرك">
          <Input
            value={draft.engineCode}
            onChange={(event) => setDraft({ ...draft, engineCode: event.target.value.toUpperCase() })}
            dir="ltr"
            placeholder="G4FC / SQRE4T15"
          />
        </Field>
        <Field label="اللون">
          <Input
            value={draft.color}
            onChange={(event) => setDraft({ ...draft, color: event.target.value })}
          />
        </Field>
        <Field label="قراءة العداد">
          <Input
            type="number"
            value={draft.mileageKm}
            onChange={(event) => setDraft({ ...draft, mileageKm: event.target.value })}
            placeholder="كم"
          />
        </Field>
        <Field label="ملاحظات" className="md:col-span-2">
          <Textarea
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
