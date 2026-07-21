import { useEffect } from "react";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDate } from "../../lib/format";
import type { InvoiceLine } from "../../types";

interface Props {
  invoiceNumber: string;
  date: string;
  partyName: string;
  driverName?: string;
  lines: InvoiceLine[];
  total: number;
  discount?: number;
  amountPaid: number;
  remaining: number;
  notes?: string;
  paymentLabel?: string;
  priceTypeLabel?: string;
  customerBalance?: number;
  customerName?: string;
  overpayment?: number;
  cashierName?: string;
  vehicleLabel?: string;
  branchName?: string;
  priceTierName?: string;
}

export function ReceiptPrintLayout(props: Props) {
  const { settings } = useSettings();

  useEffect(() => {
    const prev = document.title;
    document.title = `إيصال مبيعات ${props.invoiceNumber}`;
    return () => {
      document.title = prev;
    };
  }, [props.invoiceNumber]);

  const overpayment = props.overpayment ?? 0;
  const totalCollected = props.amountPaid + overpayment;

  return (
    <div className="bg-white text-black p-4 max-w-[80mm] mx-auto text-xs" dir="rtl">
      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            @page { size: 80mm auto; margin: 0; }
            body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
            .no-print { display: none !important; }
            .receipt-container { width: 100% !important; padding: 4mm 2mm !important; box-shadow: none !important; margin: 0 !important; }
          }
          body {
            font-family: 'Cairo', sans-serif !important;
          }
        `
      }} />

      {/* Screen toolbar */}
      <div className="no-print flex items-center justify-between mb-4 pb-2 border-b">
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
      </div>

      <div className="receipt-container w-full">
        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="font-bold text-sm">{settings.companyNameAr || settings.companyName || "الشركة"}</h1>
          {settings.logoText && <p className="text-[10px] text-gray-600 mt-0.5">{settings.logoText}</p>}
          <p className="font-semibold mt-1.5 text-[11px] border-y border-dashed py-1">إيصال مبيعات مبسط</p>
        </div>

        {/* Info */}
        <div className="space-y-1 mb-3 text-[10px] border-b pb-2">
          <div className="flex justify-between">
            <span>رقم الفاتورة:</span>
            <span className="font-bold">{props.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>التاريخ:</span>
            <span>{formatDate(props.date)}</span>
          </div>
          {props.cashierName && (
            <div className="flex justify-between">
              <span>الكاشير:</span>
              <span>{props.cashierName}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>العميل:</span>
            <span className="font-semibold">{props.partyName}</span>
          </div>
          {props.vehicleLabel && (
            <div className="flex justify-between gap-2">
              <span>السيارة:</span>
              <span className="font-semibold text-left">{props.vehicleLabel}</span>
            </div>
          )}
          {props.branchName && (
            <div className="flex justify-between">
              <span>الفرع:</span>
              <span>{props.branchName}</span>
            </div>
          )}
          {props.priceTierName && (
            <div className="flex justify-between">
              <span>شريحة السعر:</span>
              <span>{props.priceTierName}</span>
            </div>
          )}
          {props.paymentLabel && (
            <div className="flex justify-between">
              <span>طريقة الدفع:</span>
              <span>{props.paymentLabel}</span>
            </div>
          )}
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
            <span>{formatCurrency(props.total + (props.discount || 0))}</span>
          </div>
          {props.discount ? (
            <div className="flex justify-between text-red-600">
              <span>الخصم:</span>
              <span>-{formatCurrency(props.discount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between font-bold text-[11px] pt-1 border-t border-dashed">
            <span>الصافي المطلوب:</span>
            <span>{formatCurrency(props.total)}</span>
          </div>
          <div className="flex justify-between text-emerald-700 font-semibold">
            <span>المدفوع:</span>
            <span>{formatCurrency(totalCollected)}</span>
          </div>
          {props.remaining > 0 ? (
            <div className="flex justify-between text-red-600">
              <span>المتبقي (آجل):</span>
              <span>{formatCurrency(props.remaining)}</span>
            </div>
          ) : null}
          {overpayment > 0 ? (
            <div className="flex justify-between text-blue-600">
              <span>الرصيد الزائد:</span>
              <span>{formatCurrency(overpayment)}</span>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="text-center space-y-1 text-[9px] text-gray-500 pt-1">
          {settings.invoiceFooter && <p className="whitespace-pre-line leading-relaxed">{settings.invoiceFooter}</p>}
          <p className="font-semibold text-black mt-3">شكراً لتعاملكم معنا</p>
        </div>
      </div>
    </div>
  );
}
