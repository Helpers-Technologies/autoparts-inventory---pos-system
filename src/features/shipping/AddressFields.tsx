import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomerAddress } from "../../types";
import { Field, Input } from "../../components/ui/Input";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { useToast } from "../../components/ui/Toast";
import {
  useShipping,
  type BostaCityOption,
  type BostaDistrictOption,
} from "../../store/ShippingContext";
import { useFeatures } from "../../lib/useFeatures";

export type AddressDraft = Omit<
  CustomerAddress,
  "id" | "createdAt" | "updatedAt"
>;

function bilingualLabel(arabic?: string, english?: string) {
  if (arabic && english && arabic !== english) return `${arabic} — ${english}`;
  return arabic || english || "—";
}

function normalizePlace(value?: string) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s_-]+/g, " ");
}

function cityMatches(value: AddressDraft, city: BostaCityOption) {
  const current = [value.governorate, value.bosta?.cityName]
    .map(normalizePlace)
    .filter(Boolean);
  return [city.nameAr, city.name]
    .map(normalizePlace)
    .some((name) => name && current.includes(name));
}

export function AddressFields({
  value,
  onChange,
  compact = false,
  showRecipient = true,
}: {
  value: AddressDraft;
  onChange: (value: AddressDraft) => void;
  compact?: boolean;
  showRecipient?: boolean;
}) {
  const toast = useToast();
  const { isEnabled } = useFeatures();
  const bostaIntegrationEnabled = isEnabled("bostaIntegration");
  const toastRef = useRef(toast);
  const { bostaConfig, getBostaCities, getBostaDistricts } = useShipping();
  const [cities, setCities] = useState<BostaCityOption[]>([]);
  const [districts, setDistricts] = useState<BostaDistrictOption[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [districtsLoading, setDistrictsLoading] = useState(false);
  const internetNoticeShown = useRef(false);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  function set<K extends keyof AddressDraft>(key: K, next: AddressDraft[K]) {
    onChange({ ...value, [key]: next });
  }

  useEffect(() => {
    if (!bostaIntegrationEnabled || !bostaConfig.configured) return;
    let active = true;
    setCitiesLoading(true);
    void getBostaCities().then((result) => {
      if (!active) return;
      setCitiesLoading(false);
      if (result.ok) {
        setCities(result.cities ?? []);
        internetNoticeShown.current = false;
        return;
      }
      if (
        result.error === "internet_required" &&
        !internetNoticeShown.current
      ) {
        internetNoticeShown.current = true;
        toastRef.current.error(
          "الإنترنت مطلوب",
          "شغّل الإنترنت لتحميل المحافظات والمدن والمناطق المعتمدة من Bosta.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [bostaConfig.configured, bostaIntegrationEnabled, getBostaCities]);

  const matchedCity = useMemo(
    () =>
      cities.find((city) => city.id === value.bosta?.cityId) ??
      cities.find((city) => cityMatches(value, city)),
    [cities, value],
  );
  const selectedCityId = matchedCity?.id ?? "";

  useEffect(() => {
    if (!selectedCityId) {
      setDistricts([]);
      return;
    }
    let active = true;
    setDistrictsLoading(true);
    void getBostaDistricts(selectedCityId).then((result) => {
      if (!active) return;
      setDistrictsLoading(false);
      if (result.ok) setDistricts(result.districts ?? []);
      else setDistricts([]);
    });
    return () => {
      active = false;
    };
  }, [getBostaDistricts, selectedCityId]);

  const zones = useMemo(() => {
    const unique = new Map<
      string,
      { id: string; name: string; nameAr?: string }
    >();
    for (const district of districts) {
      const name = district.zoneName ?? district.name;
      const nameAr = district.zoneNameAr;
      const id = district.zoneId ?? `zone:${normalizePlace(name)}`;
      if (!unique.has(id)) unique.set(id, { id, name, nameAr });
    }
    return [...unique.values()];
  }, [districts]);

  const matchedZone =
    zones.find((zone) => zone.id === value.bosta?.zoneId) ??
    zones.find((zone) =>
      [zone.name, zone.nameAr]
        .map(normalizePlace)
        .filter(Boolean)
        .includes(normalizePlace(value.city)),
    );
  const selectedZoneId = matchedZone?.id ?? "";
  const filteredDistricts = selectedZoneId
    ? districts.filter(
        (district) =>
          (district.zoneId ??
            `zone:${normalizePlace(district.zoneName ?? district.name)}`) ===
          selectedZoneId,
      )
    : [];

  function selectGovernorate(cityId: string) {
    const city = cities.find((item) => item.id === cityId);
    if (!city) return;
    onChange({
      ...value,
      governorate: city.nameAr || city.name,
      city: "",
      district: "",
      bosta: {
        cityId: city.id,
        cityName: city.name,
      },
    });
  }

  function selectZone(zoneId: string) {
    const zone = zones.find((item) => item.id === zoneId);
    if (!zone || !matchedCity) return;
    onChange({
      ...value,
      city: zone.nameAr || zone.name,
      district: "",
      bosta: {
        cityId: matchedCity.id,
        cityName: matchedCity.name,
        zoneId: zone.id.startsWith("zone:") ? undefined : zone.id,
        zoneName: zone.name,
      },
    });
  }

  function selectDistrict(districtId: string) {
    const district = districts.find((item) => item.id === districtId);
    if (!district || !matchedCity) return;
    onChange({
      ...value,
      district: district.nameAr || district.name,
      bosta: {
        cityId: matchedCity.id,
        cityName: matchedCity.name,
        zoneId: district.zoneId,
        zoneName: district.zoneName,
        districtId: district.id,
        districtName: district.name,
      },
    });
  }

  const coverageUnavailable = !bostaConfig.configured;

  return (
    <div
      className={`grid ${compact ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2"} gap-3`}
    >
      {showRecipient ? (
        <>
          <Field label="اسم المستلم">
            <Input
              value={value.recipientName ?? ""}
              onChange={(event) => set("recipientName", event.target.value)}
              placeholder="نفس اسم العميل إذا تُرك فارغًا"
            />
          </Field>
          <Field label="هاتف الاستلام">
            <Input
              value={value.phone ?? ""}
              onChange={(event) =>
                set(
                  "phone",
                  event.target.value.replace(/[^0-9+]/g, "").slice(0, 20),
                )
              }
              dir="ltr"
              className="text-right font-mono"
            />
          </Field>
        </>
      ) : null}

      {bostaIntegrationEnabled ? <><Field
        label="المحافظة"
        required
        hint="قائمة المحافظات المعتمدة من Bosta وتدعم البحث بالعربي والإنجليزي"
      >
        <SearchableSelect
          value={selectedCityId}
          onChange={selectGovernorate}
          disabled={coverageUnavailable || citiesLoading}
          options={cities.map((city) => ({
            value: city.id,
            label: bilingualLabel(city.nameAr, city.name),
            searchText: `${city.nameAr ?? ""} ${city.name}`,
          }))}
          placeholder={
            coverageUnavailable
              ? "فعّل ربط Bosta أولًا"
              : citiesLoading
                ? "جاري تحميل المحافظات..."
                : "اختر المحافظة"
          }
          searchPlaceholder="ابحث عن المحافظة بالعربي أو الإنجليزي..."
          clearable={false}
        />
      </Field>

      <Field label="المدينة / المركز" required>
        <SearchableSelect
          value={selectedZoneId}
          onChange={selectZone}
          disabled={!selectedCityId || districtsLoading}
          options={zones.map((zone) => ({
            value: zone.id,
            label: bilingualLabel(zone.nameAr, zone.name),
            searchText: `${zone.nameAr ?? ""} ${zone.name}`,
          }))}
          placeholder={
            !selectedCityId
              ? "اختر المحافظة أولًا"
              : districtsLoading
                ? "جاري تحميل المدن..."
                : "اختر المدينة / المركز"
          }
          searchPlaceholder="ابحث عن المدينة بالعربي أو الإنجليزي..."
          clearable={false}
        />
      </Field>

      <Field label="المنطقة / الحي">
        <SearchableSelect
          value={value.bosta?.districtId ?? ""}
          onChange={selectDistrict}
          disabled={!selectedZoneId || districtsLoading}
          options={filteredDistricts.map((district) => ({
            value: district.id,
            label: bilingualLabel(district.nameAr, district.name),
            searchText: `${district.nameAr ?? ""} ${district.name} ${district.zoneNameAr ?? ""} ${district.zoneName ?? ""}`,
          }))}
          placeholder={
            !selectedZoneId ? "اختر المدينة أولًا" : "اختر المنطقة / الحي"
          }
          searchPlaceholder="ابحث عن المنطقة بالعربي أو الإنجليزي..."
        />
      </Field></> : <>
        <Field label="المحافظة" required>
          <Input value={value.governorate} onChange={(event) => set("governorate", event.target.value)} placeholder="مثال: الجيزة" />
        </Field>
        <Field label="المدينة / المركز" required>
          <Input value={value.city} onChange={(event) => set("city", event.target.value)} placeholder="مثال: 6 أكتوبر" />
        </Field>
        <Field label="المنطقة / الحي">
          <Input value={value.district ?? ""} onChange={(event) => set("district", event.target.value)} placeholder="مثال: الحي السابع" />
        </Field>
      </>}

      <Field
        label="العنوان بالتفصيل"
        required
        className={compact ? "col-span-2" : "sm:col-span-2"}
      >
        <Input
          value={value.addressLine}
          onChange={(event) => set("addressLine", event.target.value)}
          placeholder="الشارع، رقم العقار، علامة مميزة"
        />
      </Field>
      {!compact ? (
        <>
          <Field label="أقرب علامة مميزة">
            <Input
              value={value.landmark ?? ""}
              onChange={(event) => set("landmark", event.target.value)}
            />
          </Field>
          <Field label="رقم المبنى">
            <Input
              value={value.buildingNumber ?? ""}
              onChange={(event) => set("buildingNumber", event.target.value)}
            />
          </Field>
          <Field label="الدور">
            <Input
              value={value.floor ?? ""}
              onChange={(event) => set("floor", event.target.value)}
            />
          </Field>
          <Field label="الشقة">
            <Input
              value={value.apartment ?? ""}
              onChange={(event) => set("apartment", event.target.value)}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}
