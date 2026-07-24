import { useEffect, useState } from "react";
import { Lock, Printer, CheckCircle2, TrendingUp, TrendingDown } from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { Field, Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { useInvoicing } from "../../store/InvoicingContext";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { useToast } from "../ui/Toast";
import type { CashierShift } from "../../types";

interface CloseShiftDialogProps {
  shift: CashierShift | null;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onPrintZReport?: (shift: CashierShift) => void;
}

export function CloseShiftDialog({
  shift,
  open,
  onClose,
  onSuccess,
  onPrintZReport,
}: CloseShiftDialogProps) {
  const { getShiftSummary, closeShift } = useInvoicing();
  const { settings } = useSettings();
  const toast = useToast();

  const [actualCash, setActualCash] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setActualCash("");
    setNote("");
    setError("");
  }, [open, shift?.id]);

  if (!shift || !open) return null;

  // Always compute live summary
  const summary = getShiftSummary(shift.id);

  const actualNum = Number(actualCash);
  const hasValidActual = actualCash.trim() !== "" && Number.isFinite(actualNum) && actualNum >= 0;
  const diff = hasValidActual
    ? Math.round((actualNum - summary.expectedCash) * 100) / 100
    : null;

  const handleCloseShift = async () => {
    if (!hasValidActual) {
      setError("عدّ النقدية الموجودة بالدرج وأدخل مبلغًا صحيحًا لا يقل عن صفر");
      return;
    }
    try {
      setLoading(true);
      const closed = closeShift(shift.id, actualNum, note);
      toast.success(`تم تقفيل وإغلاق الوردية رقم #${closed.shiftNumber} بنجاح`);
      
      if (onPrintZReport) {
        onPrintZReport(closed);
      }
      
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر إغلاق الوردية";
      toast.error("خطأ", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`إغلاق وتقفيل الوردية رقم #${summary.shiftNumber}`}
      width="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            type="button"
            variant="outline"
            onClick={() => onPrintZReport && onPrintZReport(summary)}
          >
            <Printer className="w-4 h-4 ml-1.5" />
            معاينة/طباعة التقرير (X-Report)
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              إلغاء
            </Button>
            <Button onClick={handleCloseShift} disabled={loading || !hasValidActual} variant="primary">
              <Lock className="w-4 h-4 ml-1.5" />
              {loading ? "جاري تقفيل الوردية..." : "تأكيد وتقفيل الوردية (Z-Report)"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Shift Details Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-line bg-surface-muted text-xs text-ink-muted">
          <div>
            الكاشير: <span className="font-semibold text-ink">{summary.cashierName}</span>
          </div>
          <div>
            وقت الفتح: <span className="font-semibold text-ink">{formatDateTime(summary.openedAt)}</span>
          </div>
          <div>
            عدد الفواتير: <span className="font-bold text-brand-600">{summary.totalSalesCount} فاتورة</span>
          </div>
        </div>

        {/* Live Calculation Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-line bg-surface space-y-1">
            <span className="text-[11px] text-ink-faint">الرصيد الافتتاحي (الفكة)</span>
            <div className="text-sm font-bold text-ink">
              {formatCurrency(summary.openingCash, settings.currency)}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-line bg-surface space-y-1">
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">+ تحصيلات المبيعات النقدية</span>
            <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              {formatCurrency(summary.totalCashSales, settings.currency)}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-line bg-surface space-y-1">
            <span className="text-[11px] text-cyan-700 dark:text-cyan-400 font-medium">+ إضافات نقدية أخرى</span>
            <div className="text-sm font-bold text-cyan-700 dark:text-cyan-400">
              {formatCurrency(summary.totalCashAdditions ?? 0, settings.currency)}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-line bg-surface space-y-1">
            <span className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">مبيعات الشبكة (فيزا)</span>
            <div className="text-sm font-bold text-blue-700 dark:text-blue-400">
              {formatCurrency(summary.totalVisaSales, settings.currency)}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-line bg-surface space-y-1">
            <span className="text-[11px] text-indigo-700 dark:text-indigo-400 font-medium">المبيعات الآجلة</span>
            <div className="text-sm font-bold text-indigo-700 dark:text-indigo-400">
              {formatCurrency(summary.totalCreditSales, settings.currency)}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-line bg-surface space-y-1">
            <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">- المرتجعات النقدية</span>
            <div className="text-sm font-bold text-amber-700 dark:text-amber-400">
              {formatCurrency(summary.totalRefunds, settings.currency)}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-line bg-surface space-y-1">
            <span className="text-[11px] text-rose-700 dark:text-rose-400 font-medium">- المصروفات النقدية</span>
            <div className="text-sm font-bold text-rose-700 dark:text-rose-400">
              {formatCurrency(summary.totalExpenses, settings.currency)}
            </div>
          </div>
        </div>

        {/* Expected vs Actual Cash Drawer Balance */}
        <div className="p-4 rounded-xl border-2 border-brand-200 dark:border-brand-500/20 bg-brand-50/30 dark:bg-brand-500/5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-ink-muted">المبلغ النقدي المتوقع بالدرج (الصرّاف)</div>
              <div className="text-xs text-ink-faint">الافتتاحي + التحصيلات والإضافات - المرتجعات والمصروفات</div>
            </div>
            <div className="text-xl font-extrabold text-brand-700 dark:text-brand-300">
              {formatCurrency(summary.expectedCash, settings.currency)}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-brand-200/60 dark:border-brand-500/10">
            <Field label="المبلغ النقدي الفعلي الموجود بالدرج" required error={error}>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={actualCash}
                  onChange={(e) => {
                    setActualCash(e.target.value);
                    setError("");
                  }}
                  placeholder="اكتب نتيجة عدّ الدرج"
                  className="text-lg font-bold"
                  autoFocus
                />
                <span className="absolute left-3 top-2.5 text-xs text-ink-faint font-medium">جنيه</span>
              </div>
            </Field>

            <div className="flex flex-col justify-center space-y-1.5">
              <span className="text-xs text-ink-muted">نتيجة التقفيل والمطابقة:</span>
              <div>
                {diff === null ? (
                  <Badge tone="slate" className="py-1 px-3 text-sm">
                    أدخل النقدية الفعلية لإظهار المطابقة
                  </Badge>
                ) : diff === 0 ? (
                  <Badge tone="green" className="py-1 px-3 text-sm">
                    <CheckCircle2 className="w-4 h-4 inline ml-1.5" />
                    مطابق 100% (لا يوجد فارق)
                  </Badge>
                ) : diff < 0 ? (
                  <Badge tone="red" className="py-1 px-3 text-sm">
                    <TrendingDown className="w-4 h-4 inline ml-1.5" />
                    عجز بقيمة: {formatCurrency(Math.abs(diff), settings.currency)}
                  </Badge>
                ) : (
                  <Badge tone="indigo" className="py-1 px-3 text-sm">
                    <TrendingUp className="w-4 h-4 inline ml-1.5" />
                    زيادة بقيمة: {formatCurrency(diff, settings.currency)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Optional Note */}
        <Field label="ملاحظات تقفيل الوردية (اختياري)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: تم التقفيل وتسليم الدرج بأمر الإدارة"
          />
        </Field>
      </div>
    </Dialog>
  );
}
