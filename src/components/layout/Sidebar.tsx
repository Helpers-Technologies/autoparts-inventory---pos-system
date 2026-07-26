import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  Factory,
  Users,
  ShoppingBag,
  Receipt,
  Bell,
  Wallet,
  HandCoins,
  BarChart3,
  LineChart,
  Settings,
  LogOut,
  ArrowLeftRight,
  Truck,
  UserRound,
  Shield,
  FileText,
  ClipboardList,
  Upload,
  ChevronDown,
  LifeBuoy,
  Monitor,
  CarFront,
  PackageSearch,
  Link2,
  ShieldCheck,
  Building2,
  BadgeDollarSign,
  Sparkles,
  Megaphone,
  Clock,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { lsGet, lsSet } from "../../lib/storage";
import { useAuth } from "../../store/AuthContext";
import { useSettings } from "../../store/SettingsContext";
import type { AppUser, UserPermissions } from "../../types";
import { hasPermission } from "../../lib/permissions";
import { useFeatures } from "../../lib/useFeatures";
import type { FeatureKey } from "../../lib/features";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  permission?: keyof UserPermissions;
  feature?: FeatureKey;
  ownerOnly?: boolean;
  employeeOnly?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const TOP_ITEMS: NavItem[] = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard },
];

const GROUPS: NavGroup[] = [
  {
    id: "invoices",
    label: "البيع وخدمة السيارة",
    items: [
      { to: "/pos", label: "نقطة البيع (POS)", icon: Monitor, permission: "pos", feature: "pos" },
      { to: "/shifts", label: "ورديات الكاشير", icon: Clock, permission: "pos" },
      { to: "/sales", label: "فواتير المبيعات", icon: Receipt, permission: "salesInvoices", feature: "salesInvoices" },
      { to: "/customer-garage", label: "سيارات العملاء", icon: CarFront, permission: "customers" },
      { to: "/quotations", label: "عروض الأسعار", icon: FileText, permission: "salesInvoices", feature: "quotations" },
      { to: "/returns", label: "المرتجعات", icon: ArrowLeftRight, permission: "returns", feature: "returns" },
      { to: "/warranty-center", label: "مركز الضمان", icon: ShieldCheck, permission: "returns" },
    ],
  },
  {
    id: "inventory",
    label: "كتالوج وتوافق القطع",
    items: [
      { to: "/parts-finder", label: "دليل قطع الغيار", icon: PackageSearch, permission: "products", feature: "products" },
      { to: "/vehicle-catalog", label: "كتالوج السيارات", icon: CarFront, permission: "products", feature: "products" },
      { to: "/part-alternatives", label: "البدائل وCross Reference", icon: Link2, permission: "products", feature: "partAlternatives" },
      { to: "/products", label: "قطع الغيار", icon: Package, permission: "products", feature: "products" },
      { to: "/inventory", label: "المخزون", icon: Warehouse, permission: "inventory", feature: "inventory" },
      { to: "/alerts", label: "التنبيهات", icon: Bell, permission: "alerts", feature: "advancedAlerts" },
    ],
  },
  {
    id: "operations",
    label: "التوريد وتشغيل الفروع",
    items: [
      { to: "/purchases", label: "فواتير المشتريات", icon: ShoppingBag, permission: "purchaseInvoices", feature: "purchaseInvoices" },
      { to: "/purchasing-assistant", label: "مساعد المشتريات", icon: Sparkles, permission: "purchaseInvoices" },
      { to: "/branches", label: "الفروع والتحويلات", icon: Building2, permission: "inventory" },
      { to: "/stocktakes", label: "الجرد الدوري", icon: ClipboardList, permission: "inventory", feature: "stocktakes" },
      { to: "/pricing-rules", label: "شرائح وقواعد الأسعار", icon: BadgeDollarSign, ownerOnly: true },
    ],
  },
  {
    id: "parties",
    label: "العملاء والموردون",
    items: [
      { to: "/customers", label: "العملاء", icon: Users, permission: "customers", feature: "customers" },
      { to: "/marketing", label: "مركز التسويق والنمو", icon: Megaphone, ownerOnly: true, feature: "marketingHub" },
      { to: "/suppliers", label: "الموردين", icon: Factory, permission: "suppliers", feature: "suppliers" },
      { to: "/drivers", label: "السائقين", icon: Truck, permission: "drivers", feature: "drivers" },
    ],
  },
  {
    id: "finance",
    label: "المالية والتقارير",
    items: [
      { to: "/cashbox", label: "الخزينة", icon: Wallet, permission: "cashbox", feature: "cashbox" },
      { to: "/dues", label: "المستحقات", icon: HandCoins, permission: "reports", feature: "dues" },
      { to: "/reports", label: "تقارير قطع الغيار", icon: PackageSearch, permission: "reports", feature: "reports" },
      { to: "/reports/financial", label: "التقارير المالية", icon: BarChart3, permission: "reports", feature: "reports" },
      { to: "/reports/analytics", label: "التحليلات المتقدمة", icon: LineChart, permission: "reports", feature: "advancedAnalytics" },
      { to: "/reports/employees", label: "تقرير الموظفين", icon: Users, ownerOnly: true, feature: "employeesReport" },
    ],
  },
  {
    id: "admin",
    label: "الإدارة",
    items: [
      { to: "/users", label: "المستخدمين", icon: Users, ownerOnly: true },
      { to: "/audit-log", label: "سجل النشاط", icon: Shield, ownerOnly: true, feature: "activityLog" },
      { to: "/import", label: "استيراد البيانات", icon: Upload, permission: "products", feature: "dataImport" },
      { to: "/settings", label: "الإعدادات", icon: Settings, ownerOnly: true },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { to: "/help", label: "المساعدة", icon: LifeBuoy },
  { to: "/my-profile", label: "ملفي الشخصي", icon: UserRound, employeeOnly: true },
];

function canSee(
  item: NavItem,
  user: AppUser | null,
  isFeatureOn: (key: FeatureKey) => boolean
): boolean {
  if (!user) return false;
  if (item.feature && !isFeatureOn(item.feature)) return false;
  if (user.role === "owner") return !item.employeeOnly;
  if (item.ownerOnly) return false;
  if (item.employeeOnly && user.role !== "employee") return false;
  if (item.permission && !hasPermission(user, item.permission)) return false;
  return true;
}

function itemMatchesPath(item: NavItem, pathname: string): boolean {
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(item.to + "/");
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { logout, currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const { pathname } = useLocation();

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    lsGet("sidebarOpenGroups", {})
  );
  useEffect(() => {
    lsSet("sidebarOpenGroups", openGroups);
  }, [openGroups]);

  // Keep the group that contains the current page open so the active item is
  // never hidden behind a collapsed group.
  useEffect(() => {
    const activeGroup = GROUPS.find((g) => g.items.some((i) => itemMatchesPath(i, pathname)));
    if (activeGroup && openGroups[activeGroup.id] === false) {
      setOpenGroups((prev) => ({ ...prev, [activeGroup.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const topItems = TOP_ITEMS.filter((i) => canSee(i, currentUser, isEnabled));
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => canSee(i, currentUser, isEnabled)),
  })).filter((g) => g.items.length > 0);
  const bottomItems = BOTTOM_ITEMS.filter((i) => canSee(i, currentUser, isEnabled));

  const renderItem = (item: NavItem, indented = false) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === "/" || item.to === "/reports"}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          cn(
            "flex items-center h-9 rounded-lg text-sm transition-colors",
            collapsed ? "justify-center px-0 h-10" : indented ? "gap-3 px-3 ms-2" : "gap-3 px-3",
            isActive
              ? "bg-brand-50 text-brand-700 font-medium dark:bg-brand-500/15 dark:text-brand-300"
              : "text-ink-muted hover:bg-surface-muted hover:text-ink"
          )
        }
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className={cn(collapsed && "sr-only")}>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <aside
      className={cn(
        "shrink-0 bg-surface border-e border-line flex flex-col h-screen sticky top-0 transition-[width] duration-200",
        collapsed ? "w-20" : "w-60"
      )}
    >
      <div
        className={cn(
          "border-b border-line flex items-center gap-3",
          collapsed ? "p-3 justify-center" : "p-4"
        )}
      >
        <div
          className={cn(
            "w-10 h-10 rounded-xl grid place-items-center overflow-hidden shrink-0",
            !settings.logoImage && "bg-gradient-to-br from-brand-600 to-brand-800 text-white font-bold"
          )}
        >
          {settings.logoImage ? (
            <img src={settings.logoImage} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            settings.logoText || "AP"
          )}
        </div>
        <div className={cn("min-w-0 flex-1", collapsed && "hidden")}>
          <div className="font-semibold text-ink truncate text-sm">
            {settings.arabicLabels ? settings.companyNameAr : settings.companyName}
          </div>
          <div className="text-[11px] text-ink-faint">نظام قطع الغيار والمبيعات</div>
        </div>
      </div>
      <nav className={cn("p-2 flex-1 overflow-y-auto", collapsed && "space-y-1")}>
        {collapsed ? (
          // icon-only mode: flat list, groups add nothing at this width
          [...topItems, ...groups.flatMap((g) => g.items), ...bottomItems].map((item) =>
            renderItem(item)
          )
        ) : (
          <>
            {topItems.map((item) => renderItem(item))}
            {groups.map((group) => {
              const open = openGroups[group.id] ?? true;
              return (
                <div key={group.id} className="mt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))
                    }
                    className="w-full flex items-center justify-between px-3 h-8 text-[11px] font-bold text-ink-faint hover:text-ink-muted uppercase tracking-wide"
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      className={cn("w-3.5 h-3.5 transition-transform", !open && "-rotate-90")}
                    />
                  </button>
                  {open ? (
                    <div className="space-y-0.5">
                      {group.items.map((item) => renderItem(item, true))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {bottomItems.length > 0 ? (
              <div className="mt-1 pt-1 border-t border-line">
                {bottomItems.map((item) => renderItem(item))}
              </div>
            ) : null}
          </>
        )}
      </nav>
      <div className="p-3 border-t border-line">
        <button
          type="button"
          onClick={logout}
          title={collapsed ? "تسجيل الخروج" : undefined}
          className={cn(
            "w-full flex items-center h-10 rounded-lg text-sm text-ink-muted hover:bg-surface-muted hover:text-ink",
            collapsed ? "justify-center px-0" : "gap-3 px-3"
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span className={cn(collapsed && "sr-only")}>تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  );
}
