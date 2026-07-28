export const BOSTA_PRICING_SECTORS = [
  { id: 1, label: "القاهرة والجيزة" },
  { id: 2, label: "الإسكندرية والبحيرة" },
  { id: 3, label: "الدلتا والقناة" },
  { id: 4, label: "شمال الصعيد" },
  { id: 5, label: "جنوب الصعيد ومطروح" },
  { id: 6, label: "الساحل الشمالي" },
  { id: 7, label: "سيناء والوادي الجديد" },
] as const;

export interface BostaPricingRow {
  id: string;
  route: string;
  size: string;
  service: string;
  amount: number;
}

const SERVICE_LABELS: Record<string, string> = {
  SEND: "توصيل",
  DELIVERY: "توصيل",
  CASH_COLLECTION: "تحصيل نقدي",
  CUSTOMER_RETURN_PICKUP: "إرجاع من العميل",
  RTO: "إرجاع الشحنة",
  RETURN: "إرجاع",
  EXCHANGE: "تبديل",
  INTERNATIONAL: "شحن دولي",
  SIGN_AND_RETURN: "توقيع وإرجاع",
  SIGN_AND_RETURN_OTHER_DAY: "توقيع وإرجاع في يوم لاحق",
  FXF_SEND: "توصيل مرن",
  FXF_RTO: "إرجاع مرن",
  FXF_EXCHANGE: "تبديل مرن",
  FXF_CUSTOMER_RETURN_PICKUP: "استلام مرتجع من العميل",
};

const SIZE_LABELS: Record<string, string> = {
  NORMAL: "صغير ومتوسط",
  SMALL: "صغير",
  MEDIUM: "متوسط",
  LARGE: "كبير (L)",
  "X-LARGE": "كبير جدًا (XL)",
  XL: "كبير جدًا (XL)",
  XXL: "كيس أبيض (XXL)",
  "WHITE BAG": "كيس أبيض (XXL)",
  "LIGHT BULKY": "ضخم خفيف",
  BULKY: "ضخم",
  "HEAVY BULKY": "ضخم ثقيل",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asPrice(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function findPricingGroups(payload: unknown): unknown[] {
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: payload, depth: 0 },
  ];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const record = asRecord(current.value);
    if (!record || visited.has(record)) continue;
    visited.add(record);

    for (const key of ["prices", "combinedPrices"] as const) {
      if (Array.isArray(record[key])) return record[key];
    }

    if (current.depth >= 5) continue;
    Object.values(record).forEach((value) => {
      if (asRecord(value)) queue.push({ value, depth: current.depth + 1 });
    });
  }

  return [];
}

function sectorLabel(id: number | undefined, group: Record<string, unknown>) {
  const apiArabicName = String(group.dropoffSectorNameArabic ?? "").trim();
  if (apiArabicName) return apiArabicName;

  const configured = BOSTA_PRICING_SECTORS.find((sector) => sector.id === id);
  if (configured) return configured.label;

  const apiName = String(group.dropoffSectorName ?? "").trim();
  return apiName || "منطقة تسليم غير محددة";
}

/**
 * Converts Bosta's documented pricing-plan response into display rows.
 * Only the official price matrix is read. Account metadata under `tier`
 * (COD percentages, thresholds, discounts, etc.) must never appear as zones.
 */
export function extractBostaPricingRows(payload: unknown): BostaPricingRow[] {
  const rows: BostaPricingRow[] = [];
  const seen = new Set<string>();

  findPricingGroups(payload).forEach((rawGroup, groupIndex) => {
    const group = asRecord(rawGroup);
    if (!group) return;

    const sectorIdValue = Number(group.dropoffSectorId);
    const sectorId = Number.isInteger(sectorIdValue)
      ? sectorIdValue
      : undefined;
    const route = sectorLabel(sectorId, group);
    const serviceTypes = Array.isArray(group.tierServiceTypes)
      ? group.tierServiceTypes
      : [];

    serviceTypes.forEach((rawService, serviceIndex) => {
      const service = asRecord(rawService);
      if (!service) return;
      const typeName = String(service.typeName ?? "SEND")
        .trim()
        .toUpperCase();
      const serviceLabel = SERVICE_LABELS[typeName] ?? "خدمة شحن خاصة";
      const sizes = Array.isArray(service.tierSizes) ? service.tierSizes : [];

      sizes.forEach((rawSize, sizeIndex) => {
        const size = asRecord(rawSize);
        if (!size) return;
        const amount = asPrice(size.cost);
        if (amount === undefined) return;

        const sizeName = String(size.sizeName ?? size.sizeAlias ?? "Normal")
          .trim()
          .toUpperCase();
        const sizeLabel = SIZE_LABELS[sizeName] ?? "حجم مخصص";
        const id = [
          sectorId ?? groupIndex,
          typeName || serviceIndex,
          sizeName || sizeIndex,
        ].join(":");
        if (seen.has(id)) return;
        seen.add(id);
        rows.push({ id, route, size: sizeLabel, service: serviceLabel, amount });
      });
    });
  });

  return rows;
}
