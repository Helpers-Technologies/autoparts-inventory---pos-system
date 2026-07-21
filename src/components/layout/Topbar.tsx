import { useLocation, useNavigate } from "react-router-dom";
import { Search, Bell, ChevronDown, User, Lock, PanelRightClose, PanelRightOpen, Sun, Moon, Monitor } from "lucide-react";
import { useAuth } from "../../store/AuthContext";
import { useSettings } from "../../store/SettingsContext";
import { useCatalog } from "../../store/CatalogContext";
import { useInvoicing } from "../../store/InvoicingContext";
import { useMemo, useState, useEffect } from "react";
import { formatDate } from "../../lib/format";
import { hasPermission } from "../../lib/permissions";
import { useFeatures } from "../../lib/useFeatures";
import { useTheme } from "../../lib/useTheme";
import type { Theme } from "../../lib/useTheme";

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

// order matters: more specific paths must precede their prefixes (startsWith match)
const TITLES: Record<string, string> = {
  "/": "لوحة التحكم",
  "/products": "المنتجات",
  "/inventory": "المخزون",
  "/stocktakes": "الجرد الدوري",
  "/suppliers": "الموردين",
  "/customers": "العملاء",
  "/drivers": "السائقين",
  "/purchases": "فواتير المشتريات",
  "/sales": "فواتير المبيعات",
  "/quotations": "عروض الأسعار",
  "/returns": "المرتجعات",
  "/alerts": "التنبيهات",
  "/cashbox": "الخزينة",
  "/dues": "المستحقات",
  "/reports/employees": "تقرير الموظفين",
  "/reports": "التقارير",
  "/import": "استيراد البيانات",
  "/users": "المستخدمين",
  "/audit-log": "سجل النشاط",
  "/my-profile": "ملفي الشخصي",
  "/settings": "الإعدادات",
};

export function Topbar({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSearch,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
}) {
  const loc = useLocation();
  const navigate = useNavigate();
  const { auth, logout, lockSession, currentUser } = useAuth();
  const { settings } = useSettings();
  const { products } = useCatalog();
  const { purchaseInvoices, salesInvoices } = useInvoicing();
  const { isEnabled } = useFeatures();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  function cycleTheme() {
    const order: Theme[] = ["light", "dark", "system"];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  }

  // Enforce light mode if the dark mode feature is disabled by license or settings
  useEffect(() => {
    if (!isEnabled("darkMode") && theme !== "light") {
      setTheme("light");
    }
  }, [isEnabled, theme, setTheme]);

  const alertCount = useMemo(() => {
    const outOfStock = products.filter((p) => p.quantity === 0).length;
    const overdueAccounts = salesInvoices.filter((inv) => {
      if (inv.paymentType !== "account" || inv.remaining <= 0 || inv.cancelled || !inv.paymentDueDate) return false;
      return new Date(inv.paymentDueDate) < new Date();
    }).length;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (settings.paymentTermDays ?? 7));
    const overdueSuppliers = purchaseInvoices.filter((p) => p.remaining > 0 && new Date(p.date) < cutoff).length;
    return outOfStock + overdueAccounts + overdueSuppliers;
  }, [products, salesInvoices, purchaseInvoices, settings.paymentTermDays]);

  const canViewAlerts = hasPermission(currentUser, "alerts") && isEnabled("advancedAlerts");
  const accountName = currentUser?.name || auth.username || "مدير";

  const title = useMemo(() => {
    for (const key of Object.keys(TITLES)) {
      if (loc.pathname === key || loc.pathname.startsWith(key + "/")) return TITLES[key];
    }
    return "نظام المخزون";
  }, [loc.pathname]);

  return (
    <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur border-b border-line h-14 flex items-center gap-4 px-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "فتح القائمة" : "طي القائمة"}
          aria-label={sidebarCollapsed ? "فتح القائمة" : "طي القائمة"}
          className="w-9 h-9 rounded-lg border border-line text-ink-muted hover:bg-surface-muted hover:text-ink grid place-items-center transition-colors shrink-0"
        >
          {sidebarCollapsed ? (
            <PanelRightOpen className="w-4 h-4" />
          ) : (
            <PanelRightClose className="w-4 h-4" />
          )}
        </button>
        <div className="text-sm text-ink-muted">اليوم {formatDate(new Date().toISOString())}</div>
        <span className="text-line">|</span>
        <h1 className="font-semibold text-ink text-base truncate">{title}</h1>
      </div>
      <button
        onClick={onOpenSearch}
        className="flex-1 max-w-md h-9 flex items-center gap-2 px-3 rounded-lg border border-line bg-surface-muted text-sm text-ink-faint hover:bg-surface hover:border-line transition-colors text-right"
      >
        <Search className="w-4 h-4 shrink-0" />
        <span className="flex-1">بحث شامل عن منتج، عميل، فاتورة...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] font-mono text-ink-faint">
          {IS_MAC ? "⌘" : "Ctrl"} K
        </kbd>
      </button>
      <div className="flex items-center gap-2 ms-auto">
        {isEnabled("darkMode") ? (
          <button
            type="button"
            onClick={cycleTheme}
            title={theme === "light" ? "وضع النهار" : theme === "dark" ? "وضع الليل" : "تلقائي (النظام)"}
            className="w-9 h-9 rounded-lg hover:bg-surface-muted grid place-items-center text-ink-muted transition-colors"
          >
            {theme === "dark" ? (
              <Moon className="w-4 h-4" />
            ) : theme === "system" ? (
              <Monitor className="w-4 h-4" />
            ) : (
              <Sun className="w-4 h-4" />
            )}
          </button>
        ) : null}
        {canViewAlerts ? (
          <button
            onClick={() => navigate("/alerts")}
            className="relative w-9 h-9 rounded-lg hover:bg-surface-muted grid place-items-center text-ink-muted"
          >
            <Bell className="w-4 h-4" />
            {alertCount > 0 && (
              alertCount < 10 ? (
                <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center px-1">
                  {alertCount}
                </span>
              ) : (
                <span className="absolute top-0.5 end-0.5 w-2.5 h-2.5 rounded-full bg-red-500" />
              )
            )}
          </button>
        ) : null}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 px-2 h-9 rounded-lg hover:bg-surface-muted"
          >
            <div className="w-7 h-7 rounded-full bg-brand-600 text-white grid place-items-center text-xs">
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="text-sm text-ink">
              {accountName}
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-ink-faint" />
          </button>
          {open ? (
            <div
              className="absolute top-11 end-0 bg-surface border border-line rounded-lg shadow-lg w-48 py-1 z-30"
              onMouseLeave={() => setOpen(false)}
            >
              {currentUser?.role === "employee" ? (
                <button
                  className="w-full text-right px-3 py-2 text-sm text-ink hover:bg-surface-muted"
                  onClick={() => {
                    setOpen(false);
                    navigate("/my-profile");
                  }}
                >
                  ملفي الشخصي
                </button>
              ) : (
                <button
                  className="w-full text-right px-3 py-2 text-sm text-ink hover:bg-surface-muted"
                  onClick={() => {
                    setOpen(false);
                    navigate("/settings");
                  }}
                >
                  الإعدادات
                </button>
              )}
              {(settings.idleLockMinutes ?? 0) > 0 && (
                <button
                  className="w-full text-right px-3 py-2 text-sm hover:bg-surface-muted flex items-center gap-2"
                  onClick={() => {
                    setOpen(false);
                    lockSession();
                  }}
                >
                  <Lock className="w-3.5 h-3.5 text-ink-faint" />
                  قفل الجلسة
                </button>
              )}
              <button
                className="w-full text-right px-3 py-2 text-sm hover:bg-surface-muted text-red-600 dark:text-red-400"
                onClick={() => {
                  setOpen(false);
                  logout();
                }}
              >
                تسجيل الخروج
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
