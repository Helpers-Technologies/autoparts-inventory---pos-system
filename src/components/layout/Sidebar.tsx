import { useEffect, useMemo, useState } from "react";
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
  Database,
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
  PanelRightClose,
  Search,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { lsGet, lsSet } from "../../lib/storage";
import { useAuth } from "../../store/AuthContext";
import { useSettings } from "../../store/SettingsContext";
import type { AppUser, UserPermissions } from "../../types";
import { hasPermission } from "../../lib/permissions";
import { useFeatures } from "../../lib/useFeatures";
import { isFuzzyMatch } from "../../lib/fuzzySearch";
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
  /** Shown on the group header so a collapsed sidebar still reads as a map. */
  icon: ComponentType<{ className?: string }>;
  items: NavItem[];
};

const TOP_ITEMS: NavItem[] = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard },
];

const GROUPS: NavGroup[] = [
  {
    id: "sales",
    label: "المبيعات والكاشير",
    icon: Receipt,
    items: [
      {
        to: "/pos",
        label: "نقطة البيع (POS)",
        icon: Monitor,
        permission: "pos",
        feature: "pos",
      },
      {
        to: "/shifts",
        label: "ورديات الكاشير",
        icon: Clock,
        permission: "pos",
        feature: "pos",
      },
      {
        to: "/sales",
        label: "فواتير المبيعات",
        icon: Receipt,
        permission: "salesInvoices",
        feature: "salesInvoices",
      },
      {
        to: "/shipping",
        label: "إدارة التوصيل والشحن",
        icon: Truck,
        permission: "salesInvoices",
        feature: "shippingManagement",
      },
      {
        to: "/customer-garage",
        label: "سيارات العملاء",
        icon: CarFront,
        permission: "customers",
        feature: "vehicleCatalog",
      },
      {
        to: "/quotations",
        label: "عروض الأسعار",
        icon: FileText,
        permission: "salesInvoices",
        feature: "quotations",
      },
      {
        to: "/returns",
        label: "المرتجعات",
        icon: ArrowLeftRight,
        permission: "returns",
        feature: "returns",
      },
      {
        to: "/warranty-center",
        label: "مركز الضمان",
        icon: ShieldCheck,
        permission: "returns",
        feature: "warrantyCenter",
      },
    ],
  },
  {
    id: "catalog",
    label: "الكتالوج وقطع الغيار",
    icon: Package,
    items: [
      {
        to: "/products",
        label: "قطع الغيار والأسعار",
        icon: Package,
        permission: "products",
        feature: "products",
      },
      {
        to: "/inventory",
        label: "مخزون الفروع",
        icon: Warehouse,
        permission: "inventory",
        feature: "inventory",
      },
      {
        to: "/vehicle-catalog",
        label: "كتالوج توافق السيارات",
        icon: CarFront,
        permission: "products",
        feature: "vehicleCatalog",
      },
      {
        to: "/part-alternatives",
        label: "بدائل قطع الغيار",
        icon: Link2,
        permission: "products",
        feature: "partAlternatives",
      },
      {
        to: "/parts-finder",
        label: "مستكشف ودليل القطع",
        icon: PackageSearch,
        permission: "products",
        feature: "vehicleCatalog",
      },
      {
        to: "/alerts",
        label: "تنبيهات المخزون",
        icon: Bell,
        permission: "alerts",
        feature: "alerts",
      },
    ],
  },
  {
    id: "purchases",
    label: "المشتريات والتوريد",
    icon: ShoppingBag,
    items: [
      {
        to: "/purchases",
        label: "فواتير المشتريات",
        icon: ShoppingBag,
        permission: "purchaseInvoices",
        feature: "purchaseInvoices",
      },
      {
        to: "/purchasing-assistant",
        label: "مساعد المشتريات الذكي",
        icon: Sparkles,
        permission: "purchaseInvoices",
        feature: "purchasingAssistant",
      },
      {
        to: "/branches",
        label: "الفروع والتحويلات",
        icon: Building2,
        permission: "inventory",
      },
      {
        to: "/stocktakes",
        label: "الجرد الدوري",
        icon: ClipboardList,
        permission: "inventory",
        feature: "stocktakes",
      },
      {
        to: "/pricing-rules",
        label: "شرائح وقواعد الأسعار",
        icon: BadgeDollarSign,
        ownerOnly: true,
        feature: "pricingRules",
      },
    ],
  },
  {
    id: "crm",
    label: "العملاء والموردون",
    icon: Users,
    items: [
      {
        to: "/customers",
        label: "إدارة العملاء",
        icon: Users,
        permission: "customers",
        feature: "customers",
      },
      {
        to: "/suppliers",
        label: "إدارة الموردين",
        icon: Factory,
        permission: "suppliers",
        feature: "suppliers",
      },
      {
        to: "/drivers",
        label: "السائقين والتوصيل",
        icon: Truck,
        permission: "drivers",
        feature: "drivers",
      },
      {
        to: "/marketing",
        label: "مركز التسويق والنمو",
        icon: Megaphone,
        ownerOnly: true,
        feature: "marketingHub",
      },
    ],
  },
  {
    id: "finance",
    label: "المالية والتقارير",
    icon: Wallet,
    items: [
      {
        to: "/cashbox",
        label: "الخزينة والمقبوضات",
        icon: Wallet,
        permission: "cashbox",
        feature: "cashbox",
      },
      {
        to: "/employees",
        label: "الموظفين والمرتبات",
        icon: Users,
        ownerOnly: true,
        feature: "employeePayroll",
      },
      {
        to: "/dues",
        label: "المستحقات والذمم",
        icon: HandCoins,
        permission: "reports",
        feature: "dues",
      },
      {
        to: "/reports",
        label: "تقارير قطع الغيار",
        icon: PackageSearch,
        permission: "reports",
        feature: "reports",
      },
      {
        to: "/reports/financial",
        label: "التقارير المالية والربحية",
        icon: BarChart3,
        permission: "reports",
        feature: "reports",
      },
      {
        to: "/reports/analytics",
        label: "التحليلات المتقدمة",
        icon: LineChart,
        permission: "reports",
        feature: "advancedAnalytics",
      },
      {
        to: "/reports/employees",
        label: "تقرير أداء الموظفين",
        icon: Users,
        ownerOnly: true,
        feature: "employeesReport",
      },
    ],
  },
  {
    id: "admin",
    label: "إدارة النظام",
    icon: Shield,
    items: [
      {
        to: "/users",
        label: "المستخدمين والصلاحيات",
        icon: Users,
        ownerOnly: true,
      },
      {
        to: "/audit-log",
        label: "سجل عمليات النظام",
        icon: Shield,
        ownerOnly: true,
        feature: "activityLog",
      },
      {
        to: "/backup-and-restore",
        label: "النسخ الاحتياطي والاسترداد",
        icon: Database,
        ownerOnly: true,
      },
      {
        to: "/settings",
        label: "إعدادات النظام",
        icon: Settings,
        ownerOnly: true,
      },
      {
        to: "/license-and-updates",
        label: "الترخيص والتحديثات",
        icon: ShieldCheck,
        ownerOnly: true,
      },
      {
        to: "/integrations",
        label: "مركز الربط والتكاملات",
        icon: Link2,
        ownerOnly: true,
        feature: "bostaIntegration",
      },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { to: "/help", label: "المساعدة", icon: LifeBuoy },
  {
    to: "/my-profile",
    label: "ملفي الشخصي",
    icon: UserRound,
    employeeOnly: true,
  },
];

function canSee(
  item: NavItem,
  user: AppUser | null,
  isFeatureOn: (key: FeatureKey) => boolean,
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

export function Sidebar({
  collapsed,
  onClose,
}: {
  collapsed: boolean;
  onClose?: () => void;
}) {
  const { logout, currentUser } = useAuth();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const { pathname } = useLocation();

  // One group open at a time. Every group used to default to open, which put
  // 35 links in a column taller than the window — the list the shop described
  // as "طويلة جدًا" and easy to get lost in. An accordion keeps the sidebar to
  // six headers plus the section actually being worked in.
  const [openGroup, setOpenGroup] = useState<string | null>(() =>
    lsGet<string | null>("sidebarOpenGroup", null),
  );
  useEffect(() => {
    lsSet("sidebarOpenGroup", openGroup);
  }, [openGroup]);

  // The group holding the current page is the one that should be open, so
  // navigating from anywhere (search, a link, a redirect) leaves the sidebar
  // showing where you are.
  useEffect(() => {
    const activeGroup = GROUPS.find((g) =>
      g.items.some((i) => itemMatchesPath(i, pathname)),
    );
    if (activeGroup) setOpenGroup(activeGroup.id);
  }, [pathname]);

  const [query, setQuery] = useState("");

  const topItems = TOP_ITEMS.filter((i) => canSee(i, currentUser, isEnabled));
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => canSee(i, currentUser, isEnabled)),
  })).filter((g) => g.items.length > 0);
  const bottomItems = BOTTOM_ITEMS.filter((i) =>
    canSee(i, currentUser, isEnabled),
  );

  // Typing beats remembering which of six groups a screen lives under. While
  // there is a query the groups are set aside entirely and the matches are
  // listed flat, each labelled with the group it came from.
  const searchResults = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    const all = [
      ...topItems.map((item) => ({ item, group: "" })),
      ...groups.flatMap((group) => group.items.map((item) => ({ item, group: group.label }))),
      ...bottomItems.map((item) => ({ item, group: "" })),
    ];
    return all.filter(({ item, group }) => isFuzzyMatch(trimmed, [item.label, group]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, currentUser, isEnabled]);

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
            collapsed
              ? "justify-center px-0 h-10"
              : indented
                ? "gap-3 px-3 ms-2"
                : "gap-3 px-3",
            isActive
              ? "bg-brand-50 text-brand-700 font-medium dark:bg-brand-500/15 dark:text-brand-300"
              : "text-ink-muted hover:bg-surface-muted hover:text-ink",
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
        collapsed ? "w-20" : "w-60",
      )}
    >
      <div
        className={cn(
          "border-b border-line flex items-center gap-3",
          collapsed ? "p-3 justify-center" : "p-4",
        )}
      >
        <div
          className={cn(
            "w-10 h-10 rounded-xl grid place-items-center overflow-hidden shrink-0",
            !settings.logoImage &&
              "bg-gradient-to-br from-brand-600 to-brand-800 text-white font-bold",
          )}
        >
          {settings.logoImage ? (
            <img
              src={settings.logoImage}
              alt="Logo"
              className="w-full h-full object-contain"
            />
          ) : (
            settings.logoText || "AP"
          )}
        </div>
        <div className={cn("min-w-0 flex-1", collapsed && "hidden")}>
          <div className="font-semibold text-ink truncate text-sm">
            {settings.arabicLabels
              ? settings.companyNameAr
              : settings.companyName}
          </div>
          <div className="text-[11px] text-ink-faint">
            نظام قطع الغيار والمبيعات
          </div>
        </div>
        {onClose && !collapsed ? (
          <button
            type="button"
            onClick={onClose}
            title="إغلاق القائمة"
            aria-label="إغلاق القائمة"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink-muted transition hover:bg-surface-muted hover:text-ink"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="px-2 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث عن صفحة..."
              aria-label="ابحث عن صفحة"
              className="h-8 w-full rounded-lg border border-line bg-surface-muted/50 px-2.5 pe-8 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-brand-500 focus:bg-surface focus:ring-2 focus:ring-brand-500/20"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="مسح البحث"
                className="absolute start-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-faint transition hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <nav
        className={cn("p-2 flex-1 overflow-y-auto", collapsed && "space-y-1")}
      >
        {collapsed ? (
          // icon-only mode: flat list, groups add nothing at this width
          [...topItems, ...groups.flatMap((g) => g.items), ...bottomItems].map(
            (item) => renderItem(item),
          )
        ) : searchResults ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-faint">
              مفيش صفحة بالاسم ده
            </p>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map(({ item, group }) => (
                <div key={item.to}>
                  {renderItem(item)}
                  {group ? (
                    <div className="px-3 pb-1 text-[10px] text-ink-faint">{group}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {topItems.map((item) => renderItem(item))}
            {groups.map((group) => {
              const open = openGroup === group.id;
              const GroupIcon = group.icon;
              const hasActive = group.items.some((item) => itemMatchesPath(item, pathname));
              return (
                <div key={group.id} className="mt-1">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenGroup(open ? null : group.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 h-9 rounded-lg text-[11px] font-bold tracking-wide transition-colors",
                      open || hasActive
                        ? "text-ink bg-surface-muted/60"
                        : "text-ink-faint hover:bg-surface-muted/40 hover:text-ink-muted",
                    )}
                  >
                    <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 text-start">{group.label}</span>
                    {!open && hasActive ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    ) : null}
                    <span className="text-[10px] font-semibold text-ink-faint">
                      {group.items.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 shrink-0 transition-transform",
                        !open && "-rotate-90",
                      )}
                    />
                  </button>
                  {open ? (
                    <div className="mt-0.5 space-y-0.5 border-e-2 border-line pe-1">
                      {group.items.map((item) => renderItem(item, true))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {bottomItems.length > 0 ? (
              <div className="mt-2 pt-2 border-t border-line">
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
            collapsed ? "justify-center px-0" : "gap-3 px-3",
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span className={cn(collapsed && "sr-only")}>تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  );
}
