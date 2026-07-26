import { useRef } from "react";
import { Printer } from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDateTime } from "../../lib/format";
import type { CashierShift, PaymentMethod } from "../../types";

interface ShiftReportModalProps {
  shift: CashierShift | null;
  open: boolean;
  onClose: () => void;
}

const NON_CASH_METHOD_LABELS: Partial<Record<PaymentMethod, string>> = {
  bank: "تحويل بنكي",
  vodafone: "فودافون كاش",
  instapay: "إنستاباي",
  other: "أخرى (غير نقدي)",
};

export function ShiftReportModal({ shift, open, onClose }: ShiftReportModalProps) {
  const { settings } = useSettings();
  const printRef = useRef<HTMLDivElement>(null);

  if (!shift || !open) return null;

  const isZReport = shift.status === "closed";
  const reportTypeTitle = isZReport ? "تقرير تقفيل الوردية (Z-Report)" : "تقرير الوردية الحالية (X-Report)";

  const handlePrint = () => {
    const printContent = printRef.current?.innerHTML;
    if (!printContent) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <title>${reportTypeTitle} #${shift.shiftNumber}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              margin: 0;
              padding: 16px;
              color: #000;
              background: #fff;
              font-size: 13px;
            }
            .receipt {
              max-width: 320px;
              margin: 0 auto;
              border: 1px dashed #000;
              padding: 12px;
            }
            .header {
              text-align: center;
              margin-bottom: 12px;
              border-bottom: 1px solid #000;
              padding-bottom: 8px;
            }
            .row {
              display: flex;
              justify-content: space-between;
              padding: 4px 0;
              border-bottom: 1px dotted #ccc;
            }
            .row.total {
              font-weight: bold;
              font-size: 14px;
              border-bottom: 2px solid #000;
              margin-top: 6px;
              padding-top: 6px;
            }
            .footer {
              text-align: center;
              margin-top: 12px;
              font-size: 11px;
              color: #555;
            }
            @media print {
              .receipt { border: none; width: 100%; max-width: 100%; }
            }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="receipt">
            ${printContent}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${reportTypeTitle} — وردية #${shift.shiftNumber}`}
      width="md"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="w-4 h-4 ml-1.5" />
            طباعة التقرير (Thermal Print)
          </Button>
        </div>
      }
    >
      <div className="space-y-4" ref={printRef}>
        <div className="text-center pb-3 border-b border-line">
          <h2 className="text-base font-bold text-ink">{settings.companyName || "نظام قطع الغيار"}</h2>
          <div className="text-xs font-semibold text-brand-600 dark:text-brand-400 mt-0.5">
            {reportTypeTitle} — وردية #{shift.shiftNumber}
          </div>
          <div className="text-[11px] text-ink-faint mt-1">
            الكاشير: <span className="font-semibold text-ink">{shift.cashierName}</span>
            {shift.branchName ? <> — الفرع: <span className="font-semibold text-ink">{shift.branchName}</span></> : null}
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between py-1 border-b border-line-soft">
            <span className="text-ink-muted">تاريخ ووقت الفتح:</span>
            <span className="font-medium text-ink">{formatDateTime(shift.openedAt)}</span>
          </div>
          {shift.closedAt && (
            <div className="flex justify-between py-1 border-b border-line-soft">
              <span className="text-ink-muted">تاريخ ووقت الإغلاق:</span>
              <span className="font-medium text-ink">{formatDateTime(shift.closedAt)}</span>
            </div>
          )}
          <div className="flex justify-between py-1 border-b border-line-soft">
            <span className="text-ink-muted">عدد الفواتير الصادرة:</span>
            <span className="font-bold text-ink">{shift.totalSalesCount} فاتورة</span>
          </div>
        </div>

        <div className="space-y-1.5 text-xs bg-surface-muted p-3 rounded-lg border border-line">
          <div className="flex justify-between py-1">
            <span>الرصيد الافتتاحي بالدرج:</span>
            <span className="font-semibold">{formatCurrency(shift.openingCash, settings.currency)}</span>
          </div>
          <div className="flex justify-between py-1 text-emerald-700 dark:text-emerald-400">
            <span>+ تحصيلات المبيعات النقدية:</span>
            <span className="font-bold">{formatCurrency(shift.totalCashSales, settings.currency)}</span>
          </div>
          <div className="flex justify-between py-1 text-cyan-700 dark:text-cyan-400">
            <span>+ إضافات نقدية أخرى:</span>
            <span className="font-bold">{formatCurrency(shift.totalCashAdditions ?? 0, settings.currency)}</span>
          </div>
          {shift.paymentMethodTotals && Object.keys(shift.paymentMethodTotals).length > 0 ? (
            Object.entries(shift.paymentMethodTotals)
              .filter(([, amount]) => (amount ?? 0) !== 0)
              .map(([method, amount]) => (
                <div key={method} className="flex justify-between py-1 text-blue-700 dark:text-blue-400">
                  <span>{NON_CASH_METHOD_LABELS[method as PaymentMethod] ?? method}:</span>
                  <span className="font-bold">{formatCurrency(amount ?? 0, settings.currency)}</span>
                </div>
              ))
          ) : (
            // Old shift records closed before the per-method breakdown existed —
            // fall back to the legacy lumped-together "Visa" total.
            <div className="flex justify-between py-1 text-blue-700 dark:text-blue-400">
              <span>مبيعات غير نقدية (شبكة/محافظ):</span>
              <span className="font-bold">{formatCurrency(shift.totalVisaSales, settings.currency)}</span>
            </div>
          )}
          <div className="flex justify-between py-1 text-indigo-700 dark:text-indigo-400">
            <span>المبيعات الآجلة (حساب عميل):</span>
            <span className="font-bold">{formatCurrency(shift.totalCreditSales, settings.currency)}</span>
          </div>
          <div className="flex justify-between py-1 text-amber-700 dark:text-amber-400">
            <span>- المرتجعات النقدية:</span>
            <span className="font-bold">{formatCurrency(shift.totalRefunds, settings.currency)}</span>
          </div>
          <div className="flex justify-between py-1 text-rose-700 dark:text-rose-400">
            <span>- المصروفات النقدية:</span>
            <span className="font-bold">{formatCurrency(shift.totalExpenses, settings.currency)}</span>
          </div>

          <div className="flex justify-between py-2 border-t border-line font-bold text-sm text-ink mt-2">
            <span>إجمالي المبيعات الكامل:</span>
            <span>{formatCurrency(shift.totalSalesAmount, settings.currency)}</span>
          </div>
        </div>

        <div className="p-3 rounded-lg border border-brand-200 dark:border-brand-500/20 bg-brand-50/50 dark:bg-brand-500/10 space-y-2 text-xs">
          <div className="flex justify-between font-semibold text-brand-900 dark:text-brand-300">
            <span>المبلغ المتوقع بالدرج:</span>
            <span className="font-bold text-sm">{formatCurrency(shift.expectedCash, settings.currency)}</span>
          </div>

          {isZReport && (
            <>
              <div className="flex justify-between font-semibold text-ink">
                <span>المبلغ الفعلي المقفول:</span>
                <span className="font-bold text-sm">{formatCurrency(shift.closingCashActual ?? 0, settings.currency)}</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-brand-200">
                <span>الفارق (العجز / الزيادة):</span>
                <span>
                  {shift.difference === undefined || shift.difference === 0 ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">مطابق 100%</span>
                  ) : shift.difference < 0 ? (
                    <span className="text-rose-700 dark:text-rose-400 font-bold">عجز {formatCurrency(Math.abs(shift.difference), settings.currency)}</span>
                  ) : (
                    <span className="text-blue-700 dark:text-blue-400 font-bold">زيادة {formatCurrency(shift.difference, settings.currency)}</span>
                  )}
                </span>
              </div>
            </>
          )}
        </div>

        {shift.note && (
          <div className="text-xs text-ink-muted bg-surface p-2.5 rounded-lg border border-line">
            <span className="font-semibold text-ink">ملاحظات:</span> {shift.note}
          </div>
        )}
      </div>
    </Dialog>
  );
}
