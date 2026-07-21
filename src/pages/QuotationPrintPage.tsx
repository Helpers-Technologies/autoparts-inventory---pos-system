import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useAuth } from "../store/AuthContext";
import { useFeatures } from "../lib/useFeatures";
import { formatCurrency, formatDate } from "../lib/format";
import { hasPermission } from "../lib/permissions";

export function QuotationPrintPage() {
  const { id } = useParams();
  const { quotations } = useInvoicing();
  const { settings } = useSettings();
  const { currentUser, auth } = useAuth();
  const { isEnabled } = useFeatures();

  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, []);

  if (!auth.isAuthenticated || !hasPermission(currentUser, "salesInvoices") || !isEnabled("quotations")) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint">
        ليس لديك صلاحية
      </div>
    );
  }

  const quot = quotations.find((q) => q.id === id);
  if (!quot) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-ink-faint">
        عرض السعر غير موجود
      </div>
    );
  }

  const subtotal = quot.lines.reduce((a, l) => a + l.subtotal, 0);
  const discount = quot.discount ?? 0;

  return (
    <div dir="rtl" className="min-h-screen bg-surface p-8 font-sans text-ink text-sm" style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <div className="text-2xl font-bold">{settings.arabicLabels ? settings.companyNameAr : settings.companyName}</div>
          {settings.logoText && <div className="text-ink-faint text-xs mt-0.5">{settings.logoText}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-blue-700 dark:text-blue-400">عرض سعر</div>
          <div className="text-ink-muted mt-0.5">رقم: {quot.quotationNumber}</div>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-4 mb-6 text-sm border border-line rounded p-4">
        <div>
          <div className="text-ink-faint text-xs mb-0.5">العميل</div>
          <div className="font-semibold">{quot.customerName}</div>
        </div>
        <div>
          <div className="text-ink-faint text-xs mb-0.5">تاريخ الإصدار</div>
          <div>{formatDate(quot.date)}</div>
        </div>
        {quot.validUntil && (
          <div>
            <div className="text-ink-faint text-xs mb-0.5">صالح حتى</div>
            <div>{formatDate(quot.validUntil)}</div>
          </div>
        )}
        {quot.vehicleLabel && (
          <div>
            <div className="text-ink-faint text-xs mb-0.5">سيارة العميل</div>
            <div className="font-semibold">{quot.vehicleLabel}</div>
          </div>
        )}
        {quot.branchName && (
          <div>
            <div className="text-ink-faint text-xs mb-0.5">الفرع</div>
            <div>{quot.branchName}</div>
          </div>
        )}
        {quot.priceTierName && (
          <div>
            <div className="text-ink-faint text-xs mb-0.5">شريحة السعر</div>
            <div>{quot.priceTierName}</div>
          </div>
        )}
      </div>

      {/* Lines table */}
      <table className="w-full border-collapse mb-6 text-sm">
        <thead>
          <tr className="bg-surface-muted">
            <th className="border border-line p-2 text-right w-8">#</th>
            <th className="border border-line p-2 text-right">المنتج</th>
            <th className="border border-line p-2 text-right">Part No. / الماركة</th>
            <th className="border border-line p-2 text-center w-20">الوحدة</th>
            <th className="border border-line p-2 text-center w-20">الكمية</th>
            <th className="border border-line p-2 text-right w-32">سعر الوحدة</th>
            <th className="border border-line p-2 text-right w-32">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {quot.lines.map((l, idx) => (
            <tr key={l.id}>
              <td className="border border-line p-2 text-center">{idx + 1}</td>
              <td className="border border-line p-2 font-medium">
                {l.productName}
                {l.warrantyMonths ? <div className="mt-0.5 text-[10px] font-normal text-ink-faint">ضمان {l.warrantyMonths} شهر</div> : null}
              </td>
              <td className="border border-line p-2">
                <div className="font-mono text-xs" dir="ltr">{l.partNumber ?? "—"}</div>
                <div className="text-[10px] text-ink-faint">{l.partBrand ?? "—"}</div>
              </td>
              <td className="border border-line p-2 text-center">
                {l.unit}
                <div className="text-[9px] text-ink-faint">{l.priceType === "retail" ? "تجزئة" : "جملة"}</div>
              </td>
              <td className="border border-line p-2 text-center">{l.quantity}</td>
              <td className="border border-line p-2 text-right font-mono">{formatCurrency(l.price, settings.currency)}</td>
              <td className="border border-line p-2 text-right font-mono">{formatCurrency(l.subtotal, settings.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end">
        <table className="text-sm w-64">
          {discount > 0 && (
            <>
              <tbody>
                <tr>
                  <td className="py-1 text-ink-muted">المجموع الفرعي</td>
                  <td className="py-1 text-right font-mono">{formatCurrency(subtotal, settings.currency)}</td>
                </tr>
                <tr className="text-rose-600 dark:text-rose-400">
                  <td className="py-1">خصم</td>
                  <td className="py-1 text-right font-mono">- {formatCurrency(discount, settings.currency)}</td>
                </tr>
              </tbody>
            </>
          )}
          <tbody>
            <tr className="font-bold text-base border-t border-line">
              <td className="pt-2">الإجمالي</td>
              <td className="pt-2 text-right font-mono">{formatCurrency(quot.total, settings.currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {quot.notes && (
        <div className="mt-6 border-t border-line pt-4">
          <div className="text-ink-faint text-xs mb-1">ملاحظات</div>
          <div className="text-sm text-ink-muted">{quot.notes}</div>
        </div>
      )}

      {/* Footer */}
      {settings.invoiceFooter && (
        <div className="mt-8 border-t border-line pt-4 text-center text-ink-faint text-xs">
          {settings.invoiceFooter}
        </div>
      )}
    </div>
  );
}
