import type { AppUser, UserPermissions } from "../types";

export type PermissionModule = keyof UserPermissions;

export const PERMISSION_GROUPS: {
  key: PermissionModule;
  label: string;
  description: string;
  actions: { key: string; label: string }[];
}[] = [
  {
    key: "products",
    label: "المنتجات",
    description: "قائمة المنتجات وبيانات الأسعار",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة" },
      { key: "edit", label: "تعديل" },
      { key: "delete", label: "حذف" },
    ],
  },
  {
    key: "inventory",
    label: "المخزون",
    description: "كميات المنتجات وحركات المخزون",
    actions: [
      { key: "view", label: "عرض" },
      { key: "adjust", label: "تسوية" },
    ],
  },
  {
    key: "purchaseInvoices",
    label: "فواتير المشتريات",
    description: "مشتريات الموردين وسداد المستحقات",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة" },
      { key: "edit", label: "تعديل" },
      { key: "pay", label: "سداد" },
      { key: "delete", label: "حذف" },
    ],
  },
  {
    key: "salesInvoices",
    label: "فواتير المبيعات",
    description: "مبيعات العملاء والتحصيل والإلغاء",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة" },
      { key: "edit", label: "تعديل" },
      { key: "receive", label: "تحصيل" },
      { key: "cancel", label: "إلغاء" },
      { key: "delete", label: "حذف" },
    ],
  },
  {
    key: "customers",
    label: "العملاء",
    description: "بيانات العملاء وأرصدتهم",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة" },
      { key: "edit", label: "تعديل" },
      { key: "delete", label: "حذف" },
    ],
  },
  {
    key: "suppliers",
    label: "الموردين",
    description: "بيانات الموردين والبونص",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة" },
      { key: "edit", label: "تعديل" },
      { key: "delete", label: "حذف" },
      { key: "commissions", label: "البونص" },
    ],
  },
  {
    key: "drivers",
    label: "السائقين",
    description: "بيانات السائقين ورحلاتهم",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة" },
      { key: "edit", label: "تعديل" },
      { key: "delete", label: "حذف" },
    ],
  },
  {
    key: "returns",
    label: "المرتجعات",
    description: "مرتجعات البيع والشراء",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة" },
    ],
  },
  {
    key: "alerts",
    label: "التنبيهات",
    description: "الصلاحية والمخزون والمديونيات",
    actions: [{ key: "view", label: "عرض" }],
  },
  {
    key: "cashbox",
    label: "الخزينة",
    description: "الرصيد والحركات اليدوية",
    actions: [
      { key: "view", label: "عرض" },
      { key: "add", label: "إضافة نقدية" },
      { key: "spend", label: "صرف نقدي" },
      { key: "editOpeningBalance", label: "تعديل افتتاحي" },
    ],
  },
  {
    key: "reports",
    label: "التقارير",
    description: "تقارير الأداء والأرصدة",
    actions: [{ key: "view", label: "عرض" }],
  },
];

export function createPermissions(enabled = false): UserPermissions {
  return {
    products: { view: enabled, add: enabled, edit: enabled, delete: enabled },
    inventory: { view: enabled, adjust: enabled },
    purchaseInvoices: { view: enabled, add: enabled, edit: enabled, pay: enabled, delete: enabled },
    salesInvoices: { view: enabled, add: enabled, edit: enabled, receive: enabled, cancel: enabled, delete: enabled },
    customers: { view: enabled, add: enabled, edit: enabled, delete: enabled },
    suppliers: { view: enabled, add: enabled, edit: enabled, delete: enabled, commissions: enabled },
    drivers: { view: enabled, add: enabled, edit: enabled, delete: enabled },
    returns: { view: enabled, add: enabled },
    alerts: { view: enabled },
    cashbox: { view: enabled, add: enabled, spend: enabled, editOpeningBalance: enabled },
    reports: { view: enabled },
  };
}

export function normalizePermissions(input?: Partial<UserPermissions> | null): UserPermissions {
  const permissions = createPermissions(false);
  const source = (input ?? {}) as Record<string, Record<string, boolean> | undefined>;

  for (const group of PERMISSION_GROUPS) {
    const groupSource = source[group.key];
    for (const action of group.actions) {
      const value = groupSource?.[action.key];
      if (typeof value === "boolean") {
        (permissions[group.key] as Record<string, boolean>)[action.key] = value;
      }
    }
  }

  const legacyProducts = source.products;
  const legacyPurchases = source.purchaseInvoices;
  const legacySales = source.salesInvoices;
  const legacyCustomers = source.customers;
  const legacySuppliers = source.suppliers;
  const legacyCashbox = source.cashbox;

  if (!source.inventory) {
    permissions.inventory.view = Boolean(legacyProducts?.view);
    permissions.inventory.adjust = Boolean(legacyProducts?.edit);
  }
  if (!source.alerts) {
    permissions.alerts.view = Boolean(legacyProducts?.view);
  }
  if (!source.drivers) {
    permissions.drivers.view = Boolean(legacySales?.view);
    permissions.drivers.add = Boolean(legacySales?.add);
    permissions.drivers.edit = Boolean(legacySales?.add);
    permissions.drivers.delete = Boolean(legacySales?.add);
  }
  if (!source.returns) {
    permissions.returns.view = Boolean(legacySales?.view || legacyPurchases?.view);
    permissions.returns.add = Boolean(legacySales?.add || legacyPurchases?.add);
  }
  if (legacyPurchases && typeof legacyPurchases.edit !== "boolean") {
    permissions.purchaseInvoices.edit = false;
  }
  if (legacyPurchases && typeof legacyPurchases.pay !== "boolean") {
    permissions.purchaseInvoices.pay = Boolean(legacyPurchases.add);
  }
  if (legacyPurchases && typeof legacyPurchases.delete !== "boolean") {
    permissions.purchaseInvoices.delete = Boolean(legacyPurchases.add);
  }
  if (legacySales && typeof legacySales.edit !== "boolean") {
    permissions.salesInvoices.edit = false;
  }
  if (legacySales && typeof legacySales.receive !== "boolean") {
    permissions.salesInvoices.receive = Boolean(legacySales.add);
  }
  if (legacySales && typeof legacySales.cancel !== "boolean") {
    permissions.salesInvoices.cancel = Boolean(legacySales.add);
  }
  if (legacySales && typeof legacySales.delete !== "boolean") {
    permissions.salesInvoices.delete = Boolean(legacySales.add);
  }
  if (legacyCustomers && typeof legacyCustomers.delete !== "boolean") {
    permissions.customers.delete = Boolean(legacyCustomers.edit);
  }
  if (legacySuppliers && typeof legacySuppliers.delete !== "boolean") {
    permissions.suppliers.delete = Boolean(legacySuppliers.edit);
  }
  if (legacySuppliers && typeof legacySuppliers.commissions !== "boolean") {
    permissions.suppliers.commissions = Boolean(legacySuppliers.edit);
  }
  if (legacyCashbox && typeof legacyCashbox.add !== "boolean") {
    permissions.cashbox.add = Boolean(legacyCashbox.view);
  }
  if (legacyCashbox && typeof legacyCashbox.spend !== "boolean") {
    permissions.cashbox.spend = Boolean(legacyCashbox.view);
  }
  if (legacyCashbox && typeof legacyCashbox.editOpeningBalance !== "boolean") {
    permissions.cashbox.editOpeningBalance = Boolean(legacyCashbox.view);
  }

  for (const group of PERMISSION_GROUPS) {
    const nextGroup = permissions[group.key] as Record<string, boolean>;
    const hasAction = group.actions.some((action) => action.key !== "view" && nextGroup[action.key]);
    if (hasAction) nextGroup.view = true;
    if (!nextGroup.view) {
      group.actions.forEach((action) => {
        if (action.key !== "view") nextGroup[action.key] = false;
      });
    }
  }

  return permissions;
}

export function normalizeUser(user: AppUser): AppUser {
  const cleanUsername = String(user.username || "").trim();
  const cleanName = String(user.name || cleanUsername).trim();

  return {
    ...user,
    name: cleanName || cleanUsername,
    permissions: normalizePermissions(user.permissions),
  };
}

export function hasPermission(
  user: AppUser | null | undefined,
  module: PermissionModule,
  action = "view"
) {
  if (!user) return false;
  if (user.role === "owner") return true;
  const permissions = normalizePermissions(user.permissions);
  return Boolean((permissions[module] as Record<string, boolean> | undefined)?.[action]);
}

export function setPermission(
  permissions: UserPermissions,
  module: PermissionModule,
  action: string,
  value: boolean
): UserPermissions {
  const normalized = normalizePermissions(permissions);
  const group = PERMISSION_GROUPS.find((item) => item.key === module);
  const nextGroup = {
    ...normalized[module],
    [action]: value,
  } as Record<string, boolean>;

  if (action !== "view" && value) {
    nextGroup.view = true;
  }
  if (action === "view" && !value && group) {
    group.actions.forEach((item) => {
      if (item.key !== "view") nextGroup[item.key] = false;
    });
  }

  return {
    ...normalized,
    [module]: nextGroup,
  };
}

export function setPermissionGroup(
  permissions: UserPermissions,
  module: PermissionModule,
  value: boolean
): UserPermissions {
  const normalized = normalizePermissions(permissions);
  const group = PERMISSION_GROUPS.find((item) => item.key === module);
  if (!group) return normalized;
  const nextGroup = { ...normalized[module] } as Record<string, boolean>;
  group.actions.forEach((action) => {
    nextGroup[action.key] = value;
  });
  return {
    ...normalized,
    [module]: nextGroup,
  };
}

export function areAllPermissionsEnabled(
  permissions: UserPermissions,
  module?: PermissionModule
) {
  const normalized = normalizePermissions(permissions);
  const groups = module
    ? PERMISSION_GROUPS.filter((group) => group.key === module)
    : PERMISSION_GROUPS;

  return groups.every((group) =>
    group.actions.every((action) => Boolean((normalized[group.key] as Record<string, boolean>)[action.key]))
  );
}
