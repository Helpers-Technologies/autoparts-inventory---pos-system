import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomerAddress } from "../../types";
import { Field, Input } from "../../components/ui/Input";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import {
  useShipping,
  type BostaCityOption,
  type BostaDistrictOption,
} from "../../store/ShippingContext";
import { useFeatures } from "../../lib/useFeatures";
import {
  EGYPT_GOVERNORATES,
  citiesForGovernorate,
  matchCity,
  matchGovernorate,
  normalizePlaceName,
} from "../../lib/egyptLocations";

export type AddressDraft = Omit<
  CustomerAddress,
  "id" | "createdAt" | "updatedAt"
>;

function bilingualLabel(arabic?: string, english?: string) {
  if (arabic && english && arabic !== english) return `${arabic} — ${english}`;
  return arabic || english || "—";
}

/**
 * Structured Egyptian address capture.
 *
 * The fields are the shop's own, backed by the built-in governorate/city
 * reference in lib/egyptLocations — never by a shipping company's coverage
 * API. That matters for two reasons: a counter sale has to be able to record
 * an address with no carrier connected at all, and the system is going to
 * carry more than one carrier, so none of them can own what a valid address
 * looks like.
 *
 * A connected carrier is an ENRICHMENT pass on top: when Bosta coverage is
 * available the picked governorate/city is resolved to Bosta's own ids and
 * stashed on `value.bosta` so shipments still go out with the ids Bosta
 * wants, and the district field gains Bosta's district list as suggestions.
 * If the carrier is off, unconfigured, or offline, every field still works.
 *
 * `required` is the caller's call — a delivery needs a full address, adding a
 * walk-in customer does not.
 */
export function AddressFields({
  value,
  onChange,
  compact = false,
  showRecipient = true,
  required = false,
}: {
  value: AddressDraft;
  onChange: (value: AddressDraft) => void;
  compact?: boolean;
  showRecipient?: boolean;
  /** Marks governorate / city / street line as mandatory. Delivery and
   *  shipping flows pass true; customer records leave it false. */
  required?: boolean;
}) {
  const { isEnabled } = useFeatures();
  const bostaIntegrationEnabled = isEnabled("bostaIntegration");
  const { bostaConfig, getBostaCities, getBostaDistricts } = useShipping();
  const [carrierCities, setCarrierCities] = useState<BostaCityOption[]>([]);
  const [carrierDistricts, setCarrierDistricts] = useState<
    BostaDistrictOption[]
  >([]);

  function set<K extends keyof AddressDraft>(key: K, next: AddressDraft[K]) {
    onChange({ ...value, [key]: next });
  }

  const carrierCoverageReady =
    bostaIntegrationEnabled && bostaConfig.enabled && bostaConfig.configured;

  // ── Carrier enrichment (optional, never blocking) ───────────────────────
  // Failures here are silent by design: the address is already valid without
  // carrier ids, and a toast about a shipping account is noise to a cashier
  // recording a customer's address.
  useEffect(() => {
    if (!carrierCoverageReady) {
      setCarrierCities([]);
      return;
    }
    let active = true;
    void getBostaCities().then((result) => {
      if (!active) return;
      setCarrierCities(result.ok ? (result.cities ?? []) : []);
    });
    return () => {
      active = false;
    };
  }, [carrierCoverageReady, getBostaCities]);

  const governorate = value.governorate ?? "";
  const canonicalGovernorate = matchGovernorate(governorate);
  const cityOptions = citiesForGovernorate(governorate);

  /** The carrier city covering the picked governorate, if any. */
  const carrierCity = useMemo(() => {
    if (!carrierCities.length) return undefined;
    const wanted = normalizePlaceName(governorate);
    if (!wanted) return undefined;
    return carrierCities.find((city) =>
      [city.nameAr, city.name]
        .map(normalizePlaceName)
        .some((name) => name === wanted),
    );
  }, [carrierCities, governorate]);

  const carrierCityId = carrierCity?.id ?? "";

  useEffect(() => {
    if (!carrierCityId) {
      setCarrierDistricts([]);
      return;
    }
    let active = true;
    void getBostaDistricts(carrierCityId).then((result) => {
      if (!active) return;
      setCarrierDistricts(result.ok ? (result.districts ?? []) : []);
    });
    return () => {
      active = false;
    };
  }, [carrierCityId, getBostaDistricts]);

  // Keep the carrier ids on the address in step with what the user picked,
  // so a shipment created later already carries them.
  const lastSyncedRef = useRef("");
  useEffect(() => {
    const district = carrierDistricts.find(
      (item) =>
        normalizePlaceName(item.nameAr ?? item.name) ===
        normalizePlaceName(value.district),
    );
    const zoneMatch = carrierDistricts.find(
      (item) =>
        normalizePlaceName(item.zoneNameAr ?? item.zoneName) ===
        normalizePlaceName(value.city),
    );
    const next = carrierCity
      ? {
          cityId: carrierCity.id,
          cityName: carrierCity.name,
          zoneId: district?.zoneId ?? zoneMatch?.zoneId,
          zoneName: district?.zoneName ?? zoneMatch?.zoneName,
          districtId: district?.id,
          districtName: district?.name,
        }
      : undefined;
    const signature = JSON.stringify(next ?? null);
    if (signature === lastSyncedRef.current) return;
    if (JSON.stringify(value.bosta ?? null) === signature) {
      lastSyncedRef.current = signature;
      return;
    }
    lastSyncedRef.current = signature;
    onChange({ ...value, bosta: next });
    // `value`/`onChange` are intentionally out of the dep list: this effect
    // writes back into `value`, and including it would re-run on its own
    // output. The signature guard is what makes it settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrierCity, carrierDistricts, value.city, value.district]);

  function selectGovernorate(next: string) {
    if (next === governorate) return;
    // Clearing city/district is deliberate — they belong to the old
    // governorate and a stale pair produces an undeliverable address.
    onChange({ ...value, governorate: next, city: "", district: "" });
  }

  /** SearchableSelect renders the placeholder for any value it has no option
   *  for, so a typed-in place would look unselected. Carry it as its own
   *  option. */
  function withCurrent(names: readonly string[], current: string) {
    const list = current && !names.includes(current) ? [current, ...names] : names;
    return list.map((name) => ({ value: name, label: name, searchText: name }));
  }

  const districtSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const district of carrierDistricts) {
      const zone = normalizePlaceName(district.zoneNameAr ?? district.zoneName);
      if (value.city && zone && zone !== normalizePlaceName(value.city))
        continue;
      const name = district.nameAr ?? district.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }, [carrierDistricts, value.city]);

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

      <Field label="المحافظة" required={required}>
        <SearchableSelect
          value={canonicalGovernorate || governorate}
          onChange={selectGovernorate}
          options={withCurrent(
            EGYPT_GOVERNORATES,
            canonicalGovernorate || governorate,
          )}
          placeholder="اختر المحافظة"
          searchPlaceholder="ابحث عن المحافظة..."
          onCreate={selectGovernorate}
          createLabel="استخدم"
          clearable={false}
        />
      </Field>

      <Field
        label="المدينة / المركز"
        required={required}
        hint={
          governorate && !cityOptions.length
            ? "اكتب اسم المدينة أو المركز"
            : undefined
        }
      >
        <SearchableSelect
          value={matchCity(governorate, value.city) || (value.city ?? "")}
          onChange={(next) => set("city", next)}
          options={withCurrent(
            cityOptions,
            matchCity(governorate, value.city) || (value.city ?? ""),
          )}
          placeholder={
            governorate ? "اختر المدينة / المركز" : "اختر المحافظة أولًا"
          }
          searchPlaceholder="ابحث أو اكتب اسم المدينة..."
          onCreate={(next) => set("city", next)}
          createLabel="استخدم"
          clearable={false}
        />
      </Field>

      <Field
        label="المنطقة / الحي"
        hint={
          districtSuggestions.length
            ? "اقتراحات من تغطية شركة الشحن المرتبطة"
            : undefined
        }
      >
        {districtSuggestions.length ? (
          <SearchableSelect
            value={value.district ?? ""}
            onChange={(next) => set("district", next)}
            options={withCurrent(districtSuggestions, value.district ?? "")}
            placeholder="اختر أو اكتب المنطقة / الحي"
            searchPlaceholder="ابحث أو اكتب المنطقة..."
            onCreate={(next) => set("district", next)}
            createLabel="استخدم"
          />
        ) : (
          <Input
            value={value.district ?? ""}
            onChange={(event) => set("district", event.target.value)}
            placeholder="مثال: الحي السابع"
          />
        )}
      </Field>

      <Field
        label="العنوان بالتفصيل"
        required={required}
        className={compact ? "col-span-2" : "sm:col-span-2"}
      >
        <Input
          value={value.addressLine}
          onChange={(event) => set("addressLine", event.target.value)}
          placeholder="الشارع، رقم العقار، علامة مميزة"
        />
      </Field>

      {carrierCity ? (
        <div className="text-[11px] text-emerald-500 sm:col-span-2">
          العنوان مطابق لتغطية {bilingualLabel(carrierCity.nameAr, carrierCity.name)} لدى شركة الشحن المرتبطة.
        </div>
      ) : null}

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
