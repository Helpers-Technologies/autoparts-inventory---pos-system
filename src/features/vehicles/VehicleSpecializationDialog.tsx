import { useEffect, useMemo, useState } from "react";
import { CarFront, Check, Globe2, Search, Settings2 } from "lucide-react";
import { VEHICLE_COUNTRIES, vehicleCountryLabel } from "../../data/vehicleCountries";
import { useVehicleCatalog } from "../../store/VehicleCatalogContext";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../components/ui/Toast";

const QUICK_PRESETS = [
  { label: "صيني فقط", codes: ["CN"] },
  { label: "كوري فقط", codes: ["KR"] },
  { label: "ألماني فقط", codes: ["DE"] },
  { label: "أمريكي فقط", codes: ["US"] },
  { label: "ياباني فقط", codes: ["JP"] },
  { label: "صيني + كوري", codes: ["CN", "KR"] },
  { label: "كوري + أمريكي", codes: ["KR", "US"] },
  { label: "ألماني + صيني + كوري", codes: ["DE", "CN", "KR"] },
] as const;

export function VehicleSpecializationDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const catalog = useVehicleCatalog();
  const toast = useToast();
  const [includeAllMakes, setIncludeAllMakes] = useState(true);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [makeIds, setMakeIds] = useState<string[]>([]);
  const [makeQuery, setMakeQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setIncludeAllMakes(catalog.vehicleCatalogPreferences.includeAllMakes);
    setCountryCodes(catalog.vehicleCatalogPreferences.selectedCountryCodes);
    setMakeIds(catalog.vehicleCatalogPreferences.selectedMakeIds);
    setMakeQuery("");
  }, [catalog.vehicleCatalogPreferences, open]);

  const activeMakes = useMemo(
    () => catalog.vehicleMakes.filter((make) => make.active),
    [catalog.vehicleMakes],
  );

  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const make of activeMakes) {
      if (make.countryCode) counts.set(make.countryCode, (counts.get(make.countryCode) ?? 0) + 1);
    }
    return counts;
  }, [activeMakes]);

  const previewMakes = useMemo(() => {
    if (includeAllMakes) return activeMakes;
    const selectedCountries = new Set(countryCodes);
    const selectedMakes = new Set(makeIds);
    return activeMakes.filter(
      (make) => selectedMakes.has(make.id) || Boolean(make.countryCode && selectedCountries.has(make.countryCode)),
    );
  }, [activeMakes, countryCodes, includeAllMakes, makeIds]);

  const makeResults = useMemo(() => {
    const needle = makeQuery.trim().toLowerCase();
    if (!needle) return [];
    return activeMakes
      .filter((make) =>
        `${make.name} ${make.nameAr ?? ""} ${vehicleCountryLabel(make.countryCode)}`
          .toLowerCase()
          .includes(needle),
      )
      .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999) || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [activeMakes, makeQuery]);

  const manuallySelectedMakes = activeMakes
    .filter((make) => makeIds.includes(make.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  function toggleCountry(code: string) {
    setIncludeAllMakes(false);
    setCountryCodes((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  }

  function toggleMake(id: string) {
    setIncludeAllMakes(false);
    setMakeIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function applyPreset(codes: readonly string[]) {
    setIncludeAllMakes(false);
    setCountryCodes([...codes]);
    setMakeIds([]);
  }

  function save() {
    if (!includeAllMakes && previewMakes.length === 0) {
      toast.error("اختَر دولة أو ماركة واحدة على الأقل");
      return;
    }
    catalog.updateVehicleCatalogPreferences({
      includeAllMakes,
      selectedCountryCodes: includeAllMakes ? [] : countryCodes,
      selectedMakeIds: includeAllMakes ? [] : makeIds,
    });
    toast.success(
      "تم حفظ تخصص المحل",
      includeAllMakes ? "سيظهر كتالوج السيارات بالكامل" : `سيظهر ${previewMakes.length} ماركة فقط`,
    );
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="تخصص محل قطع الغيار"
      subtitle="اختر أسواق السيارات أو الماركات التي يتعامل معها المحل"
      width="2xl"
      footer={
        <>
          <div className="me-auto text-sm text-ink-muted">
            النتيجة: <strong className="text-ink">{previewMakes.length.toLocaleString("ar-EG")} ماركة</strong>
          </div>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={save}><Check className="w-4 h-4" />حفظ التخصص</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setIncludeAllMakes(true)}
            className={`rounded-xl border p-4 text-start flex items-start gap-3 ${includeAllMakes ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line hover:border-brand-300"}`}
          >
            <Globe2 className="w-6 h-6 text-brand-600 shrink-0" />
            <span><strong className="block">كل ماركات العالم</strong><span className="text-xs text-ink-muted">بدون فلترة — مناسب للمخازن العامة</span></span>
          </button>
          <button
            type="button"
            onClick={() => setIncludeAllMakes(false)}
            className={`rounded-xl border p-4 text-start flex items-start gap-3 ${!includeAllMakes ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line hover:border-brand-300"}`}
          >
            <Settings2 className="w-6 h-6 text-brand-600 shrink-0" />
            <span><strong className="block">تخصص مخصص للمحل</strong><span className="text-xs text-ink-muted">دول متعددة، ماركات محددة، أو الاثنين معًا</span></span>
          </button>
        </div>

        {!includeAllMakes ? (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">اختيارات سريعة</h3>
              <div className="flex flex-wrap gap-2">
                {QUICK_PRESETS.map((preset) => {
                  const active = makeIds.length === 0 &&
                    preset.codes.length === countryCodes.length &&
                    preset.codes.every((code) => countryCodes.includes(code));
                  return (
                    <Button
                      key={preset.label}
                      type="button"
                      size="sm"
                      variant={active ? "primary" : "outline"}
                      onClick={() => applyPreset(preset.codes)}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">التخصص حسب بلد الماركة</h3>
                <span className="text-xs text-ink-faint">يمكن اختيار أكثر من دولة</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 max-h-64 overflow-y-auto pe-1">
                {VEHICLE_COUNTRIES.filter((country) => (countryCounts.get(country.code) ?? 0) > 0).map((country) => {
                  const checked = countryCodes.includes(country.code);
                  return (
                    <label
                      key={country.code}
                      className={`rounded-lg border p-2.5 cursor-pointer flex items-center gap-2 ${checked ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line hover:border-brand-300"}`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleCountry(country.code)} className="accent-brand-600" />
                      <span className="text-lg">{country.flag}</span>
                      <span className="min-w-0"><span className="block text-xs font-medium truncate">{country.nameAr}</span><span className="block text-[10px] text-ink-faint">{countryCounts.get(country.code)} ماركة</span></span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">إضافة ماركات بعينها</h3>
                <p className="text-xs text-ink-muted">مثال: محل Hyundai وKia فقط، أو إضافة Chevrolet لتخصص كوري</p>
              </div>
              <div className="relative">
                <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                <Input value={makeQuery} onChange={(event) => setMakeQuery(event.target.value)} placeholder="ابحث عن ماركة لإضافتها..." className="pe-9" />
              </div>
              {makeResults.length ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-56 overflow-y-auto pe-1">
                  {makeResults.map((make) => {
                    const checked = makeIds.includes(make.id);
                    const includedByCountry = Boolean(make.countryCode && countryCodes.includes(make.countryCode));
                    return (
                      <label key={make.id} className={`rounded-lg border p-2 cursor-pointer flex items-center gap-2 ${checked ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-line"}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMake(make.id)} className="accent-brand-600" />
                        {make.logoPath ? <img src={make.logoPath} alt="" className="w-8 h-7 object-contain shrink-0" /> : <CarFront className="w-6 h-6 text-ink-faint" />}
                        <span className="min-w-0"><span className="block text-xs font-medium truncate" dir="ltr">{make.name}</span><span className="block text-[10px] text-ink-faint truncate">{vehicleCountryLabel(make.countryCode)}{includedByCountry ? " · ضمن الدولة" : ""}</span></span>
                      </label>
                    );
                  })}
                </div>
              ) : makeQuery.trim() ? <div className="text-xs text-ink-faint">لا توجد ماركة مطابقة</div> : null}

              {manuallySelectedMakes.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {manuallySelectedMakes.map((make) => (
                    <button key={make.id} type="button" onClick={() => toggleMake(make.id)} title="إزالة الماركة">
                      <Badge tone="blue">{make.name} ×</Badge>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
