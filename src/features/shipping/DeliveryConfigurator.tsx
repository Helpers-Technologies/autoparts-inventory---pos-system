import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  MapPin,
  PackageCheck,
  Pencil,
  Plus,
  Save,
  Store,
  Truck,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Field, Input, Select } from "../../components/ui/Input";
import { SearchableSelect } from "../../components/ui/SearchableSelect";
import { useToast } from "../../components/ui/Toast";
import { useCatalog } from "../../store/CatalogContext";
import {
  BOSTA_PROVIDER_ID,
  useShipping,
  type BostaCityOption,
  type BostaDistrictOption,
} from "../../store/ShippingContext";
import {
  defaultCustomerAddress,
  snapshotCustomerAddress,
} from "../../lib/shipping";
import { formatCurrency } from "../../lib/format";
import { uid } from "../../lib/utils";
import type {
  CustomerAddress,
  CustomerAddressSnapshot,
  DeliveryOrder,
  DeliveryMethod,
} from "../../types";
import { AddressFields, type AddressDraft } from "./AddressFields";
import { ShippingProviderLogo } from "./ShippingProviderLogo";
import { useFeatures } from "../../lib/useFeatures";

export interface DeliveryDraft {
  method: DeliveryMethod;
  addressId?: string;
  address?: CustomerAddressSnapshot;
  providerId?: string;
  providerName?: string;
  driverId?: string;
  driverName?: string;
  shippingFee: number;
  collectOnDelivery: boolean;
  packageType?: DeliveryOrder["packageType"];
  shippingNotes?: string;
  allowOpenPackage?: boolean;
}

export const EMPTY_DELIVERY: DeliveryDraft = {
  method: "pickup",
  shippingFee: 0,
  collectOnDelivery: false,
};

const EMPTY_ADDRESS: AddressDraft = {
  label: "عنوان التوصيل",
  governorate: "",
  city: "",
  addressLine: "",
  isDefault: false,
};

function normalizePlace(value: string | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("ar-EG");
}

function bostaCityMatchesAddress(
  address: CustomerAddressSnapshot,
  city: BostaCityOption,
) {
  const addressPlaces = [address.governorate, address.city]
    .map(normalizePlace)
    .filter(Boolean);
  const bostaNames = [city.nameAr, city.name]
    .map(normalizePlace)
    .filter(Boolean);
  return addressPlaces.some((place) => bostaNames.includes(place));
}

function bostaCityLabel(city: BostaCityOption) {
  return city.nameAr && city.nameAr !== city.name
    ? `${city.nameAr} — ${city.name}`
    : city.name;
}

const BOSTA_PACKAGE_OPTIONS: Array<{
  value: NonNullable<DeliveryOrder["packageType"]>;
  label: string;
}> = [
  { value: "SMALL", label: "صغير" },
  { value: "MEDIUM", label: "متوسط" },
  { value: "LARGE", label: "كبير" },
  { value: "Light Bulky", label: "ضخم خفيف" },
  { value: "Heavy Bulky", label: "ضخم ثقيل" },
];

function packageTypeLabel(value: DeliveryOrder["packageType"]) {
  return (
    BOSTA_PACKAGE_OPTIONS.find((option) => option.value === value)?.label ??
    "صغير"
  );
}

export function DeliveryConfigurator({
  customerId,
  value,
  onChange,
  orderSubtotal = 0,
  compact = false,
}: {
  customerId: string;
  value: DeliveryDraft;
  onChange: (value: DeliveryDraft) => void;
  orderSubtotal?: number;
  compact?: boolean;
}) {
  const { customers, drivers, updateCustomer } = useCatalog();
  const { isEnabled } = useFeatures();
  const bostaIntegrationEnabled = isEnabled("bostaIntegration");
  const toast = useToast();
  const internetNoticeShown = useRef(false);
  const {
    providers,
    bostaConfig,
    rateForAddress,
    getBostaCities,
    getBostaDistricts,
    estimateBostaPrice,
  } = useShipping();
  const customer = customers.find((item) => item.id === customerId);
  const activeProviders = providers.filter(
    (item) =>
      item.active &&
      (item.kind !== "bosta" ||
        (bostaIntegrationEnabled && bostaConfig.enabled)),
  );
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [bostaCities, setBostaCities] = useState<BostaCityOption[]>([]);
  const [bostaDistricts, setBostaDistricts] = useState<BostaDistrictOption[]>(
    [],
  );
  const [bostaCoverageLoading, setBostaCoverageLoading] = useState(false);
  const [bostaLiveFee, setBostaLiveFee] = useState<number | undefined>();
  const [bostaPriceLoading, setBostaPriceLoading] = useState(false);
  const [bostaPriceError, setBostaPriceError] = useState<string | undefined>();
  const [showShippingAddressDetails, setShowShippingAddressDetails] =
    useState(false);
  const [showBostaShipmentDetails, setShowBostaShipmentDetails] =
    useState(true);

  const notifyInternetRequired = useCallback(
    (error?: string) => {
      if (error !== "internet_required" || internetNoticeShown.current) return;
      internetNoticeShown.current = true;
      toast.error(
        "الإنترنت مطلوب",
        "شغّل الإنترنت لمطابقة العنوان وحساب سعر شركة الشحن.",
      );
    },
    [toast],
  );

  useEffect(() => {
    const resetInternetNotice = () => {
      internetNoticeShown.current = false;
    };
    window.addEventListener("online", resetInternetNotice);
    return () => window.removeEventListener("online", resetInternetNotice);
  }, []);

  const addresses = useMemo(() => {
    if (!customer) return [];
    if (customer.addresses?.length) return customer.addresses;
    const legacy = defaultCustomerAddress(customer);
    return legacy ? [legacy] : [];
  }, [customer]);

  useEffect(() => {
    if (value.method === "pickup" || !customer) return;
    if (
      value.address &&
      value.addressId &&
      addresses.some((item) => item.id === value.addressId)
    )
      return;
    const initial = addresses.find((item) => item.isDefault) ?? addresses[0];
    if (initial) {
      onChange({
        ...value,
        addressId: initial.id,
        address: snapshotCustomerAddress(initial, customer),
      });
    } else {
      setEditingAddress(true);
      setAddressDraft({
        ...EMPTY_ADDRESS,
        recipientName: customer.name,
        phone: customer.phone,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, value.method]);

  const matchedRate =
    value.method === "shipping_company" && value.providerId && value.address
      ? rateForAddress(value.providerId, value.address)
      : undefined;
  const selectedProvider = providers.find(
    (provider) => provider.id === value.providerId,
  );
  const isBosta =
    bostaIntegrationEnabled &&
    value.method === "shipping_company" &&
    (value.providerId === BOSTA_PROVIDER_ID ||
      selectedProvider?.kind === "bosta");
  const selectedBostaCity = bostaCities.find(
    (item) => item.id === value.address?.bosta?.cityId,
  );
  const bostaCityMatchesCurrentAddress =
    !!value.address &&
    !!selectedBostaCity &&
    bostaCityMatchesAddress(value.address, selectedBostaCity);

  useEffect(() => {
    if (!isBosta || bostaCities.length || !bostaConfig.configured) return;
    let active = true;
    setBostaCoverageLoading(true);
    void getBostaCities().then((result) => {
      if (!active) return;
      setBostaCoverageLoading(false);
      if (result.ok) setBostaCities(result.cities ?? []);
      else notifyInternetRequired(result.error);
    });
    return () => {
      active = false;
    };
  }, [
    bostaCities.length,
    bostaConfig.configured,
    getBostaCities,
    isBosta,
    notifyInternetRequired,
  ]);

  useEffect(() => {
    if (!isBosta || !value.address || !bostaCities.length) return;
    if (selectedBostaCity && bostaCityMatchesCurrentAddress) return;
    const match = bostaCities.find((city) =>
      [value.address?.governorate, value.address?.city].some(
        (place) =>
          normalizePlace(place) === normalizePlace(city.nameAr) ||
          normalizePlace(place) === normalizePlace(city.name),
      ),
    );
    if (match) {
      applyBostaCity(match);
      return;
    }
    if (selectedBostaCity) {
      clearBostaMapping();
      toast.info(
        "تمت مراجعة عنوان الشحن",
        "مرجع المدينة المحفوظ لا يطابق عنوان العميل الحالي. اختر المدينة الصحيحة قبل الإرسال.",
      );
    }
    // The mapping is persisted only when it matches the current address, so
    // changing addresses cannot leave a stale Bosta city behind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bostaCities,
    bostaCityMatchesCurrentAddress,
    isBosta,
    selectedBostaCity,
    value.address?.bosta?.cityId,
    value.address?.city,
    value.address?.governorate,
  ]);

  useEffect(() => {
    const cityId = value.address?.bosta?.cityId;
    if (!isBosta || !cityId) {
      setBostaDistricts([]);
      return;
    }
    let active = true;
    setBostaCoverageLoading(true);
    void getBostaDistricts(cityId).then((result) => {
      if (!active) return;
      setBostaCoverageLoading(false);
      setBostaDistricts(result.ok ? (result.districts ?? []) : []);
      if (!result.ok) notifyInternetRequired(result.error);
    });
    return () => {
      active = false;
    };
  }, [
    getBostaDistricts,
    isBosta,
    notifyInternetRequired,
    value.address?.bosta?.cityId,
  ]);

  useEffect(() => {
    const dropOffCity = value.address?.bosta?.cityName;
    if (
      !isBosta ||
      !bostaConfig.enabled ||
      !bostaConfig.configured ||
      !dropOffCity
    ) {
      setBostaLiveFee(undefined);
      setBostaPriceError(undefined);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setBostaPriceLoading(true);
      setBostaPriceError(undefined);
      const packageType = value.packageType ?? bostaConfig.defaultPackageType;
      const size =
        packageType === "Light Bulky" || packageType === "Heavy Bulky"
          ? packageType
          : "Normal";
      void estimateBostaPrice({
        dropOffCity,
        cod: value.collectOnDelivery ? Math.max(0, orderSubtotal) : 0,
        size,
      }).then((result) => {
        if (!active) return;
        setBostaPriceLoading(false);
        if (result.ok && result.fee !== undefined) {
          setBostaLiveFee(result.fee);
        } else {
          setBostaLiveFee(undefined);
          setBostaPriceError(result.error ?? "price_unavailable");
          notifyInternetRequired(result.error);
        }
      });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    bostaConfig.configured,
    bostaConfig.defaultPackageType,
    bostaConfig.enabled,
    estimateBostaPrice,
    isBosta,
    notifyInternetRequired,
    orderSubtotal,
    value.packageType,
    value.address?.bosta?.cityName,
    value.collectOnDelivery,
  ]);

  useEffect(() => {
    if (value.method !== "shipping_company") {
      if (value.method === "pickup" && value.shippingFee !== 0)
        onChange({ ...value, shippingFee: 0, collectOnDelivery: false });
      return;
    }
    if (isBosta && bostaPriceLoading) return;
    const automaticFee =
      isBosta && bostaLiveFee !== undefined
        ? bostaLiveFee
        : matchedRate
          ? matchedRate.fee +
            (value.collectOnDelivery ? (matchedRate.cashOnDeliveryFee ?? 0) : 0)
          : 0;
    if (value.shippingFee !== automaticFee)
      onChange({ ...value, shippingFee: automaticFee });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    matchedRate?.id,
    matchedRate?.fee,
    matchedRate?.cashOnDeliveryFee,
    value.collectOnDelivery,
    value.method,
    isBosta,
    bostaLiveFee,
    bostaPriceLoading,
  ]);

  function persistAddressMapping(address: CustomerAddressSnapshot) {
    if (
      !customer ||
      !address.addressId ||
      address.addressId.startsWith("legacy-")
    )
      return;
    const current = customer.addresses ?? [];
    if (!current.some((item) => item.id === address.addressId)) return;
    updateCustomer(customer.id, {
      addresses: current.map((item) =>
        item.id === address.addressId
          ? {
              ...item,
              district: address.district,
              bosta: address.bosta,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    });
  }

  function applyBostaCity(city: BostaCityOption) {
    if (!value.address) return;
    const nextAddress: CustomerAddressSnapshot = {
      ...value.address,
      bosta: {
        cityId: city.id,
        cityName: city.name,
      },
    };
    setBostaDistricts([]);
    onChange({ ...value, address: nextAddress });
    persistAddressMapping(nextAddress);
  }

  function clearBostaMapping() {
    if (!value.address) return;
    const { bosta: _bosta, ...addressWithoutBosta } = value.address;
    onChange({ ...value, address: addressWithoutBosta, shippingFee: 0 });
    persistAddressMapping(addressWithoutBosta);
  }

  function applyBostaDistrict(districtId: string) {
    if (!value.address) return;
    const district = bostaDistricts.find((item) => item.id === districtId);
    const nextAddress: CustomerAddressSnapshot = {
      ...value.address,
      bosta: {
        ...value.address.bosta,
        zoneId: district?.zoneId,
        districtId: district?.id,
        districtName: district?.name,
      },
    };
    onChange({ ...value, address: nextAddress });
    persistAddressMapping(nextAddress);
  }

  function setMethod(method: DeliveryMethod) {
    if (method === "pickup") return onChange({ ...EMPTY_DELIVERY });
    const initialAddress =
      addresses.find((item) => item.isDefault) ?? addresses[0];
    const address =
      customer && initialAddress
        ? snapshotCustomerAddress(initialAddress, customer)
        : undefined;
    if (method === "branch_driver") {
      onChange({
        method,
        addressId: initialAddress?.id,
        address,
        shippingFee: value.method === "branch_driver" ? value.shippingFee : 0,
        collectOnDelivery: value.collectOnDelivery,
      });
    } else {
      const provider = activeProviders[0];
      onChange({
        method,
        addressId: initialAddress?.id,
        address,
        providerId: provider?.id,
        providerName: provider?.name,
        shippingFee: 0,
        // Shipping-company orders are COD by default. The cashier can still
        // explicitly switch the order to prepaid from the payment selector.
        collectOnDelivery:
          value.method === "shipping_company"
            ? value.collectOnDelivery
            : true,
        packageType:
          provider?.kind === "bosta"
            ? (value.packageType ?? bostaConfig.defaultPackageType)
            : value.packageType,
        allowOpenPackage:
          provider?.kind === "bosta"
            ? (value.allowOpenPackage ?? bostaConfig.allowOpenPackage)
            : value.allowOpenPackage,
        shippingNotes: value.shippingNotes,
      });
    }
  }

  function selectProvider(providerId: string) {
    const provider = activeProviders.find((item) => item.id === providerId);
    const registeredAddress =
      provider?.kind === "bosta" && customer
        ? (addresses.find((item) => item.id === value.addressId) ??
          addresses.find((item) => item.isDefault) ??
          addresses[0])
        : undefined;
    setShowShippingAddressDetails(false);
    onChange({
      ...value,
      providerId: provider?.id,
      providerName: provider?.name,
      addressId: registeredAddress?.id ?? value.addressId,
      address:
        registeredAddress && customer
          ? snapshotCustomerAddress(registeredAddress, customer)
          : value.address,
      shippingFee: 0,
      packageType:
        provider?.kind === "bosta"
          ? (value.packageType ?? bostaConfig.defaultPackageType)
          : value.packageType,
      allowOpenPackage:
        provider?.kind === "bosta"
          ? (value.allowOpenPackage ?? bostaConfig.allowOpenPackage)
          : value.allowOpenPackage,
    });
  }

  function updateDeliveryAddress(patch: Partial<CustomerAddressSnapshot>) {
    if (!value.address) return;
    onChange({
      ...value,
      address: { ...value.address, ...patch },
    });
  }

  function chooseAddress(id: string) {
    const selected = addresses.find((item) => item.id === id);
    if (!selected || !customer) return;
    onChange({
      ...value,
      addressId: id,
      address: snapshotCustomerAddress(selected, customer),
      shippingFee: 0,
    });
  }

  function saveAddress() {
    if (
      !customer ||
      !addressDraft.governorate ||
      !addressDraft.city ||
      addressDraft.addressLine.trim().length < 6
    )
      return;
    const timestamp = new Date().toISOString();
    const address: CustomerAddress = {
      ...addressDraft,
      id: uid("address"),
      recipientName: addressDraft.recipientName?.trim() || customer.name,
      phone: addressDraft.phone?.trim() || customer.phone,
      isDefault: !customer.addresses?.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    updateCustomer(customer.id, {
      address: customer.address || address.addressLine,
      addresses: [...(customer.addresses ?? []), address],
    });
    onChange({
      ...value,
      addressId: address.id,
      address: snapshotCustomerAddress(address, customer),
      shippingFee: 0,
    });
    setEditingAddress(false);
    setAddressDraft({ ...EMPTY_ADDRESS });
  }

  const bostaMappingNeedsAttention =
    isBosta &&
    !!value.address &&
    (!value.address.bosta?.cityId ||
      (bostaCities.length > 0 && !bostaCityMatchesCurrentAddress));
  const showBostaMapping =
    isBosta &&
    !!value.address &&
    (bostaMappingNeedsAttention || showShippingAddressDetails);

  return (
    <div
      className={`rounded-2xl border border-line bg-surface ${compact ? "p-3" : "p-4"}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            <Truck className="h-4 w-4 text-brand-600" /> طريقة استلام الطلب
          </div>
          {!compact ? (
            <div className="mt-0.5 text-xs text-ink-faint">
              السعر يُحسب من عنوان العميل وقائمة أسعار جهة الشحن
            </div>
          ) : null}
        </div>
        {value.method !== "pickup" && value.shippingFee > 0 ? (
          <Badge tone="green">
            التوصيل {formatCurrency(value.shippingFee)}
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface-muted/40 p-1">
        <MethodButton
          active={value.method === "pickup"}
          onClick={() => setMethod("pickup")}
          icon={<Store className="h-4 w-4" />}
          label="استلام من الفرع"
        />
        <MethodButton
          active={value.method === "branch_driver"}
          onClick={() => setMethod("branch_driver")}
          icon={<Truck className="h-4 w-4" />}
          label="سائق الفرع"
        />
        <MethodButton
          active={value.method === "shipping_company"}
          onClick={() => setMethod("shipping_company")}
          icon={<PackageCheck className="h-4 w-4" />}
          label="شركة شحن"
        />
      </div>

      {value.method !== "pickup" ? (
        <div className="mt-3 space-y-2.5 border-t border-line pt-3">
          {!customer ? (
            <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              اختر العميل أولًا لتحديد عنوان التوصيل.
            </div>
          ) : (
            <>
              <div
                className={`grid ${compact ? "grid-cols-2" : isBosta ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3"} gap-2`}
              >
                {!isBosta ? (
                  <Field
                    label="عنوان العميل"
                    className={compact ? "col-span-2" : "md:col-span-2"}
                  >
                    <div className="flex gap-2">
                      <Select
                        value={value.addressId ?? ""}
                        onChange={(event) => chooseAddress(event.target.value)}
                        className="flex-1"
                      >
                        <option value="">اختر عنوانًا محفوظًا</option>
                        {addresses.map((address) => (
                          <option key={address.id} value={address.id}>
                            {address.label} — {address.governorate}،{" "}
                            {address.city}، {address.addressLine}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAddressDraft({
                            ...EMPTY_ADDRESS,
                            recipientName: customer.name,
                            phone: customer.phone,
                          });
                          setEditingAddress((current) => !current);
                        }}
                        title="حفظ عنوان جديد"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </Field>
                ) : null}
                {value.method === "branch_driver" ? (
                  <Field label="سائق الفرع" required>
                    <Select
                      value={value.driverId ?? ""}
                      onChange={(event) => {
                        const driver = drivers.find(
                          (item) => item.id === event.target.value,
                        );
                        onChange({
                          ...value,
                          driverId: driver?.id,
                          driverName: driver?.name,
                        });
                      }}
                    >
                      <option value="">اختر السائق</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field label="شركة الشحن" required>
                    <div
                      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                      role="radiogroup"
                      aria-label="اختر شركة الشحن"
                    >
                      {activeProviders.map((provider) => {
                        const active = value.providerId === provider.id;
                        return (
                          <button
                            key={provider.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={provider.name}
                            onClick={() => selectProvider(provider.id)}
                            className={`grid min-h-14 place-items-center rounded-xl border bg-white px-3 py-2 transition dark:bg-slate-900 ${
                              active
                                ? "border-brand-500 ring-2 ring-brand-500/20 shadow-sm"
                                : "border-line hover:border-brand-400 hover:bg-surface-muted"
                            }`}
                          >
                            <ShippingProviderLogo
                              provider={provider}
                              className="max-h-8 max-w-[110px]"
                            />
                          </button>
                        );
                      })}
                      {activeProviders.length === 0 ? (
                        <div className="col-span-full rounded-lg border border-dashed border-line p-3 text-center text-xs text-ink-faint">
                          لا توجد شركة شحن مفعّلة
                        </div>
                      ) : null}
                    </div>
                  </Field>
                )}
              </div>

              {editingAddress ? (
                <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-500/30 dark:bg-brand-500/5">
                  <AddressFields
                    value={addressDraft}
                    onChange={setAddressDraft}
                    compact={compact}
                  />
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveAddress}
                      disabled={
                        !addressDraft.governorate ||
                        !addressDraft.city ||
                        addressDraft.addressLine.trim().length < 6
                      }
                    >
                      <Save className="h-4 w-4" /> حفظ العنوان للعميل
                    </Button>
                  </div>
                </div>
              ) : null}

              {value.address ? (
                <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-muted/35 p-2.5 text-xs text-ink-muted">
                  <MapPin className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1 truncate">
                    {value.address.governorate}، {value.address.city}
                    {value.address.district
                      ? `، ${value.address.district}`
                      : ""}
                    {value.address.addressLine
                      ? ` — ${value.address.addressLine}`
                      : ""}
                  </span>
                  {isBosta && selectedProvider ? (
                    <button
                      type="button"
                      onClick={() =>
                        setShowShippingAddressDetails((current) => !current)
                      }
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink-muted hover:border-brand-400 hover:text-ink"
                    >
                      <Pencil className="h-3 w-3" />
                      مراجعة
                      <ChevronDown
                        className={`h-3 w-3 transition ${showBostaMapping ? "rotate-180" : ""}`}
                      />
                    </button>
                  ) : null}
                </div>
              ) : null}

              {showBostaMapping && value.address ? (
                <div className="rounded-xl border border-brand-200 bg-brand-50/35 p-3 dark:border-brand-500/25 dark:bg-brand-500/5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink">
                      {selectedProvider ? (
                        <ShippingProviderLogo
                          provider={selectedProvider}
                          className="max-h-6 max-w-[90px]"
                        />
                      ) : null}
                      مطابقة عنوان شركة الشحن
                    </div>
                    {bostaCoverageLoading ? (
                      <Badge tone="blue">جاري تحميل المناطق...</Badge>
                    ) : bostaCityMatchesCurrentAddress ? (
                      <Badge tone="green">المدينة مطابقة</Badge>
                    ) : value.address.bosta?.cityId ? (
                      <Badge tone="amber">المدينة تحتاج مراجعة</Badge>
                    ) : (
                      <Badge tone="amber">تحتاج اختيار المدينة</Badge>
                    )}
                  </div>
                  {!bostaConfig.configured ? (
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      أكمل إعداد شركة الشحن من «مركز الربط والتكاملات» لجلب
                      المدن وحساب السعر.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Field label="المحافظة لدى شركة الشحن" required>
                          <SearchableSelect
                            value={value.address.bosta?.cityId ?? ""}
                            onChange={(cityId) => {
                              const city = bostaCities.find(
                                (item) => item.id === cityId,
                              );
                              if (city) applyBostaCity(city);
                            }}
                            options={bostaCities.map((city) => ({
                              value: city.id,
                              label: bostaCityLabel(city),
                              searchText: `${city.nameAr ?? ""} ${city.name}`,
                            }))}
                            placeholder="اختر المدينة المغطاة"
                            searchPlaceholder="ابحث بالعربي أو الإنجليزي عن المدينة..."
                            clearable={false}
                          />
                        </Field>
                        <Field label="المنطقة لدى شركة الشحن (اختياري)">
                          <SearchableSelect
                            value={value.address.bosta?.districtId ?? ""}
                            onChange={applyBostaDistrict}
                            disabled={!value.address.bosta?.cityId}
                            options={bostaDistricts.map((district) => ({
                              value: district.id,
                              label:
                                district.nameAr &&
                                district.nameAr !== district.name
                                  ? `${district.nameAr} — ${district.name}`
                                  : district.name,
                              searchText: `${district.nameAr ?? ""} ${district.name} ${district.zoneName ?? ""}`,
                            }))}
                            placeholder="بدون منطقة محددة"
                            searchPlaceholder="ابحث بالعربي أو الإنجليزي عن المنطقة..."
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {isBosta && value.address ? (
                <div className="overflow-hidden rounded-xl border border-line bg-surface-muted/20">
                  <button
                    type="button"
                    onClick={() =>
                      setShowBostaShipmentDetails((current) => !current)
                    }
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-right transition hover:bg-surface-muted/60"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {selectedProvider ? (
                        <ShippingProviderLogo
                          provider={selectedProvider}
                          className="max-h-6 max-w-[76px] shrink-0"
                        />
                      ) : (
                        <PackageCheck className="h-4 w-4 shrink-0 text-brand-600" />
                      )}
                      <span>
                        <span className="block text-xs font-bold text-ink">
                          بيانات الشحنة
                        </span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {packageTypeLabel(
                            value.packageType ?? bostaConfig.defaultPackageType,
                          )}
                          {" · "}
                          {(value.allowOpenPackage ??
                          bostaConfig.allowOpenPackage)
                            ? "مسموح بفتح الطرد"
                            : "غير مسموح بفتح الطرد"}
                        </span>
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-ink-faint transition ${showBostaShipmentDetails ? "rotate-180" : ""}`}
                    />
                  </button>

                  {showBostaShipmentDetails ? (
                    <div className="grid grid-cols-1 gap-2.5 border-t border-line p-3 sm:grid-cols-2 xl:grid-cols-3">
                      <Field label="اسم المستلم" required>
                        <Input
                          value={value.address.recipientName}
                          onChange={(event) =>
                            updateDeliveryAddress({
                              recipientName: event.target.value.slice(0, 160),
                            })
                          }
                        />
                      </Field>
                      <Field label="هاتف المستلم" required>
                        <Input
                          value={value.address.phone}
                          onChange={(event) =>
                            updateDeliveryAddress({
                              phone: event.target.value
                                .replace(/[^0-9+]/g, "")
                                .slice(0, 20),
                            })
                          }
                          dir="ltr"
                          className="text-right font-mono"
                        />
                      </Field>
                      <Field label="حجم الطرد" required>
                        <Select
                          value={
                            value.packageType ??
                            bostaConfig.defaultPackageType ??
                            "SMALL"
                          }
                          onChange={(event) =>
                            onChange({
                              ...value,
                              packageType: event.target.value as NonNullable<
                                DeliveryOrder["packageType"]
                              >,
                            })
                          }
                        >
                          {BOSTA_PACKAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 self-end rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                        <span>
                          <span className="block font-semibold text-ink">
                            السماح بفتح الطرد
                          </span>
                          <span className="text-[11px] text-ink-faint">
                            يمكن للعميل المعاينة قبل الاستلام
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={
                            value.allowOpenPackage ??
                            bostaConfig.allowOpenPackage
                          }
                          onChange={(event) =>
                            onChange({
                              ...value,
                              allowOpenPackage: event.target.checked,
                            })
                          }
                          className="h-4 w-4 shrink-0 accent-brand-600"
                        />
                      </label>
                      <Field
                        label="ملاحظات للمندوب (اختياري)"
                        className="sm:col-span-2 xl:col-span-2"
                      >
                        <Input
                          value={value.shippingNotes ?? ""}
                          onChange={(event) =>
                            onChange({
                              ...value,
                              shippingNotes: event.target.value.slice(0, 500),
                            })
                          }
                          placeholder="مثال: الاتصال قبل الوصول"
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {value.method === "shipping_company" ? (
                isBosta && bostaPriceLoading ? (
                  <div className="rounded-lg border border-blue-300/60 bg-blue-50/60 px-3 py-2 text-xs text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                    جاري حساب سعر الشحن من عنوان العميل...
                  </div>
                ) : isBosta && bostaLiveFee !== undefined ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50/60 px-3 py-2 text-xs dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                      تم جلب السعر المباشر من شركة الشحن
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">
                      {formatCurrency(value.shippingFee)}
                    </span>
                  </div>
                ) : matchedRate ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50/60 px-3 py-2 text-xs dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                      تم تطبيق سعر{" "}
                      {matchedRate.district
                        ? "الحي"
                        : matchedRate.city
                          ? "المدينة"
                          : "المحافظة"}{" "}
                      تلقائيًا
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">
                      {formatCurrency(value.shippingFee)}
                    </span>
                    {isBosta && bostaPriceError ? (
                      <span className="basis-full text-[11px] text-amber-700 dark:text-amber-300">
                        {bostaPriceError === "internet_required"
                          ? "شغّل الإنترنت لحساب السعر المباشر؛ تم استخدام قائمة الأسعار المحلية."
                          : "تعذر السعر الحي؛ تم استخدام قائمة الأسعار المحلية."}
                      </span>
                    ) : null}
                  </div>
                ) : value.providerId && value.address ? (
                  <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    {isBosta && !value.address.bosta?.cityId
                      ? "اختر المحافظة المطابقة لدى شركة الشحن لحساب السعر تلقائيًا."
                      : "لا يوجد سعر متاح لهذه المنطقة. أضفه من «إدارة التوصيل والشحن» قبل إتمام الطلب."}
                  </div>
                ) : null
              ) : (
                <Field label="رسوم توصيل سائق الفرع">
                  <Input
                    type="number"
                    min={0}
                    value={value.shippingFee}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        shippingFee: Math.max(
                          0,
                          Number(event.target.value) || 0,
                        ),
                      })
                    }
                  />
                </Field>
              )}

              <div className="rounded-xl border border-line bg-surface-muted/25 p-2.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                  <div>
                    <div className="text-xs font-bold text-ink">
                      طريقة تحصيل قيمة الطلب
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-faint">
                      اخترها بوضوح قبل حفظ أوردر التوصيل
                    </div>
                  </div>
                  <Badge tone={value.collectOnDelivery ? "amber" : "green"}>
                    {value.collectOnDelivery ? "غير محصّل" : "تم التحصيل الآن"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="طريقة تحصيل قيمة الطلب">
                  <button
                    type="button"
                    aria-pressed={value.collectOnDelivery}
                    onClick={() =>
                      onChange({ ...value, collectOnDelivery: true })
                    }
                    className={`min-h-12 rounded-lg border px-3 py-2 text-right transition ${
                      value.collectOnDelivery
                        ? "border-amber-500 bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300"
                        : "border-line bg-surface text-ink-muted hover:border-amber-400 hover:text-ink"
                    }`}
                  >
                    <span className="block text-xs font-bold">دفع عند الاستلام</span>
                    <span className="mt-0.5 block text-[10px] opacity-80">لا يُسجل دفع الآن</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={!value.collectOnDelivery}
                    onClick={() =>
                      onChange({ ...value, collectOnDelivery: false })
                    }
                    className={`min-h-12 rounded-lg border px-3 py-2 text-right transition ${
                      !value.collectOnDelivery
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300"
                        : "border-line bg-surface text-ink-muted hover:border-emerald-400 hover:text-ink"
                    }`}
                  >
                    <span className="block text-xs font-bold">مدفوع مسبقًا</span>
                    <span className="mt-0.5 block text-[10px] opacity-80">يُسجل التحصيل الآن</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition ${active ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-line bg-surface text-ink-muted hover:bg-surface-muted"}`}
    >
      {icon}
      {label}
    </button>
  );
}
