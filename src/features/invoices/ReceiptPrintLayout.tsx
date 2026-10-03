import { useEffect } from "react";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDate } from "../../lib/format";
import type { CustomerAddressSnapshot, DeliveryMethod, InvoiceLine, Settings } from "../../types";

interface Props {
  invoiceNumber: string;
  date: string;
  partyName: string;
  driverName?: string;
  lines: InvoiceLine[];
  total: number;
  discount?: number;
  discountCode?: string;
  amountPaid: number;
  remaining: number;
  notes?: string;
  paymentLabel?: string;
  customerBalance?: number;
  customerName?: string;
  overpayment?: number;
  cashierName?: string;
  vehicleLabel?: string;
  branchName?: string;
  collectOnDelivery?: boolean;
  deliveryMethod?: DeliveryMethod;
  deliveryAddress?: CustomerAddressSnapshot;
  shippingProviderName?: string;
  shippingFee?: number;
  settingsOverride?: Settings;
  showToolbar?: boolean;
}

export function ReceiptPrintLayout({ settingsOverride, showToolbar = true, ...props }: Props) {
  const { settings: contextSettings } = useSettings();
  const settings = settingsOverride ?? contextSettings;

  useEffect(() => {
    if (!showToolbar) return;
    const prev = document.title;
    document.title = `إيصال مبيعات ${props.invoiceNumber}`;
    return () => {
      document.title = prev;
    };
  }, [props.invoiceNumber, showToolbar]);

  const overpayment = props.overpayment ?? 0;
  const totalCollected = props.amountPaid + overpayment;
  const isCollectOnDelivery = props.collectOnDelivery === true;

  return (
    <div className="receipt-print-root bg-white text-black p-4 max-w-[80mm] mx-auto text-xs" dir="rtl">
      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            @page { size: 80mm auto; margin: 0; }
            body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
            .no-print { display: none !important; }
            .receipt-container { width: 100% !important; padding: 4mm 2mm !important; box-shadow: none !important; margin: 0 !important; }
          }
          .receipt-print-root {
            font-family: 'Cairo', sans-serif !important;
          }
        `
      }} />

      {/* Screen toolbar */}
      {showToolbar ? <div className="no-print flex items-center justify-between mb-4 pb-2 border-b">
        <button
          onClick={() => window.history.back()}
          className="text-xs text-gray-600 hover:text-black flex items-center gap-1 bg-gray-100 border rounded px-2 py-1"
        >
          ← رجوع
        </button>
        <button
          onClick={() => window.print()}
          className="py-1 px-3 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
        >
          طباعة
        </button>
      </div> : null}

      <div className="receipt-container w-full">
        {/* Header */}
        <div className="text-center mb-3">
          {settings.logoImage ? (
            <img src={settings.logoImage} alt="شعار المحل" className="mx-auto mb-2 h-14 w-14 object-contain" />
          ) : null}
          <h1 className="font-bold text-sm">{settings.companyNameAr || settings.companyName || "الشركة"}</h1>
          {settings.shopPhone ? <p className="mt-0.5 text-[10px] text-gray-600">موبايل المحل: {settings.shopPhone}</p> : null}
        </div>

        {/* Info */}
        <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 border-b pb-2 text-[9.5px]">
          <ReceiptInfo label="رقم الفاتورة" value={props.invoiceNumber} bold />
          <ReceiptInfo label="التاريخ" value={formatDate(props.date)} />
          <ReceiptInfo label="العميل" value={props.partyName} bold />
          {(isCollectOnDelivery || props.paymentLabel) ? (
            <ReceiptInfo label="الدفع" value={isCollectOnDelivery ? "عند الاستلام" : props.paymentLabel ?? "—"} bold={isCollectOnDelivery} />
          ) : null}
          {props.cashierName ? <ReceiptInfo label="الكاشير" value={props.cashierName} /> : null}
          {props.branchName ? <ReceiptInfo label="الفرع" value={props.branchName} /> : null}
          {props.vehicleLabel ? (
            <div className="col-span-2">
              <ReceiptInfo label="السيارة" value={props.vehicleLabel} bold />
            </div>
          ) : null}
          {props.deliveryMethod && props.deliveryMethod !== "pickup" ? (
            <div className="col-span-2 space-y-1 border-t border-dashed pt-1">
              <ReceiptInfo label="التوصيل" value={props.deliveryMethod === "branch_driver" ? `سائق الفرع${props.driverName ? ` — ${props.driverName}` : ""}` : props.shippingProviderName || "شركة شحن"} />
              {props.deliveryAddress ? <ReceiptInfo label="العنوان" value={`${props.deliveryAddress.governorate}، ${props.deliveryAddress.city} — ${props.deliveryAddress.addressLine}`} /> : null}
            </div>
          ) : null}
        </div>

        {/* Lines */}
        <div className="border-b pb-2 mb-3">
          <div className="flex justify-between font-bold text-[10px] border-b pb-1 mb-1">
            <span className="w-1/2 text-right">المنتج</span>
            <span className="w-1/6 text-center">الكمية</span>
            <span className="w-1/6 text-left">السعر</span>
            <span className="w-1/6 text-left">الإجمالي</span>
          </div>
          <div className="space-y-1.5">
            {props.lines.map((l) => (
              <div key={l.id} className="flex justify-between items-start text-[10px]">
                <span className="w-1/2 text-right leading-tight font-medium">{l.productName}{l.partNumber ? <small className="block font-mono text-[8px] text-gray-500" dir="ltr">{l.partNumber}{l.partBrand ? ` · ${l.partBrand}` : ""}{l.warrantyMonths ? ` · ضمان ${l.warrantyMonths} شهر` : ""}</small> : null}</span>
                <span className="w-1/6 text-center">{l.quantity}</span>
                <span className="w-1/6 text-left">{formatCurrency(l.price)}</span>
                <span className="w-1/6 text-left font-semibold">{formatCurrency(l.subtotal)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Financials */}
        <div className="space-y-1 text-[10px] border-b pb-2 mb-3">
          <div className="flex justify-between">
            <span>إجمالي البنود:</span>
            <span>{formatCurrency(props.total - (props.shippingFee ?? 0) + (props.discount || 0))}</span>
          </div>
          {props.discount ? (
            <div className="flex justify-between text-red-600">
              <span>{props.discountCode ? `الخصم (${props.discountCode}):` : "الخصم:"}</span>
              <span>-{formatCurrency(props.discount)}</span>
            </div>
          ) : null}
          {props.shippingFee ? <div className="flex justify-between text-blue-700"><span>رسوم التوصيل:</span><span>+{formatCurrency(props.shippingFee)}</span></div> : null}
          <div className="flex justify-between font-bold text-[11px] pt-1 border-t border-dashed">
            <span>الصافي المطلوب:</span>
            <span>{formatCurrency(props.total)}</span>
          </div>
          {isCollectOnDelivery ? (
            <>
              <div className="flex justify-between font-bold text-[11px] text-amber-700 pt-1 border-t border-dashed">
                <span>حالة التحصيل:</span>
                <span>غير محصّل — دفع عند الاستلام</span>
              </div>
              <div className="flex justify-between font-bold text-[11px]">
                <span>المطلوب عند التسليم:</span>
                <span>{formatCurrency(props.total)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>المدفوع:</span>
                <span>{formatCurrency(totalCollected)}</span>
              </div>
              <div className={`flex justify-between ${props.remaining > 0 ? "text-red-600" : "text-gray-700"}`}>
                  <span>الباقي:</span>
                  <span>{formatCurrency(props.remaining)}</span>
              </div>
              {overpayment > 0 ? (
                <div className="flex justify-between text-blue-600">
                  <span>الرصيد الزائد:</span>
                  <span>{formatCurrency(overpayment)}</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center space-y-1 text-[9px] text-gray-500 pt-1">
          {settings.invoiceFooter && <p className="whitespace-pre-line leading-relaxed">{settings.invoiceFooter}</p>}
        </div>
      </div>
    </div>
  );
}

function ReceiptInfo({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1 leading-4">
      <span className="shrink-0 text-gray-500">{label}:</span>
      <span className={`min-w-0 break-words ${bold ? "font-bold" : "font-medium"}`}>{value}</span>
    </div>
  );
}
