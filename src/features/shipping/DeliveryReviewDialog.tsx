import { MapPin, PackageCheck, Truck, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { formatCurrency } from "../../lib/format";
import type { DeliveryDraft } from "./DeliveryConfigurator";

export function DeliveryReviewDialog({
  open,
  delivery,
  currency,
  total,
  onClose,
  onConfirm,
}: {
  open: boolean;
  delivery: DeliveryDraft;
  currency: string;
  total: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isCompany = delivery.method === "shipping_company";
  const address = delivery.address;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="مراجعة طلب التوصيل"
      subtitle={
        <span className="font-medium text-ink dark:!text-white/80">
          راجع بيانات الشحنة قبل إتمام الطلب
        </span>
      }
      width="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            رجوع للتعديل
          </Button>
          <Button onClick={onConfirm}>
            <PackageCheck className="h-4 w-4" /> إتمام الطلب
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ReviewItem
            icon={isCompany ? <PackageCheck /> : <Truck />}
            label={isCompany ? "شركة الشحن" : "سائق التوصيل"}
            value={
              isCompany
                ? delivery.providerName || "غير محددة"
                : delivery.driverName || "غير محدد"
            }
          />
          <ReviewItem
            icon={<WalletCards />}
            label="رسوم التوصيل"
            value={formatCurrency(delivery.shippingFee, currency)}
            emphasized
          />
        </div>
        <div className="rounded-xl border border-line bg-surface-muted/35 p-3">
          <div className="mb-1.5 flex items-center gap-2 font-semibold text-ink">
            <MapPin className="h-4 w-4 text-brand-600" /> عنوان التسليم
          </div>
          <div className="text-ink dark:text-white/90">
            {address?.recipientName || "العميل"}
            {address?.phone ? ` — ${address.phone}` : ""}
          </div>
          <div className="mt-1 text-xs font-medium leading-6 text-ink-muted dark:text-white/75">
            {address
              ? `${address.governorate}، ${address.city}${address.district ? `، ${address.district}` : ""} — ${address.addressLine}`
              : "لا يوجد عنوان"}
          </div>
        </div>
        {isCompany ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ReviewItem
              icon={<WalletCards />}
              label="الإجمالي شامل التوصيل"
              value={formatCurrency(total, currency)}
              emphasized
            />
            <ReviewItem
              icon={<PackageCheck />}
              label="فتح الطرد"
              value={
                delivery.allowOpenPackage
                  ? "مسموح للعميل بالمعاينة"
                  : "غير مسموح بالمعاينة"
              }
            />
          </div>
        ) : null}
        {isCompany && delivery.shippingNotes ? (
          <div className="rounded-xl border border-line bg-surface px-3 py-2.5 text-xs text-ink-muted dark:text-white/80">
            <span className="font-semibold text-ink dark:text-white">
              ملاحظات الشحن:{" "}
            </span>
            {delivery.shippingNotes}
          </div>
        ) : null}
        <div
          className={`rounded-xl border px-3 py-2.5 ${
            delivery.collectOnDelivery
              ? "border-amber-300/70 bg-amber-50/70 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
              : "border-emerald-300/70 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-100"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold">طريقة الدفع والتحصيل</span>
            <span className="text-sm font-black">
              {delivery.collectOnDelivery
                ? "دفع عند الاستلام"
                : "مدفوع مسبقًا"}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-medium opacity-80">
            {delivery.collectOnDelivery
              ? `لم يُحصّل الآن — يُحصّل ${formatCurrency(total, currency)} من العميل عند التسليم.`
              : "سيتم تسجيل قيمة الطلب كمدفوعة قبل التسليم."}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function ReviewItem({
  icon,
  label,
  value,
  emphasized = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted dark:text-white/80">
        <span className="text-brand-600">{icon}</span>
        {label}
      </div>
      <div
        className={`mt-1 font-bold ${emphasized ? "text-brand-600 dark:text-white" : "text-ink dark:text-white"}`}
      >
        {value}
      </div>
    </div>
  );
}
