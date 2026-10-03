import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Database, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

type UpgradeState = "NOT_REQUIRED" | "REQUIRED" | "PREPARING" | "BUILDING" | "VALIDATING" | "FINALIZING" | "COMPLETE" | "FAILED" | "INTERRUPTED";
type UpgradeStatus = {
  state: UpgradeState;
  percent: number;
  processedRecords: number;
  totalRecords: number;
  entity?: string;
  chunk?: number;
  chunks?: number;
  detail?: string;
  errorCode?: string;
};

const stageLabel: Record<UpgradeState, string> = {
  NOT_REQUIRED: "جاهز",
  REQUIRED: "التحضير للترقية",
  PREPARING: "تجهيز بنية البيانات",
  BUILDING: "تنظيم سجلات العمل",
  VALIDATING: "التحقق من سلامة النتائج",
  FINALIZING: "إنهاء الترقية بأمان",
  COMPLETE: "اكتملت الترقية",
  FAILED: "تعذر إكمال الترقية",
  INTERRUPTED: "استكمال ترقية سابقة",
};

const entityLabel: Record<string, string> = {
  salesInvoices: "فواتير البيع", purchaseInvoices: "فواتير الشراء", customers: "العملاء",
  suppliers: "الموردون", products: "الأصناف", salesReturns: "مرتجعات البيع",
  purchaseReturns: "مرتجعات الشراء", quotations: "عروض الأسعار", cashEntries: "حركات الخزينة",
  stockMovements: "حركات المخزون", mobileStockOpReceipts: "عمليات المخزون من الهاتف",
};

function number(value: number) {
  return new Intl.NumberFormat("ar-EG").format(Math.max(0, value || 0));
}

export function ProjectionUpgradeGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [status, setStatus] = useState<UpgradeStatus | null>(null);
  const [ready, setReady] = useState(!enabled);
  const started = useRef(false);

  const start = useCallback(async () => {
    if (!window.desktopAPI?.projection) {
      setReady(true);
      return;
    }
    started.current = true;
    const next = await window.desktopAPI.projection.start();
    setStatus(next);
  }, []);

  useEffect(() => {
    if (!enabled || !window.desktopAPI?.projection) {
      setReady(true);
      return;
    }
    setReady(false);
    const unsubscribe = window.desktopAPI.projection.onProgress((next) => {
      setStatus(next);
      if (next.state === "COMPLETE" || next.state === "NOT_REQUIRED") setReady(true);
    });
    void window.desktopAPI.projection.getStatus().then((next) => {
      setStatus(next);
      if (next.state === "NOT_REQUIRED" || next.state === "COMPLETE") {
        setReady(true);
        return;
      }
      if (["REQUIRED", "INTERRUPTED"].includes(next.state) && !started.current) {
        requestAnimationFrame(() => void start());
      }
    }).catch(() => setStatus({ state: "FAILED", percent: 0, processedRecords: 0, totalRecords: 0, errorCode: "status_unavailable" }));
    return unsubscribe;
  }, [enabled, start]);

  if (ready) return children;
  const current = status ?? { state: "PREPARING" as const, percent: 0, processedRecords: 0, totalRecords: 0 };
  const failed = current.state === "FAILED";
  const active = ["PREPARING", "BUILDING", "VALIDATING", "FINALIZING"].includes(current.state);

  return (
    <main className="min-h-screen bg-canvas px-6 py-10" dir="rtl" data-testid="projection-upgrade-screen">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-2xl items-center">
        <div className="w-full rounded-3xl border border-line bg-surface p-8 shadow-xl sm:p-10">
          <div className="mb-7 flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              {failed ? <TriangleAlert size={28} /> : active ? <Loader2 className="animate-spin" size={28} /> : <Database size={28} />}
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-600">تحديث لمرة واحدة</p>
              <h1 className="mt-1 text-2xl font-bold text-ink">PartFlow يجهز قاعدة البيانات لهذا الإصدار</h1>
            </div>
          </div>

          {failed ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-5">
              <h2 className="font-bold text-red-600">تعذر إكمال التجهيز بأمان</h2>
              <p className="mt-2 text-sm leading-7 text-ink-muted">
                بيانات المبيعات والمخزون الأصلية لم تتغير. يمكنك إعادة المحاولة، وسيعيد PartFlow إنشاء بيانات العرض المشتقة فقط.
              </p>
              <button type="button" onClick={() => void start()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white hover:opacity-90">
                <RefreshCw size={18} /> إعادة المحاولة
              </button>
            </div>
          ) : (
            <>
              <p className="leading-7 text-ink-muted">
                ننظم هياكل محلية مساعدة لتسريع البحث والتقارير. قد يستغرق ذلك عدة دقائق حسب حجم البيانات، ويمكنك إغلاق البرنامج بأمان وإعادة المحاولة لاحقًا.
              </p>
              <div className="mt-7" aria-live="polite" role="status">
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <span className="font-semibold text-ink">{stageLabel[current.state]}</span>
                  <span className="tabular-nums text-ink-muted">{Math.floor(current.percent)}٪</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${Math.max(1, Math.min(100, current.percent))}%` }} />
                </div>
                <div className="mt-4 grid gap-2 text-sm text-ink-muted sm:grid-cols-2">
                  <span>السجلات: {number(current.processedRecords)} من {number(current.totalRecords)}</span>
                  <span>{current.entity ? `${entityLabel[current.entity] ?? current.entity}${current.chunks ? ` · جزء ${number(current.chunk ?? 0)} من ${number(current.chunks)}` : ""}` : "جارٍ التحقق من البيانات"}</span>
                </div>
              </div>
            </>
          )}

          <div className="mt-8 flex items-start gap-3 rounded-2xl bg-surface-muted p-4 text-sm leading-6 text-ink-muted">
            {current.state === "COMPLETE" ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} /> : <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={20} />}
            <span>لا تُحذف قاعدة بياناتك الأساسية أثناء هذه العملية، ولا يعتبر PartFlow أي نتيجة غير مكتملة صالحة للاستخدام.</span>
          </div>
        </div>
      </section>
    </main>
  );
}
