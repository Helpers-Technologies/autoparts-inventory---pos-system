import { useMemo, useState } from "react";
import { Clock, Lock, PlayCircle, Search, FileText, Filter } from "lucide-react";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useAuth } from "../store/AuthContext";
import { formatCurrency, formatDateTime } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { OpenShiftDialog } from "../components/shifts/OpenShiftDialog";
import { CloseShiftDialog } from "../components/shifts/CloseShiftDialog";
import { ShiftReportModal } from "../components/shifts/ShiftReportModal";
import type { CashierShift } from "../types";

import { hasPermission } from "../lib/permissions";

export function ShiftsPage() {
  const { shifts, activeShift, getShiftSummary } = useInvoicing();
  const { settings } = useSettings();
  const { currentUser } = useAuth();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [isOpenShiftOpen, setIsOpenShiftOpen] = useState(false);
  const [isCloseShiftOpen, setIsCloseShiftOpen] = useState(false);
  const [selectedShiftForReport, setSelectedShiftForReport] = useState<CashierShift | null>(null);
  const [selectedShiftForClose, setSelectedShiftForClose] = useState<CashierShift | null>(null);
  const [isShiftReportOpen, setIsShiftReportOpen] = useState(false);

  const canSupervise = hasPermission(currentUser, "pos", "supervisorOverride");
  const canOpenShift = hasPermission(currentUser, "pos", "openShift");

  const accessibleShifts = useMemo(
    () => (currentUser?.role === "owner" || canSupervise)
      ? shifts
      : shifts.filter((shift) => shift.cashierId === currentUser?.id || shift.cashierName === currentUser?.name),
    [shifts, currentUser, canSupervise],
  );

  // Compute live summaries for open shifts
  const processedShifts = useMemo(() => {
    return accessibleShifts.map((s) => {
      if (s.status === "open") {
        try {
          return getShiftSummary(s.id);
        } catch {
          return s;
        }
      }
      return s;
    });
  }, [accessibleShifts, getShiftSummary]);

  const filteredShifts = useMemo(() => {
    return processedShifts.filter((s) => {
      const matchesStatus = statusFilter === "all" || s.status === statusFilter;
      const query = search.trim().toLowerCase();
      const matchesSearch =
        !query ||
        s.shiftNumber.toString().includes(query) ||
        s.cashierName.toLowerCase().includes(query) ||
        s.cashierUsername.toLowerCase().includes(query) ||
        (s.note && s.note.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [processedShifts, statusFilter, search]);

  const totalOpenShifts = processedShifts.filter((s) => s.status === "open").length;
  const totalClosedShifts = processedShifts.filter((s) => s.status === "closed").length;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Clock className="w-7 h-7 text-brand-600 dark:text-brand-400" />
            إدارة ورديات الكاشير
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            متابعة ورديات الكاشير النشطة، تقفيل الورديات، واحتساب مطابقة الدرج والـ Z-Report
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeShift ? (
            <Button
              variant="primary"
              onClick={() => {
                setSelectedShiftForClose(activeShift);
                setIsCloseShiftOpen(true);
              }}
            >
              <Lock className="w-4 h-4 ml-1.5" />
              تقفيل الوردية الحالية (#{activeShift.shiftNumber})
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => setIsOpenShiftOpen(true)}
              disabled={!canOpenShift}
              title={!canOpenShift ? "يتطلب صلاحية فتح وردية كاشير جديدة" : undefined}
            >
              <PlayCircle className="w-4 h-4 ml-1.5" />
              فتح وردية كاشير جديدة
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-line bg-surface space-y-1 shadow-sm">
          <span className="text-xs text-ink-muted">الورديات النشطة الآن</span>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {totalOpenShifts} وردية
          </div>
        </div>

        <div className="p-4 rounded-xl border border-line bg-surface space-y-1 shadow-sm">
          <span className="text-xs text-ink-muted">إجمالي الورديات المقفولة</span>
          <div className="text-2xl font-bold text-ink">
            {totalClosedShifts} وردية
          </div>
        </div>

        <div className="p-4 rounded-xl border border-line bg-surface space-y-1 shadow-sm">
          <span className="text-xs text-ink-muted">الوردية الحالية للمستخدم</span>
          <div className="text-sm font-bold text-ink mt-1">
            {activeShift ? (
              <Badge tone="green" className="py-1 px-3">
                نشطة #{activeShift.shiftNumber} ({activeShift.cashierName})
              </Badge>
            ) : (
              <Badge tone="slate" className="py-1 px-3">لا توجد وردية مفتوحة</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface p-3.5 rounded-xl border border-line shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-ink-faint absolute right-3 top-2.5" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم الوردية أو اسم الكاشير..."
            className="pr-9"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-ink-faint" />
          <span className="text-xs font-semibold text-ink-muted">الحالة:</span>
          <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-lg border border-line">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                statusFilter === "all" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              الكل ({processedShifts.length})
            </button>
            <button
              onClick={() => setStatusFilter("open")}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                statusFilter === "open" ? "bg-emerald-600 text-white shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              مفتوحة ({totalOpenShifts})
            </button>
            <button
              onClick={() => setStatusFilter("closed")}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                statusFilter === "closed" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              مقفولة ({totalClosedShifts})
            </button>
          </div>
        </div>
      </div>

      {/* Shifts Table */}
      <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-surface-muted border-b border-line text-ink-muted font-semibold">
              <tr>
                <th className="py-3 px-4">رقم الوردية</th>
                <th className="py-3 px-4">الكاشير</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">وقت الفتح</th>
                <th className="py-3 px-4">وقت الإغلاق</th>
                <th className="py-3 px-4">عدد الفواتير</th>
                <th className="py-3 px-4">إجمالي المبيعات</th>
                <th className="py-3 px-4">الافتتاحي</th>
                <th className="py-3 px-4">المتوقع بالدرج</th>
                <th className="py-3 px-4">الفعلي المقفول</th>
                <th className="py-3 px-4">الفارق (عجز/زيادة)</th>
                <th className="py-3 px-4 text-center">الخيارات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {filteredShifts.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-ink-muted">
                    لا توجد ورديات مطابقة لخيارات البحث
                  </td>
                </tr>
              ) : (
                filteredShifts.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-ink">
                      #{s.shiftNumber}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-ink">
                      {s.cashierName}
                    </td>
                    <td className="py-3.5 px-4">
                      {s.status === "open" ? (
                        <Badge tone="green">مفتوحة (نشطة)</Badge>
                      ) : (
                        <Badge tone="slate">مقفولة</Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-ink-muted">
                      {formatDateTime(s.openedAt)}
                    </td>
                    <td className="py-3.5 px-4 text-ink-muted">
                      {s.closedAt ? formatDateTime(s.closedAt) : "—"}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-ink">
                      {s.totalSalesCount}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(s.totalSalesAmount, settings.currency)}
                    </td>
                    <td className="py-3.5 px-4 text-ink font-medium">
                      {formatCurrency(s.openingCash, settings.currency)}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-brand-700 dark:text-brand-300">
                      {formatCurrency(s.expectedCash, settings.currency)}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-ink">
                      {typeof s.closingCashActual === "number"
                        ? formatCurrency(s.closingCashActual, settings.currency)
                        : "—"}
                    </td>
                    <td className="py-3.5 px-4 font-bold">
                      {s.difference === undefined || s.difference === 0 ? (
                        <span className="text-emerald-600">مطابق</span>
                      ) : s.difference < 0 ? (
                        <span className="text-rose-600">عجز ({formatCurrency(Math.abs(s.difference), settings.currency)})</span>
                      ) : (
                        <span className="text-blue-600">زيادة ({formatCurrency(s.difference, settings.currency)})</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedShiftForReport(s);
                            setIsShiftReportOpen(true);
                          }}
                        >
                          <FileText className="w-3.5 h-3.5 ml-1" />
                          عرض التقرير
                        </Button>
                        {s.status === "open" && (currentUser?.role === "owner" || s.cashierId === currentUser?.id) && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              setSelectedShiftForClose(s);
                              setIsCloseShiftOpen(true);
                            }}
                          >
                            <Lock className="w-3.5 h-3.5 ml-1" />
                            تقفيل
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shift Dialog Modals */}
      <OpenShiftDialog
        open={isOpenShiftOpen}
        onClose={() => setIsOpenShiftOpen(false)}
      />

      <CloseShiftDialog
        shift={selectedShiftForClose}
        open={isCloseShiftOpen}
        onClose={() => {
          setIsCloseShiftOpen(false);
          setSelectedShiftForClose(null);
        }}
        onPrintZReport={(shiftToPrint) => {
          setSelectedShiftForReport(shiftToPrint);
          setIsShiftReportOpen(true);
        }}
      />

      <ShiftReportModal
        shift={selectedShiftForReport}
        open={isShiftReportOpen}
        onClose={() => {
          setIsShiftReportOpen(false);
          setSelectedShiftForReport(null);
        }}
      />
    </div>
  );
}
