import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BostaIntegrationConfig,
  CustomerAddressSnapshot,
  DeliveryOrder,
  DeliveryOrderStatus,
  DeliveryStatusEvent,
  ID,
  PaymentMethod,
  ShippingProvider,
  ShippingRate,
} from "../types";
import { lsGet, lsSetBatch } from "../lib/storage";
import {
  bostaPublicTrackingUrl,
  bostaStatus,
  resolveShippingRate,
} from "../lib/shipping";
import { uid } from "../lib/utils";
import { useAuth } from "./AuthContext";
import { useAuditLog } from "./AuditLogContext";
import { useInvoicing } from "./InvoicingContext";

const now = "2026-01-01T00:00:00.000Z";
export const BOSTA_PROVIDER_ID = "shipping_bosta";

function apiInternetAvailable() {
  return typeof navigator === "undefined" || navigator.onLine;
}

export interface BostaCityOption {
  id: string;
  name: string;
  nameAr?: string;
}

export interface BostaDistrictOption {
  id: string;
  name: string;
  nameAr?: string;
  zoneId?: string;
  zoneName?: string;
  zoneNameAr?: string;
}

const DEFAULT_PROVIDERS: ShippingProvider[] = [
  {
    id: BOSTA_PROVIDER_ID,
    name: "Bosta",
    kind: "bosta",
    trackingUrlTemplate:
      "https://bosta.co/ar-eg/tracking-shipments?shipment-number={trackingNumber}",
    active: false,
    supportsCashOnDelivery: true,
    createdAt: now,
    updatedAt: now,
  },
];

const EMPTY_BOSTA_CONFIG: BostaIntegrationConfig = {
  enabled: false,
  autoTrackingEnabled: true,
  autoTrackingIntervalMinutes: 5,
  defaultPackageType: "SMALL",
  allowOpenPackage: false,
  configured: false,
};

export interface CreateDeliveryOrderInput {
  id?: ID;
  invoiceId: ID;
  invoiceNumber: string;
  customerId: ID;
  customerName: string;
  branchId?: ID;
  branchName?: string;
  method: DeliveryOrder["method"];
  address: CustomerAddressSnapshot;
  shippingFee: number;
  codAmount: number;
  driverId?: ID;
  driverName?: string;
  providerId?: ID;
  providerName?: string;
  packageType?: DeliveryOrder["packageType"];
  itemsCount?: number;
  packageDescription?: string;
  allowOpenPackage?: boolean;
  notes?: string;
}

interface ShippingContextValue {
  providers: ShippingProvider[];
  rates: ShippingRate[];
  orders: DeliveryOrder[];
  bostaConfig: BostaIntegrationConfig;
  addProvider: (
    input: Omit<ShippingProvider, "id" | "createdAt" | "updatedAt">,
  ) => ShippingProvider;
  updateProvider: (id: ID, patch: Partial<ShippingProvider>) => void;
  addRate: (
    input: Omit<ShippingRate, "id" | "createdAt" | "updatedAt">,
  ) => ShippingRate;
  updateRate: (id: ID, patch: Partial<ShippingRate>) => void;
  deleteRate: (id: ID) => void;
  rateForAddress: (
    providerId: ID,
    address: Pick<CustomerAddressSnapshot, "governorate" | "city" | "district">,
  ) => ShippingRate | undefined;
  createDeliveryOrder: (input: CreateDeliveryOrderInput) => DeliveryOrder;
  updateOrder: (id: ID, patch: Partial<DeliveryOrder>) => void;
  setOrderStatus: (
    id: ID,
    status: DeliveryOrderStatus,
    label?: string,
    note?: string,
  ) => void;
  settleOrderCod: (
    id: ID,
    paymentMethod: PaymentMethod,
  ) => { ok: boolean; error?: string; amount?: number };
  saveBostaConfig: (input: {
    apiKey?: string;
    enabled: boolean;
    autoTrackingEnabled?: boolean;
    autoTrackingIntervalMinutes?: number;
    businessLocationId?: string;
    webhookUrl?: string;
    webhookHeaderName?: string;
    webhookHeaderValue?: string;
    webhookPollToken?: string;
    defaultPackageType: NonNullable<DeliveryOrder["packageType"]>;
    allowOpenPackage: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  testBostaConnection: () => Promise<{
    ok: boolean;
    error?: string;
    pickupLocations?: Array<{ id: string; name: string }>;
  }>;
  submitOrderToBosta: (orderId: ID) => Promise<{ ok: boolean; error?: string }>;
  refreshBostaTracking: (
    orderId: ID,
  ) => Promise<{ ok: boolean; error?: string }>;
  getBostaCities: () => Promise<{
    ok: boolean;
    error?: string;
    cities?: BostaCityOption[];
  }>;
  getBostaDistricts: (cityId: string) => Promise<{
    ok: boolean;
    error?: string;
    districts?: BostaDistrictOption[];
  }>;
  estimateBostaPrice: (input: {
    dropOffCity: string;
    cod: number;
    size: "Normal" | "Light Bulky" | "Heavy Bulky";
  }) => Promise<{
    ok: boolean;
    error?: string;
    fee?: number;
    currency?: string;
  }>;
  getBostaPricingPlan: (input: {
    tierIdSelector: "c__CT4DU9I" | "yiqKg_aGM1";
    pickupSectorId: number;
    vatIncluded?: boolean;
  }) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
  reloadShippingData: () => void;
}

const ShippingContext = createContext<ShippingContextValue | null>(null);

function eventFor(
  status: DeliveryOrderStatus,
  label: string,
  source: DeliveryStatusEvent["source"],
  externalCode?: number,
  note?: string,
): DeliveryStatusEvent {
  return {
    id: uid("delivery-event"),
    status,
    label,
    source,
    externalCode,
    note,
    occurredAt: new Date().toISOString(),
  };
}

function externalValue(payload: unknown, paths: string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  for (const path of paths) {
    let current: unknown = payload;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (typeof current === "string" || typeof current === "number")
      return String(current);
  }
  return undefined;
}

function externalNumber(payload: unknown, paths: string[]): number | undefined {
  const value = externalValue(payload, paths);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function ShippingProvider({ children }: { children: ReactNode }) {
  const { auth, isDesktop } = useAuth();
  const { logAudit } = useAuditLog();
  const { salesInvoices, recordSalesReceipt } = useInvoicing();
  const [providers, setProviders] = useState<ShippingProvider[]>(() =>
    lsGet("shippingProviders", DEFAULT_PROVIDERS),
  );
  const [rates, setRates] = useState<ShippingRate[]>(() =>
    lsGet("shippingRates", []),
  );
  const [orders, setOrders] = useState<DeliveryOrder[]>(() =>
    lsGet("deliveryOrders", []),
  );
  const ordersRef = useRef(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);
  const [bostaConfig, setBostaConfig] =
    useState<BostaIntegrationConfig>(EMPTY_BOSTA_CONFIG);

  const reloadShippingData = useCallback(() => {
    const storedProviders = lsGet<ShippingProvider[]>(
      "shippingProviders",
      DEFAULT_PROVIDERS,
    );
    setProviders(
      storedProviders.some((item) => item.id === BOSTA_PROVIDER_ID)
        ? storedProviders
        : [...storedProviders, ...DEFAULT_PROVIDERS],
    );
    setRates(lsGet("shippingRates", []));
    setOrders(lsGet("deliveryOrders", []));
  }, []);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    reloadShippingData();
    if (window.desktopAPI?.integrations?.bosta) {
      void window.desktopAPI.integrations.bosta.getConfig().then((result) => {
        if (result.ok && result.config) setBostaConfig(result.config);
      });
    }
  }, [auth.isAuthenticated, reloadShippingData]);

  useEffect(() => {
    if (isDesktop && !auth.isAuthenticated) return;
    lsSetBatch({
      shippingProviders: providers,
      shippingRates: rates,
      deliveryOrders: orders,
    });
  }, [auth.isAuthenticated, isDesktop, providers, rates, orders]);

  useEffect(() => {
    window.addEventListener("autoparts:pro-data-restored", reloadShippingData);
    return () =>
      window.removeEventListener(
        "autoparts:pro-data-restored",
        reloadShippingData,
      );
  }, [reloadShippingData]);

  const addProvider = useCallback(
    (input: Omit<ShippingProvider, "id" | "createdAt" | "updatedAt">) => {
      const timestamp = new Date().toISOString();
      const provider: ShippingProvider = {
        ...input,
        id: uid("shipping-provider"),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setProviders((items) => [...items, provider]);
      logAudit?.("settings_updated", provider.name, "إضافة شركة شحن");
      return provider;
    },
    [logAudit],
  );

  const updateProvider = useCallback(
    (id: ID, patch: Partial<ShippingProvider>) => {
      setProviders((items) =>
        items.map((item) =>
          item.id === id
            ? { ...item, ...patch, updatedAt: new Date().toISOString() }
            : item,
        ),
      );
    },
    [],
  );

  const addRate = useCallback(
    (input: Omit<ShippingRate, "id" | "createdAt" | "updatedAt">) => {
      const timestamp = new Date().toISOString();
      const rate: ShippingRate = {
        ...input,
        id: uid("shipping-rate"),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setRates((items) => [rate, ...items]);
      return rate;
    },
    [],
  );

  const updateRate = useCallback((id: ID, patch: Partial<ShippingRate>) => {
    setRates((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  }, []);

  const deleteRate = useCallback(
    (id: ID) => setRates((items) => items.filter((item) => item.id !== id)),
    [],
  );
  const rateForAddress = useCallback(
    (
      providerId: ID,
      address: Pick<
        CustomerAddressSnapshot,
        "governorate" | "city" | "district"
      >,
    ) => resolveShippingRate(rates, providerId, address),
    [rates],
  );

  const createDeliveryOrder = useCallback(
    (input: CreateDeliveryOrderInput) => {
      const timestamp = new Date().toISOString();
      const order: DeliveryOrder = {
        ...input,
        id: input.id ?? uid("delivery"),
        orderNumber: `DLV-${String(orders.length + 1).padStart(5, "0")}`,
        packageType: input.packageType ?? "SMALL",
        status:
          input.method === "branch_driver" && input.driverId
            ? "assigned"
            : "ready",
        events: [
          eventFor(
            input.method === "branch_driver" && input.driverId
              ? "assigned"
              : "ready",
            input.method === "branch_driver" && input.driverId
              ? "تم تعيين سائق الفرع"
              : "أمر التوصيل جاهز",
            "system",
          ),
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setOrders((items) => [
        order,
        ...items.filter((item) => item.id !== order.id),
      ]);
      logAudit?.(
        "invoice_sale_updated",
        input.invoiceNumber,
        `إنشاء أمر توصيل ${order.orderNumber}`,
      );
      return order;
    },
    [logAudit, orders.length],
  );

  const updateOrder = useCallback((id: ID, patch: Partial<DeliveryOrder>) => {
    setOrders((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  }, []);

  const setOrderStatus = useCallback(
    (id: ID, status: DeliveryOrderStatus, label?: string, note?: string) => {
      setOrders((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                status,
                updatedAt: new Date().toISOString(),
                events: [
                  eventFor(status, label || status, "user", undefined, note),
                  ...item.events,
                ],
              }
            : item,
        ),
      );
    },
    [],
  );

  const settleOrderCod = useCallback(
    (id: ID, paymentMethod: PaymentMethod) => {
      const order = orders.find((item) => item.id === id);
      if (!order) return { ok: false, error: "order_not_found" };
      if (order.status !== "delivered")
        return { ok: false, error: "delivery_not_completed" };
      if (order.codSettledAt)
        return { ok: false, error: "cod_already_settled" };
      const invoice = salesInvoices.find((item) => item.id === order.invoiceId);
      if (!invoice) return { ok: false, error: "invoice_not_found" };
      const amount = Math.min(order.codAmount, invoice.remaining);
      if (amount <= 0) return { ok: false, error: "invoice_already_paid" };
      recordSalesReceipt(
        invoice.id,
        amount,
        paymentMethod,
        `توريد تحصيل أمر التوصيل ${order.orderNumber}`,
      );
      const timestamp = new Date().toISOString();
      setOrders((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                codSettledAmount: amount,
                codSettledAt: timestamp,
                codSettlementMethod: paymentMethod,
                updatedAt: timestamp,
                events: [
                  eventFor(
                    "delivered",
                    `تم توريد مبلغ التحصيل (${amount})`,
                    "user",
                  ),
                  ...item.events,
                ],
              }
            : item,
        ),
      );
      logAudit?.(
        "invoice_sale_updated",
        invoice.invoiceNumber,
        `توريد تحصيل ${order.orderNumber}: ${amount}`,
      );
      return { ok: true, amount };
    },
    [logAudit, orders, recordSalesReceipt, salesInvoices],
  );

  const saveBostaConfig: ShippingContextValue["saveBostaConfig"] = useCallback(
    async (input) => {
      const api = window.desktopAPI?.integrations?.bosta;
      if (!api) return { ok: false, error: "desktop_required" };
      const result = await api.saveConfig(input);
      if (result.ok && result.config) {
        setBostaConfig(result.config);
        setProviders((items) =>
          items.map((item) =>
            item.id === BOSTA_PROVIDER_ID
              ? {
                  ...item,
                  active: input.enabled,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
      }
      return { ok: result.ok, error: result.error };
    },
    [],
  );

  const testBostaConnection: ShippingContextValue["testBostaConnection"] =
    useCallback(async () => {
      const api = window.desktopAPI?.integrations?.bosta;
      if (!api) return { ok: false, error: "desktop_required" };
      if (!apiInternetAvailable())
        return { ok: false, error: "internet_required" };
      const result = await api.testConnection();
      setBostaConfig((current) => ({
        ...current,
        lastTestedAt: new Date().toISOString(),
        lastTestOk: result.ok,
      }));
      return result;
    }, []);

  const submitOrderToBosta: ShippingContextValue["submitOrderToBosta"] =
    useCallback(
      async (orderId) => {
        const api = window.desktopAPI?.integrations?.bosta;
        if (!api) return { ok: false, error: "desktop_required" };
        if (!apiInternetAvailable())
          return { ok: false, error: "internet_required" };
        const order = ordersRef.current.find((item) => item.id === orderId);
        if (!order) return { ok: false, error: "order_not_found" };
        if (!bostaConfig.businessLocationId)
          return { ok: false, error: "bosta_pickup_location_missing" };
        if (!order.address.bosta?.cityId)
          return { ok: false, error: "bosta_city_mapping_required" };
        const invoice = salesInvoices.find(
          (item) => item.id === order.invoiceId,
        );
        if (!invoice) return { ok: false, error: "invoice_not_found" };
        const result = await api.createDelivery({
          businessReference: order.invoiceNumber,
          businessLocationId: bostaConfig.businessLocationId,
          cod: order.codAmount,
          goodsValue: Math.max(0, invoice.total - order.shippingFee),
          receiver: {
            fullName: order.address.recipientName,
            phone: order.address.phone,
            email: order.address.recipientEmail,
          },
          dropOffAddress: order.address,
          specs: {
            packageType: order.packageType ?? bostaConfig.defaultPackageType,
            itemsCount:
              order.itemsCount ??
              invoice.lines.reduce((sum, line) => sum + line.quantity, 0),
            description:
              order.packageDescription?.trim().slice(0, 300) ||
              invoice.lines
                .map((line) => line.productName)
                .join("، ")
                .slice(0, 300),
          },
          notes: order.notes,
          allowOpenPackage:
            order.allowOpenPackage ?? bostaConfig.allowOpenPackage,
        });
        if (!result.ok) return { ok: false, error: result.error };
        const payload = result.data;
        const trackingNumber = externalValue(payload, [
          "trackingNumber",
          "data.trackingNumber",
          "delivery.trackingNumber",
        ]);
        const externalShipmentId = externalValue(payload, [
          "_id",
          "id",
          "data._id",
          "data.id",
          "delivery._id",
        ]);
        const status = bostaStatus(
          externalNumber(payload, ["state", "data.state", "delivery.state"]),
        );
        setOrders((items) =>
          items.map((item) =>
            item.id === orderId
              ? {
                  ...item,
                  providerId: BOSTA_PROVIDER_ID,
                  providerName: "Bosta",
                  status: "pickup_requested",
                  trackingNumber,
                  externalShipmentId,
                  trackingUrl: trackingNumber
                    ? bostaPublicTrackingUrl(trackingNumber)
                    : undefined,
                  updatedAt: new Date().toISOString(),
                  events: [
                    eventFor(
                      "pickup_requested",
                      status.label || "تم إرسال الشحنة إلى Bosta",
                      "bosta",
                    ),
                    ...item.events,
                  ],
                }
              : item,
          ),
        );
        return { ok: true };
      },
      [bostaConfig, salesInvoices],
    );

  const refreshBostaTracking: ShippingContextValue["refreshBostaTracking"] =
    useCallback(
      async (orderId) => {
        const api = window.desktopAPI?.integrations?.bosta;
        if (!api) return { ok: false, error: "desktop_required" };
        if (!apiInternetAvailable())
          return { ok: false, error: "internet_required" };
        const order = ordersRef.current.find((item) => item.id === orderId);
        const reference = order?.trackingNumber || order?.externalShipmentId;
        if (!order || !reference)
          return { ok: false, error: "tracking_number_missing" };
        const result = await api.trackDelivery(reference);
        if (!result.ok) return { ok: false, error: result.error };
        const code = externalNumber(result.data, [
          "state",
          "data.state",
          "delivery.state",
          "currentStatus.code",
        ]);
        if (code === undefined)
          return { ok: false, error: "tracking_state_unavailable" };
        const mapped = bostaStatus(code);
        const exceptionReason = externalValue(result.data, [
          "exceptionReason",
          "data.exceptionReason",
          "delivery.exceptionReason",
        ]);
        const promisedDate = externalValue(result.data, [
          "deliveryPromiseDate",
          "data.deliveryPromiseDate",
          "delivery.deliveryPromiseDate",
        ]);
        setOrders((items) =>
          items.map((item) => {
            if (item.id !== orderId) return item;
            if (
              item.externalStateCode === code &&
              item.exceptionReason === exceptionReason &&
              item.promisedDate === promisedDate
            ) {
              return item;
            }
            return {
              ...item,
              status: mapped.status,
              trackingUrl: item.trackingNumber
                ? bostaPublicTrackingUrl(item.trackingNumber)
                : item.trackingUrl,
              externalStateCode: code,
              exceptionReason,
              promisedDate,
              updatedAt: new Date().toISOString(),
              events:
                item.externalStateCode === code
                  ? item.events
                  : [
                      eventFor(
                        mapped.status,
                        mapped.label,
                        "bosta",
                        code,
                        exceptionReason,
                      ),
                      ...item.events,
                    ],
            };
          }),
        );
        return { ok: true };
      },
      [],
    );

  useEffect(() => {
    if (
      !auth.isAuthenticated ||
      !bostaConfig.enabled ||
      bostaConfig.autoTrackingEnabled === false
    ) {
      return;
    }
    let cancelled = false;
    let syncing = false;
    const syncActiveOrders = async () => {
      if (cancelled || syncing || !apiInternetAvailable()) return;
      syncing = true;
      try {
        const active = ordersRef.current.filter(
          (order) =>
            order.providerId === BOSTA_PROVIDER_ID &&
            Boolean(order.trackingNumber || order.externalShipmentId) &&
            !["delivered", "returned", "cancelled"].includes(order.status),
        );
        for (const order of active) {
          if (cancelled) break;
          await refreshBostaTracking(order.id);
        }
      } finally {
        syncing = false;
      }
    };
    const startupTimer = window.setTimeout(() => {
      void syncActiveOrders();
    }, 2_000);
    const intervalMs =
      Math.max(2, bostaConfig.autoTrackingIntervalMinutes ?? 5) * 60_000;
    const interval = window.setInterval(() => {
      void syncActiveOrders();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [
    auth.isAuthenticated,
    bostaConfig.autoTrackingEnabled,
    bostaConfig.autoTrackingIntervalMinutes,
    bostaConfig.enabled,
    refreshBostaTracking,
  ]);

  useEffect(() => {
    if (
      !auth.isAuthenticated ||
      !bostaConfig.enabled ||
      !bostaConfig.webhookRelayReady
    ) {
      return;
    }
    const api = window.desktopAPI?.integrations?.bosta;
    if (!api) return;
    let cancelled = false;
    let polling = false;
    const pollWebhookEvents = async () => {
      if (cancelled || polling || !apiInternetAvailable()) return;
      polling = true;
      try {
        const response = await api.getWebhookEvents();
        if (!response.ok || cancelled) return;
        const data = response.data as
          | { events?: Array<{ id?: unknown; payload?: unknown }> }
          | undefined;
        const events = Array.isArray(data?.events) ? data.events : [];
        const acknowledgedIds = events
          .map((event) => String(event.id ?? ""))
          .filter((id) => /^[a-f0-9]{64}$/.test(id));
        setOrders((currentOrders) => {
          let nextOrders = currentOrders;
          for (const envelope of events) {
            if (!envelope.payload || typeof envelope.payload !== "object")
              continue;
            const payload = envelope.payload as Record<string, unknown>;
            const state = Number(payload.state);
            if (!Number.isInteger(state)) continue;
            const trackingNumber = String(payload.trackingNumber ?? "").trim();
            const externalId = String(payload._id ?? "").trim();
            const businessReference = String(
              payload.businessReference ?? "",
            ).trim();
            const mapped = bostaStatus(state);
            const exceptionReason = String(
              payload.exceptionReason ?? "",
            ).trim();
            const promisedDate = String(
              payload.deliveryPromiseDate ?? "",
            ).trim();
            nextOrders = nextOrders.map((order) => {
              const matches = Boolean(
                (trackingNumber && order.trackingNumber === trackingNumber) ||
                  (externalId && order.externalShipmentId === externalId) ||
                  (businessReference &&
                    order.invoiceNumber === businessReference),
              );
              if (!matches) return order;
              const changed =
                order.externalStateCode !== state ||
                order.exceptionReason !== (exceptionReason || undefined) ||
                order.promisedDate !== (promisedDate || undefined);
              if (!changed) return order;
              return {
                ...order,
                status: mapped.status,
                externalStateCode: state,
                exceptionReason: exceptionReason || undefined,
                promisedDate: promisedDate || undefined,
                updatedAt: new Date().toISOString(),
                events: [
                  eventFor(
                    mapped.status,
                    mapped.label,
                    "bosta",
                    state,
                    exceptionReason || undefined,
                  ),
                  ...order.events,
                ],
              };
            });
          }
          return nextOrders;
        });
        if (acknowledgedIds.length > 0 && !cancelled) {
          await api.acknowledgeWebhookEvents(acknowledgedIds);
        }
      } catch {
        // The regular API polling remains active as a safe fallback.
      } finally {
        polling = false;
      }
    };
    const startupTimer = window.setTimeout(() => {
      void pollWebhookEvents();
    }, 1_500);
    const interval = window.setInterval(() => {
      void pollWebhookEvents();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [
    auth.isAuthenticated,
    bostaConfig.enabled,
    bostaConfig.webhookRelayReady,
  ]);

  const getBostaCities: ShippingContextValue["getBostaCities"] =
    useCallback(async () => {
      if (!apiInternetAvailable())
        return { ok: false, error: "internet_required" };
      const result = await window.desktopAPI?.integrations?.bosta.getCities();
      if (!result) return { ok: false, error: "desktop_required" };
      if (!result.ok) return { ok: false, error: result.error };
      const payload = result.data as
        { data?: { list?: unknown[] } | unknown[] } | undefined;
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(
              (payload?.data as { list?: unknown[] } | undefined)?.list,
            )
          ? (payload?.data as { list: unknown[] }).list
          : [];
      const cities = rows.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const item = row as Record<string, unknown>;
        const id = String(item._id ?? item.id ?? "");
        const name = String(item.name ?? "");
        if (!id || !name) return [];
        return [
          {
            id,
            name,
            nameAr: String(item.nameAr ?? "") || undefined,
          },
        ];
      });
      return { ok: true, cities };
    }, []);

  const getBostaDistricts: ShippingContextValue["getBostaDistricts"] =
    useCallback(async (cityId) => {
      if (!apiInternetAvailable())
        return { ok: false, error: "internet_required" };
      const result =
        await window.desktopAPI?.integrations?.bosta.getDistricts(cityId);
      if (!result) return { ok: false, error: "desktop_required" };
      if (!result.ok) return { ok: false, error: result.error };
      const payload = result.data as
        { data?: unknown[] | { list?: unknown[] } } | undefined;
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(
              (payload?.data as { list?: unknown[] } | undefined)?.list,
            )
          ? (payload?.data as { list: unknown[] }).list
          : [];
      const districts = rows.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const item = row as Record<string, unknown>;
        const id = String(
          item.districtId ?? item.districtI ?? item._id ?? item.id ?? "",
        );
        const name = String(item.districtName ?? item.name ?? "");
        if (!id || !name) return [];
        return [
          {
            id,
            name,
            nameAr:
              String(item.districtOtherName ?? item.nameAr ?? "") || undefined,
            zoneId: String(item.zoneId ?? "") || undefined,
            zoneName: String(item.zoneName ?? "") || undefined,
            zoneNameAr:
              String(item.zoneOtherName ?? item.zoneNameAr ?? "") || undefined,
          },
        ];
      });
      return { ok: true, districts };
    }, []);

  const estimateBostaPrice: ShippingContextValue["estimateBostaPrice"] =
    useCallback(async (input) => {
      if (!apiInternetAvailable())
        return { ok: false, error: "internet_required" };
      const result =
        await window.desktopAPI?.integrations?.bosta.estimatePrice(input);
      if (!result) return { ok: false, error: "desktop_required" };
      if (!result.ok) return { ok: false, error: result.error };
      const fee = externalNumber(result.data, [
        "data.shippingFee",
        "shippingFee",
      ]);
      const currency = externalValue(result.data, [
        "data.currency",
        "currency",
      ]);
      return Number.isFinite(fee)
        ? { ok: true, fee, currency }
        : { ok: false, error: "price_unavailable" };
    }, []);

  const getBostaPricingPlan: ShippingContextValue["getBostaPricingPlan"] =
    useCallback(async (input) => {
      if (!apiInternetAvailable())
        return { ok: false, error: "internet_required" };
      try {
        const result =
          await window.desktopAPI?.integrations?.bosta.getPricingPlan(input);
        if (!result) return { ok: false, error: "desktop_restart_required" };
        return result.ok
          ? { ok: true, data: result.data }
          : { ok: false, error: result.error };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        return {
          ok: false,
          error: /No handler registered/i.test(message)
            ? "desktop_restart_required"
            : "bosta_request_failed",
        };
      }
    }, []);

  const value = useMemo<ShippingContextValue>(
    () => ({
      providers,
      rates,
      orders,
      bostaConfig,
      addProvider,
      updateProvider,
      addRate,
      updateRate,
      deleteRate,
      rateForAddress,
      createDeliveryOrder,
      updateOrder,
      setOrderStatus,
      settleOrderCod,
      saveBostaConfig,
      testBostaConnection,
      submitOrderToBosta,
      refreshBostaTracking,
      getBostaCities,
      getBostaDistricts,
      estimateBostaPrice,
      getBostaPricingPlan,
      reloadShippingData,
    }),
    [
      providers,
      rates,
      orders,
      bostaConfig,
      addProvider,
      updateProvider,
      addRate,
      updateRate,
      deleteRate,
      rateForAddress,
      createDeliveryOrder,
      updateOrder,
      setOrderStatus,
      settleOrderCod,
      saveBostaConfig,
      testBostaConnection,
      submitOrderToBosta,
      refreshBostaTracking,
      getBostaCities,
      getBostaDistricts,
      estimateBostaPrice,
      getBostaPricingPlan,
      reloadShippingData,
    ],
  );

  return (
    <ShippingContext.Provider value={value}>
      {children}
    </ShippingContext.Provider>
  );
}

export function useShipping(): ShippingContextValue {
  const context = useContext(ShippingContext);
  if (!context)
    throw new Error("useShipping must be used within ShippingProvider");
  return context;
}
