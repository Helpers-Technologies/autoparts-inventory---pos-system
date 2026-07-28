import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  Eye,
  ExternalLink,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Truck,
} from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { useShipping, BOSTA_PROVIDER_ID } from "../store/ShippingContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import {
  bostaPublicTrackingUrl,
  DELIVERY_STATUS_LABELS,
  translateBostaError,
} from "../lib/shipping";
import { EGYPT_GOVERNORATES } from "../lib/egyptLocations";
import {
  BOSTA_PRICING_SECTORS,
  extractBostaPricingRows,
} from "../lib/bostaPricing";
import { ShippingProviderLogo } from "../features/shipping/ShippingProviderLogo";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  PAYMENT_METHOD_LABELS,
} from "../lib/format";
import type {
  DeliveryOrder,
  DeliveryOrderStatus,
  PaymentMethod,
  ShippingProvider,
  ShippingRate,
} from "../types";
import { useFeatures } from "../lib/useFeatures";

type Tab = "orders" | "pricing" | "reports";

const STATUS_TONE: Record<
  DeliveryOrderStatus,
  "slate" | "blue" | "green" | "amber" | "red"
> = {
  draft: "slate",
  ready: "blue",
  assigned: "blue",
  pickup_requested: "blue",
  picked_up: "blue",
  in_transit: "amber",
  out_for_delivery: "amber",
  delivered: "green",
  exception: "red",
  returned: "red",
  cancelled: "slate",
};

const OPERATIONAL_STATUSES: DeliveryOrderStatus[] = [
  "ready",
  "assigned",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "returned",
  "cancelled",
];

function orderTrackingUrl(order: DeliveryOrder): string | undefined {
  const isBosta =
    order.providerId === BOSTA_PROVIDER_ID || order.providerName === "Bosta";
  return isBosta && order.trackingNumber
    ? bostaPublicTrackingUrl(order.trackingNumber)
    : order.trackingUrl;
}

export function ShippingManagementPage() {
  const navigate = useNavigate();
  const shipping = useShipping();
  const { isEnabled } = useFeatures();
  const bostaIntegrationEnabled = isEnabled("bostaIntegration");
  const { settings } = useSettings();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("orders");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | DeliveryOrderStatus>("all");
  const [method, setMethod] = useState<"all" | DeliveryOrder["method"]>("all");
  const [providerId, setProviderId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [settlementOrder, setSettlementOrder] = useState<DeliveryOrder | null>(
    null,
  );
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [bostaSendError, setBostaSendError] = useState<string | null>(null);
  const [settlementMethod, setSettlementMethod] =
    useState<PaymentMethod>("cash");
  const selectedOrder = selectedOrderId
    ? shipping.orders.find((order) => order.id === selectedOrderId)
    : undefined;
  const availableProviders = useMemo(
    () =>
      shipping.providers.filter(
        (provider) => provider.kind !== "bosta" || bostaIntegrationEnabled,
      ),
    [bostaIntegrationEnabled, shipping.providers],
  );

  const filteredOrders = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("ar-EG");
    return shipping.orders
      .filter((order) => {
        if (status !== "all" && order.status !== status) return false;
        if (method !== "all" && order.method !== method) return false;
        if (providerId !== "all" && order.providerId !== providerId)
          return false;
        if (dateFrom && order.createdAt.slice(0, 10) < dateFrom) return false;
        if (dateTo && order.createdAt.slice(0, 10) > dateTo) return false;
        if (!term) return true;
        return [
          order.orderNumber,
          order.invoiceNumber,
          order.customerName,
          order.address.phone,
          order.address.governorate,
          order.address.city,
          order.trackingNumber,
        ].some((value) =>
          String(value ?? "")
            .toLocaleLowerCase("ar-EG")
            .includes(term),
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [shipping.orders, query, status, method, providerId, dateFrom, dateTo]);

  const metrics = useMemo(() => {
    const total = filteredOrders.length;
    const delivered = filteredOrders.filter(
      (item) => item.status === "delivered",
    ).length;
    const active = filteredOrders.filter(
      (item) => !["delivered", "returned", "cancelled"].includes(item.status),
    ).length;
    const exceptions = filteredOrders.filter(
      (item) => item.status === "exception",
    ).length;
    const fees = filteredOrders.reduce(
      (sum, item) => sum + item.shippingFee,
      0,
    );
    const cod = filteredOrders.reduce((sum, item) => sum + item.codAmount, 0);
    const settledCod = filteredOrders.reduce(
      (sum, item) => sum + (item.codSettledAmount ?? 0),
      0,
    );
    return {
      total,
      delivered,
      active,
      exceptions,
      fees,
      cod,
      settledCod,
      outstandingCod: Math.max(0, cod - settledCod),
      successRate: total ? Math.round((delivered / total) * 100) : 0,
    };
  }, [filteredOrders]);

  async function submitBosta(order: DeliveryOrder) {
    setBusyOrderId(order.id);
    try {
      const result = await shipping.submitOrderToBosta(order.id);
      if (!result.ok) {
        setBostaSendError(result.error ?? "bosta_request_failed");
        return;
      }
      toast.success(
        "تم إنشاء شحنة بوسطة",
        "سيظهر رقم التتبع فور رجوعه من الشركة",
      );
    } catch {
      setBostaSendError("network_error");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function refreshTracking(order: DeliveryOrder) {
    setBusyOrderId(order.id);
    try {
      const result = await shipping.refreshBostaTracking(order.id);
      if (!result.ok)
        return toast.error("تعذر تحديث التتبع", shippingError(result.error));
      toast.success("تم تحديث حالة الشحنة");
    } catch {
      toast.error(
        "تعذر تحديث التتبع",
        "تعذر الوصول لخدمة الربط؛ أعد تشغيل التطبيق ثم حاول مرة أخرى",
      );
    } finally {
      setBusyOrderId(null);
    }
  }

  function settleCod() {
    if (!settlementOrder) return;
    const result = shipping.settleOrderCod(
      settlementOrder.id,
      settlementMethod,
    );
    if (!result.ok)
      return toast.error("تعذر توريد التحصيل", shippingError(result.error));
    toast.success(
      "تم توريد مبلغ التحصيل",
      formatCurrency(result.amount ?? 0, settings.currency),
    );
    setSettlementOrder(null);
  }

  function exportReport() {
    const header = [
      "أمر التوصيل",
      "الفاتورة",
      "العميل",
      "الطريقة",
      "الشركة/السائق",
      "المحافظة",
      "المدينة",
      "رسوم التوصيل",
      "تحصيل عند التسليم",
      "التحصيل المورّد",
      "تاريخ التوريد",
      "الحالة",
      "رقم التتبع",
    ];
    const rows = filteredOrders.map((order) => [
      order.orderNumber,
      order.invoiceNumber,
      order.customerName,
      order.method === "branch_driver" ? "سائق الفرع" : "شركة شحن",
      order.driverName || order.providerName || "",
      order.address.governorate,
      order.address.city,
      order.shippingFee,
      order.codAmount,
      order.codSettledAmount ?? 0,
      order.codSettledAt ?? "",
      DELIVERY_STATUS_LABELS[order.status],
      order.trackingNumber || "",
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `delivery-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="إدارة التوصيل والشحن"
        description="أوامر توصيل سائقين الفرع وشركات الشحن والأسعار والتتبع والتقارير التشغيلية."
        actions={
          <Button variant="outline" onClick={exportReport}>
            <Download className="w-4 h-4" /> تصدير التقرير
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Metric
          icon={<PackageCheck className="h-4 w-4" />}
          label="إجمالي الأوامر"
          value={String(metrics.total)}
          tone="blue"
        />
        <Metric
          icon={<Truck className="h-4 w-4" />}
          label="قيد التوصيل"
          value={String(metrics.active)}
          tone="amber"
        />
        <Metric
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="تم التسليم"
          value={String(metrics.delivered)}
          tone="green"
        />
        <Metric
          icon={<Clock3 className="h-4 w-4" />}
          label="تحتاج متابعة"
          value={String(metrics.exceptions)}
          tone="red"
        />
        <Metric
          icon={<BarChart3 className="h-4 w-4" />}
          label="نسبة النجاح"
          value={`${metrics.successRate}%`}
          tone="indigo"
        />
      </div>

      <Card>
        <CardBody className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-surface-muted p-1">
              <TabButton
                active={tab === "orders"}
                onClick={() => setTab("orders")}
              >
                أوامر التوصيل
              </TabButton>
              <TabButton
                active={tab === "pricing"}
                onClick={() => setTab("pricing")}
              >
                الشركات والأسعار
              </TabButton>
              <TabButton
                active={tab === "reports"}
                onClick={() => setTab("reports")}
              >
                تقارير الشحن
              </TabButton>
            </div>
            {tab === "pricing" ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setProviderOpen(true)}>
                  <Plus className="w-4 h-4" /> شركة شحن
                </Button>
                <Button onClick={() => setRateOpen(true)}>
                  <Plus className="w-4 h-4" /> سعر منطقة
                </Button>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {tab !== "pricing" ? (
        <Card>
          <CardBody className="p-3">
            <div className="grid grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(120px,.7fr))] gap-2">
              <div className="relative col-span-2 lg:col-span-1">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="فاتورة، عميل، هاتف أو رقم تتبع..."
                  className="pr-9"
                />
              </div>
              <Select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as typeof status)
                }
              >
                <option value="all">كل الحالات</option>
                {Object.entries(DELIVERY_STATUS_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </Select>
              <Select
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as typeof method)
                }
              >
                <option value="all">كل طرق التوصيل</option>
                <option value="branch_driver">سائق الفرع</option>
                <option value="shipping_company">شركة شحن</option>
              </Select>
              <Select
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
              >
                <option value="all">كل شركات الشحن</option>
                {availableProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </Select>
              <Field label="من تاريخ إنشاء الطلب">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </Field>
              <Field label="إلى تاريخ إنشاء الطلب">
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </Field>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {tab === "orders" ? (
        <OrdersTable
          orders={filteredOrders}
          busyOrderId={busyOrderId}
          bostaEnabled={
            bostaIntegrationEnabled && shipping.bostaConfig.enabled && shipping.bostaConfig.configured
          }
          onSubmitBosta={submitBosta}
          onRefresh={refreshTracking}
          onSettle={setSettlementOrder}
          onView={(order) => setSelectedOrderId(order.id)}
          onStatus={(id, next) =>
            shipping.setOrderStatus(id, next, DELIVERY_STATUS_LABELS[next])
          }
        />
      ) : tab === "pricing" ? (
        <PricingPanel
          providers={availableProviders}
          rates={shipping.rates}
          bostaConfigured={shipping.bostaConfig.configured}
          bostaIntegrationEnabled={bostaIntegrationEnabled}
          getBostaPricingPlan={shipping.getBostaPricingPlan}
          onToggle={(id, active) => shipping.updateProvider(id, { active })}
          onDeleteRate={shipping.deleteRate}
          currency={settings.currency}
        />
      ) : (
        <ReportsPanel
          metrics={metrics}
          orders={filteredOrders}
          currency={settings.currency}
          providers={availableProviders}
        />
      )}

      <ProviderDialog
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        onSave={(input) => {
          shipping.addProvider(input);
          setProviderOpen(false);
          toast.success("تمت إضافة شركة الشحن");
        }}
      />
      <RateDialog
        open={rateOpen}
        providers={availableProviders.filter((item) => item.active)}
        onClose={() => setRateOpen(false)}
        onSave={(input) => {
          shipping.addRate(input);
          setRateOpen(false);
          toast.success("تمت إضافة سعر المنطقة");
        }}
      />
      <BostaSendErrorDialog
        error={bostaSendError}
        onClose={() => setBostaSendError(null)}
      />
      <Dialog
        open={Boolean(selectedOrder)}
        onClose={() => setSelectedOrderId(null)}
        title={selectedOrder ? `تفاصيل أمر التوصيل ${selectedOrder.orderNumber}` : "تفاصيل أمر التوصيل"}
        subtitle="بيانات العميل والشحنة والتحصيل وسجل التتبع"
        width="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setSelectedOrderId(null)}>
              إغلاق
            </Button>
            {selectedOrder ? (
              <Button onClick={() => navigate(`/sales/${selectedOrder.invoiceId}`)}>
                عرض الفاتورة {selectedOrder.invoiceNumber}
              </Button>
            ) : null}
          </>
        }
      >
        {selectedOrder ? (
          <OrderDetails order={selectedOrder} currency={settings.currency} />
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(settlementOrder)}
        onClose={() => setSettlementOrder(null)}
        title="تأكيد توريد التحصيل"
        footer={
          <>
            <Button variant="outline" onClick={() => setSettlementOrder(null)}>
              إلغاء
            </Button>
            <Button onClick={settleCod}>تأكيد التوريد</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface-muted/40 p-4 text-sm">
            <div className="text-ink-muted">
              المبلغ الذي سيُضاف إلى تحصيل الفاتورة والخزنة
            </div>
            <div className="mt-2 text-2xl font-bold text-ink">
              {formatCurrency(
                settlementOrder?.codAmount ?? 0,
                settings.currency,
              )}
            </div>
          </div>
          <Field label="طريقة استلام التوريد">
            <Select
              value={settlementMethod}
              onChange={(event) =>
                setSettlementMethod(event.target.value as PaymentMethod)
              }
            >
              {(
                Object.entries(PAYMENT_METHOD_LABELS).filter(
                  ([key]) => key !== "credit",
                ) as [PaymentMethod, string][]
              ).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-ink-muted">
            التسليم وحده لا يُدخل المبلغ للخزنة. هذا الإجراء يُستخدم بعد استلام
            التوريد فعليًا من السائق أو شركة الشحن.
          </p>
        </div>
      </Dialog>
    </>
  );
}

function BostaSendErrorDialog({
  error,
  onClose,
}: {
  error: string | null;
  onClose: () => void;
}) {
  const bundleRequired = /active bundle subscription|required to create orders|bundle subscription/i.test(
    error ?? "",
  );
  const message = translateBostaError(error ?? undefined);
  return (
    <Dialog
      open={Boolean(error)}
      onClose={onClose}
      title={bundleRequired ? "لا توجد باقة شحن نشطة" : "تعذر إرسال الشحنة إلى بوسطة"}
      subtitle="لم يتم إنشاء الشحنة ولم يتغير الأوردر داخل النظام"
      width="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          {bundleRequired ? (
            <Button
              onClick={() =>
                window.open(
                  "https://bosta.co/en-eg/pricing",
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              فتح باقات بوسطة <ExternalLink className="h-4 w-4" />
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/5 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-bold text-ink">لم يتم إرسال الشحنة</div>
            <div className="mt-1 text-xs font-medium leading-6 text-ink-muted">
              {message}
            </div>
          </div>
        </div>

        {bundleRequired ? (
          <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
            <div className="mb-2 text-xs font-bold text-ink">لحل المشكلة:</div>
            <ol className="space-y-2 text-xs leading-5 text-ink-muted">
              <li className="flex gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">1</span>
                افتح حسابك في بوسطة وفعّل أو اشترِ باقة شحن.
              </li>
              <li className="flex gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">2</span>
                إذا كانت لديك باقة بالفعل، تواصل مع دعم بوسطة لتفعيل إنشاء الطلبات عبر الربط الإلكتروني.
              </li>
              <li className="flex gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">3</span>
                بعد التفعيل ارجع واضغط «إرسال إلى بوسطة» مرة أخرى.
              </li>
            </ol>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function OrdersTable({
  orders,
  busyOrderId,
  bostaEnabled,
  onSubmitBosta,
  onRefresh,
  onSettle,
  onView,
  onStatus,
}: {
  orders: DeliveryOrder[];
  busyOrderId: string | null;
  bostaEnabled: boolean;
  onSubmitBosta: (order: DeliveryOrder) => void;
  onRefresh: (order: DeliveryOrder) => void;
  onSettle: (order: DeliveryOrder) => void;
  onView: (order: DeliveryOrder) => void;
  onStatus: (id: string, status: DeliveryOrderStatus) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="أوامر التوصيل"
        subtitle={`عرض ${orders.length} أمر حسب الفلاتر الحالية`}
      />
      <CardBody className="p-0">
        {orders.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-6 w-6" />}
            title="لا توجد أوامر توصيل"
            description="أوامر التوصيل التي ينشئها الكاشير ستظهر هنا تلقائيًا."
          />
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-surface-muted text-xs text-ink-muted">
                <tr>
                  <th className="p-3 text-right">الأمر / الفاتورة</th>
                  <th className="p-3 text-right">العميل والعنوان</th>
                  <th className="p-3 text-right">جهة التوصيل</th>
                  <th className="p-3 text-right">القيمة والتحصيل</th>
                  <th className="p-3 text-right">الحالة</th>
                  <th className="p-3 text-right">التتبع</th>
                  <th className="p-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-line align-top">
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => onView(order)}
                        className="font-mono font-bold text-brand-600 transition hover:text-brand-700 hover:underline"
                        title="عرض تفاصيل أمر التوصيل"
                      >
                        {order.orderNumber}
                      </button>
                      <div className="text-xs text-brand-600">
                        {order.invoiceNumber}
                      </div>
                      <div className="mt-1 text-[11px] text-ink-faint">
                        {formatDate(order.createdAt)}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-ink">
                        {order.customerName}
                      </div>
                      <div className="mt-1 max-w-xs text-xs text-ink-muted">
                        {order.address.governorate}، {order.address.city}
                        {order.address.district
                          ? `، ${order.address.district}`
                          : ""}{" "}
                        — {order.address.addressLine}
                      </div>
                      <div
                        className="mt-1 font-mono text-xs text-ink-faint"
                        dir="ltr"
                      >
                        {order.address.phone}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge
                        tone={
                          order.method === "branch_driver" ? "blue" : "slate"
                        }
                      >
                        {order.method === "branch_driver"
                          ? "سائق الفرع"
                          : "شركة شحن"}
                      </Badge>
                      <div className="mt-2 font-semibold text-ink">
                        {order.driverName || order.providerName || "غير محدد"}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-ink">
                        رسوم: {formatCurrency(order.shippingFee)}
                      </div>
                      <div className="mt-1 text-xs text-ink-muted">
                        التحصيل عند التسليم: {formatCurrency(order.codAmount)}
                      </div>
                      {order.codSettledAt ? (
                        <Badge className="mt-2" tone="green">
                          تم توريد التحصيل
                        </Badge>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <Select
                        value={order.status}
                        onChange={(event) =>
                          onStatus(
                            order.id,
                            event.target.value as DeliveryOrderStatus,
                          )
                        }
                        className="min-w-[150px]"
                      >
                        {OPERATIONAL_STATUSES.map((item) => (
                          <option key={item} value={item}>
                            {DELIVERY_STATUS_LABELS[item]}
                          </option>
                        ))}
                      </Select>
                      <Badge className="mt-2" tone={STATUS_TONE[order.status]}>
                        {DELIVERY_STATUS_LABELS[order.status]}
                      </Badge>
                      {order.exceptionReason ? (
                        <div className="mt-2 max-w-[220px] text-xs text-red-600">
                          {order.exceptionReason}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {order.trackingNumber ? (
                        <>
                          <div className="font-mono font-bold text-ink">
                            {order.trackingNumber}
                          </div>
                          {orderTrackingUrl(order) ? (
                            <a
                              href={orderTrackingUrl(order)}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600"
                            >
                              فتح التتبع <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-ink-faint">
                          لم يُرسل للشركة بعد
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onView(order)}
                        >
                          <Eye className="h-3.5 w-3.5" /> عرض التفاصيل
                        </Button>
                        {order.providerId === BOSTA_PROVIDER_ID ||
                        order.providerName === "Bosta" ? (
                          order.trackingNumber ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyOrderId === order.id}
                              onClick={() => onRefresh(order)}
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${busyOrderId === order.id ? "animate-spin" : ""}`}
                              />{" "}
                              تحديث
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={
                                !bostaEnabled || busyOrderId === order.id
                              }
                              onClick={() => onSubmitBosta(order)}
                            >
                              <Truck className="h-3.5 w-3.5" /> إرسال إلى بوسطة
                            </Button>
                          )
                        ) : null}
                        {order.status === "delivered" &&
                        order.codAmount > 0 &&
                        !order.codSettledAt ? (
                          <Button size="sm" onClick={() => onSettle(order)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> تأكيد توريد
                            التحصيل
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function OrderDetails({
  order,
  currency,
}: {
  order: DeliveryOrder;
  currency: string;
}) {
  const outstandingCod = Math.max(
    0,
    order.codAmount - (order.codSettledAmount ?? 0),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-muted/35 px-3 py-2.5">
        <div>
          <div className="font-mono text-base font-black text-ink">
            {order.orderNumber}
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            أُنشئ {formatDateTime(order.createdAt)} · الفاتورة {order.invoiceNumber}
          </div>
        </div>
        <Badge tone={STATUS_TONE[order.status]}>
          {DELIVERY_STATUS_LABELS[order.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <DetailBlock title="العميل وعنوان التسليم">
          <div className="font-bold text-ink">{order.customerName}</div>
          <div className="mt-1 text-xs leading-6 text-ink-muted">
            {order.address.recipientName && order.address.recipientName !== order.customerName
              ? `المستلم: ${order.address.recipientName} · `
              : ""}
            {order.address.phone}
            <br />
            {order.address.governorate}، {order.address.city}
            {order.address.district ? `، ${order.address.district}` : ""} — {order.address.addressLine}
          </div>
        </DetailBlock>
        <DetailBlock title="جهة التوصيل والتتبع">
          <div className="font-bold text-ink">
            {order.method === "branch_driver" ? "سائق الفرع" : "شركة شحن"} — {order.driverName || order.providerName || "غير محدد"}
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            رقم التتبع: <span className="font-mono text-ink">{order.trackingNumber || "لم يصدر بعد"}</span>
          </div>
          {orderTrackingUrl(order) ? (
            <a href={orderTrackingUrl(order)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              فتح التتبع الخارجي <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </DetailBlock>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <DetailValue label="رسوم التوصيل" value={formatCurrency(order.shippingFee, currency)} />
        <DetailValue label="تحصيل عند التسليم" value={formatCurrency(order.codAmount, currency)} />
        <DetailValue label="تم توريده" value={formatCurrency(order.codSettledAmount ?? 0, currency)} />
        <DetailValue label="متبقي التوريد" value={formatCurrency(outstandingCod, currency)} highlight={outstandingCod > 0} />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <DetailValue label="حجم الطرد" value={order.packageType || "غير محدد"} />
        <DetailValue label="عدد القطع" value={String(order.itemsCount ?? "—")} />
        <DetailValue label="فتح الطرد" value={order.allowOpenPackage ? "مسموح" : "غير مسموح"} />
        <DetailValue label="الفرع" value={order.branchName || "الفرع الرئيسي"} />
      </div>

      {order.notes || order.exceptionReason ? (
        <DetailBlock title={order.exceptionReason ? "مشكلة تحتاج متابعة" : "ملاحظات الشحن"} danger={Boolean(order.exceptionReason)}>
          {order.exceptionReason || order.notes}
        </DetailBlock>
      ) : null}

      <div className="rounded-xl border border-line">
        <div className="border-b border-line px-3 py-2 text-sm font-bold text-ink">
          سجل حالة الأوردر
        </div>
        <div className="max-h-56 divide-y divide-line overflow-auto">
          {order.events.length ? order.events.map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs">
              <div>
                <div className="font-semibold text-ink">{event.label}</div>
                {event.note ? <div className="mt-0.5 text-ink-muted">{event.note}</div> : null}
              </div>
              <div className="shrink-0 text-left text-[11px] text-ink-faint">
                {formatDateTime(event.occurredAt)}
                <div>{event.source === "bosta" ? "بوسطة" : event.source === "user" ? "المستخدم" : "النظام"}</div>
              </div>
            </div>
          )) : (
            <div className="px-3 py-5 text-center text-xs text-ink-faint">لا توجد تحديثات بعد</div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailBlock({
  title,
  children,
  danger = false,
}: {
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${danger ? "border-red-500/30 bg-red-500/5" : "border-line bg-surface"}`}>
      <div className={`mb-1.5 text-xs font-semibold ${danger ? "text-red-600" : "text-ink-muted"}`}>{title}</div>
      <div className="text-sm text-ink">{children}</div>
    </div>
  );
}

function DetailValue({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? "border-amber-500/35 bg-amber-500/5" : "border-line bg-surface-muted/25"}`}>
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className={`mt-1 text-sm font-bold ${highlight ? "text-amber-600" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function PricingPanel({
  providers,
  rates,
  bostaConfigured,
  bostaIntegrationEnabled,
  getBostaPricingPlan,
  onToggle,
  onDeleteRate,
  currency,
}: {
  providers: ShippingProvider[];
  rates: ShippingRate[];
  bostaConfigured: boolean;
  bostaIntegrationEnabled: boolean;
  getBostaPricingPlan: ReturnType<typeof useShipping>["getBostaPricingPlan"];
  onToggle: (id: string, active: boolean) => void;
  onDeleteRate: (id: string) => void;
  currency: string;
}) {
  const [tierIdSelector, setTierIdSelector] = useState<
    "c__CT4DU9I" | "yiqKg_aGM1"
  >("c__CT4DU9I");
  const [pickupSectorId, setPickupSectorId] = useState(1);
  const [vatIncluded, setVatIncluded] = useState(false);
  const [pricingData, setPricingData] = useState<unknown>();
  const [pricingError, setPricingError] = useState("");
  const [pricingLoading, setPricingLoading] = useState(false);
  const [priceRouteFilter, setPriceRouteFilter] = useState("all");
  const [priceServiceFilter, setPriceServiceFilter] = useState("all");
  const [priceSizeFilter, setPriceSizeFilter] = useState("all");
  const [priceSearch, setPriceSearch] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [priceSort, setPriceSort] = useState<
    "default" | "priceAsc" | "priceDesc" | "route"
  >("default");
  const [advancedPriceFiltersOpen, setAdvancedPriceFiltersOpen] =
    useState(false);

  const loadBostaPricing = async () => {
    if (!bostaConfigured || pricingLoading) return;
    setPricingLoading(true);
    setPricingError("");
    const result = await getBostaPricingPlan({
      tierIdSelector,
      pickupSectorId,
      vatIncluded,
    });
    if (result.ok) setPricingData(result.data);
    else setPricingError(translateBostaError(result.error));
    setPricingLoading(false);
  };

  useEffect(() => {
    void loadBostaPricing();
    // Refreshing is intentionally tied to the selected API plan inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierIdSelector, pickupSectorId, vatIncluded, bostaConfigured]);

  const apiPrices = useMemo(
    () => extractBostaPricingRows(pricingData),
    [pricingData],
  );
  const priceRoutes = useMemo(
    () => Array.from(new Set(apiPrices.map((row) => row.route))),
    [apiPrices],
  );
  const priceServices = useMemo(
    () => Array.from(new Set(apiPrices.map((row) => row.service))),
    [apiPrices],
  );
  const priceSizes = useMemo(
    () => Array.from(new Set(apiPrices.map((row) => row.size))),
    [apiPrices],
  );
  const filteredApiPrices = useMemo(
    () => {
      const search = priceSearch.trim().toLocaleLowerCase("ar-EG");
      const min = priceMin.trim() === "" ? undefined : Number(priceMin);
      const max = priceMax.trim() === "" ? undefined : Number(priceMax);
      const filtered = apiPrices.filter(
        (row) =>
          (priceRouteFilter === "all" || row.route === priceRouteFilter) &&
          (priceServiceFilter === "all" ||
            row.service === priceServiceFilter) &&
          (priceSizeFilter === "all" || row.size === priceSizeFilter) &&
          (!search ||
            [row.route, row.service, row.size].some((value) =>
              value.toLocaleLowerCase("ar-EG").includes(search),
            )) &&
          (min === undefined || !Number.isFinite(min) || row.amount >= min) &&
          (max === undefined || !Number.isFinite(max) || row.amount <= max),
      );
      return filtered.sort((left, right) => {
        if (priceSort === "priceAsc") return left.amount - right.amount;
        if (priceSort === "priceDesc") return right.amount - left.amount;
        if (priceSort === "route")
          return left.route.localeCompare(right.route, "ar");
        return 0;
      });
    },
    [
      apiPrices,
      priceMax,
      priceMin,
      priceRouteFilter,
      priceSearch,
      priceServiceFilter,
      priceSizeFilter,
      priceSort,
    ],
  );
  const filteredPriceRange = useMemo(() => {
    if (filteredApiPrices.length === 0) return undefined;
    const amounts = filteredApiPrices.map((row) => row.amount);
    return { min: Math.min(...amounts), max: Math.max(...amounts) };
  }, [filteredApiPrices]);
  const activePriceFilters = [
    priceRouteFilter !== "all",
    priceServiceFilter !== "all",
    priceSizeFilter !== "all",
    Boolean(priceSearch.trim()),
    Boolean(priceMin.trim()),
    Boolean(priceMax.trim()),
    priceSort !== "default",
  ].filter(Boolean).length;

  const resetPriceFilters = () => {
    setPriceRouteFilter("all");
    setPriceServiceFilter("all");
    setPriceSizeFilter("all");
    setPriceSearch("");
    setPriceMin("");
    setPriceMax("");
    setPriceSort("default");
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-4">
      <Card>
        <CardHeader
          title="شركات الشحن"
          subtitle="فعّل الشركات التي تظهر للكاشير"
        />
        <CardBody className="space-y-2">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 rounded-xl border border-line p-3"
            >
              <div className="grid h-12 w-20 shrink-0 place-items-center rounded-xl border border-line bg-white p-2 dark:bg-slate-900">
                <ShippingProviderLogo provider={provider} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">
                  {provider.kind === "bosta" ? "بوسطة" : provider.name}
                </div>
                <div className="text-xs text-ink-faint">
                  {provider.kind === "bosta"
                    ? "ربط إلكتروني مباشر"
                    : "شركة شحن يدوية"}
                </div>
              </div>
              <input
                type="checkbox"
                checked={provider.active}
                onChange={(event) =>
                  onToggle(provider.id, event.target.checked)
                }
                className="h-4 w-4 accent-brand-600"
              />
            </div>
          ))}
        </CardBody>
      </Card>
      <div className="space-y-4">
        {bostaIntegrationEnabled ? <Card>
          <CardHeader
            title="أسعار بوسطة المباشرة"
            subtitle="تُسحب من خطة الأسعار الرسمية عبر الربط الإلكتروني ولا تحتاج إلى إدخال يدوي"
            actions={
              <Button
                size="sm"
                variant="outline"
                disabled={!bostaConfigured || pricingLoading}
                onClick={() => void loadBostaPricing()}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${pricingLoading ? "animate-spin" : ""}`}
                />
                تحديث الأسعار
              </Button>
            }
          />
          <CardBody className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold text-ink">
                    <SlidersHorizontal className="h-4 w-4 text-brand-600" />
                    إعداد وعرض الأسعار
                    {activePriceFilters > 0 ? (
                      <Badge tone="blue">{activePriceFilters} مفعّل</Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-faint">
                    منطقة الانطلاق ومنطقة التسليم مختلفتان؛ بوسطة تجمع المحافظات في قطاعات تسعير.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {activePriceFilters > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={resetPriceFilters}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> مسح الفلاتر
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant={advancedPriceFiltersOpen ? "primary" : "outline"}
                    onClick={() =>
                      setAdvancedPriceFiltersOpen((current) => !current)
                    }
                  >
                    فلاتر متقدمة
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${advancedPriceFiltersOpen ? "rotate-180" : ""}`}
                    />
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="باقة الأسعار">
                  <Select
                    value={tierIdSelector}
                    onChange={(event) =>
                      setTierIdSelector(
                        event.target.value as typeof tierIdSelector,
                      )
                    }
                  >
                    <option value="c__CT4DU9I">الباقة الأساسية</option>
                    <option value="yiqKg_aGM1">باقة الأعمال</option>
                  </Select>
                </Field>
                <Field
                  label="قطاع انطلاق الشحنة"
                  hint="حسب تقسيم تسعير بوسطة"
                >
                  <Select
                    value={pickupSectorId}
                    onChange={(event) =>
                      setPickupSectorId(Number(event.target.value))
                    }
                  >
                    {BOSTA_PRICING_SECTORS.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="relative self-end">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <Input
                    value={priceSearch}
                    onChange={(event) => setPriceSearch(event.target.value)}
                    placeholder="ابحث في الأسعار..."
                    className="pr-9"
                    aria-label="البحث في قائمة الأسعار"
                  />
                </div>
                <label className="flex min-h-[42px] items-center gap-2 self-end rounded-xl border border-line px-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={vatIncluded}
                    onChange={(event) => setVatIncluded(event.target.checked)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  شاملة ضريبة القيمة المضافة
                </label>
              </div>

              <div className="grid gap-2 border-t border-line px-3 py-3 sm:grid-cols-3">
                <Select
                  aria-label="تصفية حسب قطاع التسليم"
                  value={priceRouteFilter}
                  onChange={(event) => setPriceRouteFilter(event.target.value)}
                >
                  <option value="all">كل قطاعات التسليم</option>
                  {priceRoutes.map((route) => (
                    <option key={route} value={route}>
                      {route}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="تصفية حسب الخدمة"
                  value={priceServiceFilter}
                  onChange={(event) =>
                    setPriceServiceFilter(event.target.value)
                  }
                >
                  <option value="all">كل الخدمات</option>
                  {priceServices.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="تصفية حسب حجم الطرد"
                  value={priceSizeFilter}
                  onChange={(event) => setPriceSizeFilter(event.target.value)}
                >
                  <option value="all">كل أحجام الطرود</option>
                  {priceSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </div>

              {advancedPriceFiltersOpen ? (
                <div className="grid gap-2 border-t border-line bg-surface-muted/20 p-3 sm:grid-cols-3">
                  <Field label="أقل سعر">
                    <Input
                      type="number"
                      min="0"
                      value={priceMin}
                      onChange={(event) => setPriceMin(event.target.value)}
                      placeholder="من"
                    />
                  </Field>
                  <Field label="أعلى سعر">
                    <Input
                      type="number"
                      min="0"
                      value={priceMax}
                      onChange={(event) => setPriceMax(event.target.value)}
                      placeholder="إلى"
                    />
                  </Field>
                  <Field label="ترتيب النتائج">
                    <Select
                      value={priceSort}
                      onChange={(event) =>
                        setPriceSort(event.target.value as typeof priceSort)
                      }
                    >
                      <option value="default">الترتيب الافتراضي</option>
                      <option value="priceAsc">السعر: الأقل أولًا</option>
                      <option value="priceDesc">السعر: الأعلى أولًا</option>
                      <option value="route">قطاع التسليم</option>
                    </Select>
                  </Field>
                </div>
              ) : null}

              {apiPrices.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs">
                  <span className="text-ink-muted">
                    عرض <strong className="text-ink">{filteredApiPrices.length}</strong> من {apiPrices.length} سعر
                  </span>
                  {filteredPriceRange ? (
                    <span className="font-semibold text-ink">
                      نطاق الأسعار: {formatCurrency(filteredPriceRange.min, currency)}
                      {filteredPriceRange.min !== filteredPriceRange.max
                        ? ` — ${formatCurrency(filteredPriceRange.max, currency)}`
                        : ""}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            {!bostaConfigured ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600">
                اربط حساب بوسطة من مركز الربط والتكاملات أولًا لجلب أسعار حسابك.
              </div>
            ) : pricingError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">
                {pricingError}
              </div>
            ) : pricingLoading && apiPrices.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-muted">
                جارٍ جلب أسعار بوسطة…
              </div>
            ) : apiPrices.length > 0 ? (
              <div className="space-y-3">
                <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-xs text-ink-muted">
                      <tr>
                        <th className="p-3 text-right">قطاع التسليم</th>
                        <th className="p-3 text-right">حجم الطرد</th>
                        <th className="p-3 text-right">الخدمة</th>
                        <th className="p-3 text-right">السعر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredApiPrices.map((row) => (
                        <tr
                          key={row.id}
                          className="border-t border-line transition-colors hover:bg-surface-muted/35"
                        >
                          <td className="p-3 font-semibold text-ink">
                            {row.route}
                          </td>
                          <td className="p-3 font-medium text-ink">{row.size}</td>
                          <td className="p-3">
                            <Badge tone={row.service === "توصيل" ? "blue" : "slate"}>
                              {row.service}
                            </Badge>
                          </td>
                          <td className="p-3 text-base font-black text-brand-600">
                            {formatCurrency(row.amount, currency)}
                          </td>
                        </tr>
                      ))}
                      {filteredApiPrices.length === 0 ? (
                        <tr className="border-t border-line">
                          <td
                            colSpan={4}
                            className="p-8 text-center text-sm text-ink-muted"
                          >
                            لا توجد أسعار تطابق الفلاتر المحددة
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : pricingData ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600">
                استجابت بوسطة، لكن خطة الأسعار لا تحتوي أسعارًا قابلة للعرض لهذه الباقة والمنطقة.
              </div>
            ) : null}
          </CardBody>
        </Card> : null}

        <Card>
          <CardHeader
            title="الأسعار اليدوية والاستثنائية"
            subtitle="تُستخدم للشركات اليدوية أو كسعر مخصص لمدينة أو حي"
          />
          <CardBody className="p-0">
          {rates.length === 0 ? (
            <EmptyState
              icon={<MapPin className="h-6 w-6" />}
              title="لا توجد أسعار يدوية"
              description="أسعار بوسطة تُجلب أعلاه تلقائيًا. أضف هنا استثناءً فقط عند الحاجة."
            />
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-surface-muted text-xs text-ink-muted">
                  <tr>
                    <th className="p-3 text-right">الشركة</th>
                    <th className="p-3 text-right">المحافظة</th>
                    <th className="p-3 text-right">المدينة / الحي</th>
                    <th className="p-3 text-right">التوصيل</th>
                    <th className="p-3 text-right">رسوم التحصيل</th>
                    <th className="p-3 text-right">المدة</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((rate) => (
                    <tr key={rate.id} className="border-t border-line">
                      <td className="p-3 font-semibold">
                        {providers.find((item) => item.id === rate.providerId)
                          ?.name ?? "—"}
                      </td>
                      <td className="p-3">{rate.governorate}</td>
                      <td className="p-3">
                        {[rate.city, rate.district]
                          .filter(Boolean)
                          .join(" — ") || "كل المحافظة"}
                      </td>
                      <td className="p-3 font-bold">
                        {formatCurrency(rate.fee, currency)}
                      </td>
                      <td className="p-3">
                        {formatCurrency(rate.cashOnDeliveryFee ?? 0, currency)}
                      </td>
                      <td className="p-3">
                        {rate.estimatedDaysMin
                          ? `${rate.estimatedDaysMin}–${rate.estimatedDaysMax ?? rate.estimatedDaysMin} يوم`
                          : "—"}
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => onDeleteRate(rate.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ReportsPanel({
  metrics,
  orders,
  currency,
  providers,
}: {
  metrics: {
    fees: number;
    cod: number;
    settledCod: number;
    outstandingCod: number;
    successRate: number;
    total: number;
  };
  orders: DeliveryOrder[];
  currency: string;
  providers: ShippingProvider[];
}) {
  const byProvider = providers
    .map((provider) => {
      const rows = orders.filter((order) => order.providerId === provider.id);
      return {
        provider,
        count: rows.length,
        delivered: rows.filter((order) => order.status === "delivered").length,
        fees: rows.reduce((sum, order) => sum + order.shippingFee, 0),
      };
    })
    .filter((row) => row.count > 0);
  const driverRows = new Map<
    string,
    { name: string; count: number; delivered: number; fees: number }
  >();
  orders
    .filter((order) => order.method === "branch_driver")
    .forEach((order) => {
      const id = order.driverId || "unassigned";
      const row = driverRows.get(id) ?? {
        name: order.driverName || "غير معيّن",
        count: 0,
        delivered: 0,
        fees: 0,
      };
      row.count += 1;
      row.fees += order.shippingFee;
      if (order.status === "delivered") row.delivered += 1;
      driverRows.set(id, row);
    });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader title="ملخص مالي وتشغيلي" />
        <CardBody className="grid grid-cols-2 gap-3">
          <ReportValue
            label="رسوم التوصيل المحصلة"
            value={formatCurrency(metrics.fees, currency)}
          />
          <ReportValue
            label="تحصيل تم توريده"
            value={formatCurrency(metrics.settledCod, currency)}
          />
          <ReportValue
            label="تحصيل لم يُورّد بعد"
            value={formatCurrency(metrics.outstandingCod, currency)}
          />
          <ReportValue label="عدد الأوامر" value={String(metrics.total)} />
          <ReportValue label="نسبة التسليم" value={`${metrics.successRate}%`} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="أداء شركات الشحن" />
        <CardBody className="space-y-2">
          {byProvider.length ? (
            byProvider.map((row) => (
              <PerformanceRow
                key={row.provider.id}
                name={row.provider.name}
                count={row.count}
                delivered={row.delivered}
                fees={formatCurrency(row.fees, currency)}
              />
            ))
          ) : (
            <div className="py-8 text-center text-sm text-ink-faint">
              لا توجد بيانات شركات ضمن الفترة
            </div>
          )}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader
          title="أداء سائقي الفروع"
          subtitle="عدد الطلبات والتسليم الفعلي لكل سائق"
        />
        <CardBody className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {driverRows.size ? (
            [...driverRows.values()].map((row) => (
              <PerformanceRow
                key={row.name}
                name={row.name}
                count={row.count}
                delivered={row.delivered}
                fees={formatCurrency(row.fees, currency)}
              />
            ))
          ) : (
            <div className="col-span-full py-8 text-center text-sm text-ink-faint">
              لا توجد طلبات لسائقي الفروع ضمن الفترة
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ProviderDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (
    input: Omit<ShippingProvider, "id" | "createdAt" | "updatedAt">,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string>();
  const [logoError, setLogoError] = useState("");

  function chooseLogo(file?: File) {
    setLogoError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("اختر ملف صورة صالحًا");
      return;
    }
    if (file.size > 1024 * 1024) {
      setLogoError("حجم الشعار يجب ألا يتجاوز 1 ميجابايت");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="إضافة شركة شحن"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={() =>
              name.trim() &&
              onSave({
                name: name.trim(),
                logoDataUrl,
                phone: phone.trim() || undefined,
                trackingUrlTemplate: tracking.trim() || undefined,
                notes: notes.trim() || undefined,
                kind: "manual",
                active: true,
                supportsCashOnDelivery: true,
              })
            }
          >
            حفظ الشركة
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="اسم الشركة" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="شعار شركة الشحن" error={logoError}>
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface-muted/30 p-3">
            <div className="grid h-14 w-24 shrink-0 place-items-center rounded-lg border border-line bg-white p-2 dark:bg-slate-900">
              {logoDataUrl ? (
                <img
                  src={logoDataUrl}
                  alt="معاينة شعار الشركة"
                  className="max-h-10 max-w-full object-contain"
                />
              ) : (
                <PackageCheck className="h-6 w-6 text-ink-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => chooseLogo(event.target.files?.[0])}
                className="h-auto py-1.5 text-xs"
              />
              <p className="mt-1 text-[11px] text-ink-faint">
                PNG أو WebP بخلفية شفافة، بحد أقصى 1 ميجابايت.
              </p>
            </div>
          </div>
        </Field>
        <Field label="الهاتف">
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field
          label="رابط التتبع"
          hint="استخدم {trackingNumber} مكان رقم التتبع"
        >
          <Input
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label="ملاحظات">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function RateDialog({
  open,
  providers,
  onClose,
  onSave,
}: {
  open: boolean;
  providers: ShippingProvider[];
  onClose: () => void;
  onSave: (input: Omit<ShippingRate, "id" | "createdAt" | "updatedAt">) => void;
}) {
  const [providerId, setProviderId] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [fee, setFee] = useState(0);
  const [codFee, setCodFee] = useState(0);
  const [minDays, setMinDays] = useState(1);
  const [maxDays, setMaxDays] = useState(3);
  const selected = providerId || providers[0]?.id || "";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="إضافة سعر توصيل لمنطقة"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            onClick={() =>
              selected &&
              governorate &&
              fee >= 0 &&
              onSave({
                providerId: selected,
                governorate,
                city: city.trim() || undefined,
                district: district.trim() || undefined,
                fee,
                cashOnDeliveryFee: codFee || undefined,
                estimatedDaysMin: minDays || undefined,
                estimatedDaysMax: maxDays || undefined,
                active: true,
              })
            }
          >
            حفظ السعر
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="شركة الشحن" required className="col-span-2">
          <Select
            value={selected}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="المحافظة" required>
          <Select
            value={governorate}
            onChange={(event) => setGovernorate(event.target.value)}
          >
            <option value="">اختر المحافظة</option>
            {EGYPT_GOVERNORATES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="المدينة (اختياري)">
          <Input
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </Field>
        <Field label="الحي (اختياري)">
          <Input
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
          />
        </Field>
        <Field label="رسوم التوصيل" required>
          <Input
            type="number"
            min={0}
            value={fee}
            onChange={(event) => setFee(Number(event.target.value))}
          />
        </Field>
        <Field label="رسوم التحصيل عند التسليم">
          <Input
            type="number"
            min={0}
            value={codFee}
            onChange={(event) => setCodFee(Number(event.target.value))}
          />
        </Field>
        <Field label="أقل مدة بالأيام">
          <Input
            type="number"
            min={1}
            value={minDays}
            onChange={(event) => setMinDays(Number(event.target.value))}
          />
        </Field>
        <Field label="أقصى مدة بالأيام">
          <Input
            type="number"
            min={1}
            value={maxDays}
            onChange={(event) => setMaxDays(Number(event.target.value))}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  const colors: Record<string, string> = {
    blue: "text-blue-600 bg-blue-500/10",
    amber: "text-amber-600 bg-amber-500/10",
    green: "text-emerald-600 bg-emerald-500/10",
    red: "text-red-600 bg-red-500/10",
    indigo: "text-indigo-600 bg-indigo-500/10",
  };
  return (
    <Card className="overflow-hidden">
      <CardBody className="flex min-h-[74px] items-center gap-2.5 p-3">
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${colors[tone]}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-ink-faint">
            {label}
          </div>
          <div className="mt-0.5 text-xl font-extrabold leading-none tabular-nums text-ink">
            {value}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold ${active ? "bg-surface text-brand-600 shadow-sm" : "text-ink-muted"}`}
    >
      {children}
    </button>
  );
}
function ReportValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted/30 p-4">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="mt-2 text-xl font-bold text-ink">{value}</div>
    </div>
  );
}
function PerformanceRow({
  name,
  count,
  delivered,
  fees,
}: {
  name: string;
  count: number;
  delivered: number;
  fees: string;
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-ink">{name}</div>
        <Badge tone="blue">{count} طلب</Badge>
      </div>
      <div className="mt-3 flex justify-between text-xs text-ink-muted">
        <span>
          تم التسليم: <strong className="text-emerald-600">{delivered}</strong>
        </span>
        <span>
          الرسوم: <strong className="text-ink">{fees}</strong>
        </span>
      </div>
    </div>
  );
}
function shippingError(error?: string) {
  return translateBostaError(error);
}
