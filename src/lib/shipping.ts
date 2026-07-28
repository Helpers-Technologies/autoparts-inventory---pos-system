import type {
  Customer,
  CustomerAddress,
  CustomerAddressSnapshot,
  DeliveryOrderStatus,
  ShippingRate,
} from "../types";

function normalizeArabic(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("ar-EG");
}

function samePlace(left: string | undefined, right: string | undefined): boolean {
  return normalizeArabic(left) === normalizeArabic(right);
}

/** Converts Bosta/API error codes and English responses into actionable Arabic. */
export function translateBostaError(error?: string): string {
  const raw = String(error ?? "").trim();
  if (!raw) return "تعذر تنفيذ العملية مع شركة الشحن";

  if (/No handler registered|Error invoking remote method/i.test(raw)) {
    return "خدمة الربط لم تبدأ بعد. اقفل التطبيق وافتحه مرة أخرى ثم أعد المحاولة.";
  }
  if (/active bundle subscription|required to create orders|bundle subscription/i.test(raw)) {
    return "حساب Bosta لا يحتوي على باقة شحن نشطة تسمح بإنشاء أوردرات. فعّل أو اشترِ باقة من حسابك في Bosta ثم أعد الإرسال.";
  }
  if (/insufficient (balance|credit)|not enough (balance|credit)/i.test(raw)) {
    return "رصيد حساب Bosta غير كافٍ لإنشاء الشحنة. اشحن رصيد الحساب ثم أعد المحاولة.";
  }
  if (/invalid.*api.?key|api.?key.*invalid|unauthori[sz]ed|authentication failed/i.test(raw)) {
    return "مفتاح Bosta غير صحيح أو انتهت صلاحيته. حدّث المفتاح من مركز الربط والتكاملات.";
  }
  if (/rate limit|too many requests/i.test(raw)) {
    return "تم إرسال طلبات كثيرة إلى Bosta خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.";
  }
  if (/service unavailable|bad gateway|gateway timeout|temporarily unavailable/i.test(raw)) {
    return "خدمة Bosta غير متاحة مؤقتًا. أعد المحاولة بعد قليل.";
  }
  if (/invalid.*phone|phone.*invalid/i.test(raw)) {
    return "رقم هاتف المستلم غير صحيح. راجع الرقم ثم أعد الإرسال.";
  }
  if (/invalid.*address|address.*required|missing.*address/i.test(raw)) {
    return "عنوان المستلم غير مكتمل أو غير صحيح. راجع بيانات العنوان ثم أعد الإرسال.";
  }
  if (/city.*(invalid|required|not found)|invalid.*city/i.test(raw)) {
    return "المدينة غير معتمدة لدى Bosta. اختر المدينة من قائمة تغطية Bosta.";
  }
  if (/district.*(invalid|required|not found)|invalid.*district|zone.*required/i.test(raw)) {
    return "المنطقة أو الحي غير معتمد لدى Bosta. اختر المنطقة الصحيحة من قائمة التغطية.";
  }
  if (/pickup.*(location|address).*(invalid|required|missing|not found)/i.test(raw)) {
    return "فرع الاستلام غير محدد أو غير صالح. اختبر الاتصال واختر فرع Bosta الصحيح.";
  }
  if (/shipment.*(not found|does not exist)|tracking.*not found/i.test(raw)) {
    return "الشحنة غير موجودة لدى Bosta أو رقم التتبع غير صحيح.";
  }
  if (/duplicate|already exists|order.*already/i.test(raw)) {
    return "تم إنشاء هذه الشحنة من قبل. حدّث التتبع بدل إعادة إرسالها.";
  }

  const labels: Record<string, string> = {
    feature_not_licensed: "ربط بوسطة غير متاح في باقتك الحالية. رقِّ إلى باقة المؤسسات أو أضف ميزة ربط بوسطة.",
    desktop_required: "العملية متاحة في نسخة سطح المكتب فقط",
    integration_disabled: "فعّل ربط Bosta من مركز الربط والتكاملات",
    api_key_missing: "أدخل مفتاح API الخاص بحساب Bosta أولًا",
    invalid_api_key: "مفتاح Bosta غير صحيح",
    not_authorized: "هذه العملية متاحة لمدير النظام فقط",
    internet_required: "شغّل الإنترنت أولًا لاستخدام خدمات Bosta",
    network_error: "تعذر الوصول إلى Bosta. تأكد من تشغيل الإنترنت ثم أعد المحاولة",
    request_timeout: "انتهت مهلة الاتصال بخوادم Bosta",
    operation_timeout: "العملية استغرقت وقتًا أطول من اللازم. أعد المحاولة",
    desktop_restart_required: "أعد تشغيل التطبيق لتفعيل التحديث الجديد",
    invalid_webhook_url: "رابط Webhook يجب أن يكون رابط HTTPS عامًا وصحيحًا",
    invalid_webhook_relay_url: "رابط الخدمة يجب أن ينتهي بـ /v1/bosta/webhook",
    invalid_webhook_header: "اسم أو قيمة مفتاح توثيق Webhook غير صحيحة",
    invalid_webhook_poll_token: "مفتاح مزامنة Webhook قصير أو غير صحيح",
    webhook_header_pair_required: "اكتب اسم وقيمة مفتاح توثيق Webhook معًا أو اتركهما فارغين",
    webhook_relay_not_configured: "أكمل رابط ومفاتيح خدمة Webhook أولًا",
    webhook_relay_unauthorized: "مفتاح مزامنة Webhook لا يطابق المفتاح الموجود بالخدمة",
    webhook_relay_unavailable: "تعذر الوصول إلى خدمة Webhook السحابية حاليًا",
    webhook_dns_unavailable: "الدومين غير مربوط في DNS أو لم يكتمل انتشاره بعد",
    webhook_tls_invalid: "شهادة HTTPS للدومين غير صالحة أو لم تُفعّل بعد",
    webhook_service_not_found: "ملفات خدمة Webhook غير موجودة في مسار الدومين المحدد",
    webhook_health_failed: "الدومين يعمل لكن خدمة Webhook لا تُرجع استجابة صحيحة",
    webhook_service_not_configured: "خدمة Webhook مرفوعة لكن ملف config.php غير مكتمل",
    webhook_database_unavailable: "خدمة Webhook تعمل لكن تعذر الاتصال بقاعدة البيانات",
    bosta_pickup_location_missing: "اختبر اتصال Bosta واختر فرع الاستلام قبل إرسال الشحنة",
    bosta_city_mapping_required: "اختر مدينة Bosta المطابقة لعنوان العميل قبل إرسال الشحنة",
    bosta_district_mapping_required: "اربط الحي والمدينة ببيانات تغطية Bosta",
    invoice_not_found: "الفاتورة المرتبطة غير موجودة",
    order_not_found: "أمر التوصيل غير موجود",
    delivery_not_completed: "لا يمكن توريد التحصيل قبل اكتمال التسليم",
    cod_already_settled: "تم توريد هذا التحصيل من قبل",
    invoice_already_paid: "الفاتورة مسددة بالفعل ولا يوجد مبلغ مطلوب توريده",
    tracking_number_missing: "لا يوجد رقم تتبع لهذا الأمر",
    invalid_tracking_reference: "رقم الشحنة غير صحيح. اكتب رقم التتبع كما يظهر في بوليصة بوسطة",
    tracking_not_found: "لم يتم العثور على الشحنة لدى بوسطة. راجع رقم التتبع ثم أعد المحاولة",
    tracking_request_failed: "تعذر جلب حالة الشحنة من خدمة تتبع بوسطة حاليًا",
    rate_limit_exceeded: "تم تنفيذ محاولات تتبع كثيرة. انتظر قليلًا ثم أعد المحاولة",
    tracking_state_unavailable: "لم تُرجع Bosta حالة واضحة لهذه الشحنة",
    price_unavailable: "تعذر جلب سعر الشحن من Bosta حاليًا",
    invalid_payload: "بيانات الشحنة غير مكتملة أو غير صحيحة",
    bosta_request_failed: "رفضت Bosta تنفيذ الطلب. راجع بيانات الشحنة ثم أعد المحاولة",
  };
  if (labels[raw]) return labels[raw];

  // Never expose an unhandled English API response directly to the cashier.
  if (/[A-Za-z]{3,}/.test(raw)) {
    return "رفضت Bosta تنفيذ العملية. راجع حالة الحساب وبيانات الشحنة، ثم أعد المحاولة.";
  }
  return raw;
}

export function bostaPublicTrackingUrl(trackingNumber: string): string {
  const clean = String(trackingNumber || "").trim();
  if (!clean) return "https://bosta.co/ar-eg/tracking-shipments";
  return `https://bosta.co/ar-eg/tracking-shipments?shipment-number=${encodeURIComponent(clean)}`;
}

/** Picks the most specific active rate: district, then city, then governorate. */
export function resolveShippingRate(
  rates: ShippingRate[],
  providerId: string,
  address: Pick<CustomerAddressSnapshot, "governorate" | "city" | "district">,
): ShippingRate | undefined {
  return rates
    .filter((rate) => rate.active && rate.providerId === providerId)
    .filter((rate) => samePlace(rate.governorate, address.governorate))
    .filter((rate) => !rate.city || samePlace(rate.city, address.city))
    .filter((rate) => !rate.district || samePlace(rate.district, address.district))
    .sort((a, b) => Number(Boolean(b.district)) - Number(Boolean(a.district)) || Number(Boolean(b.city)) - Number(Boolean(a.city)))[0];
}

export function defaultCustomerAddress(customer: Customer | undefined): CustomerAddress | undefined {
  if (!customer) return undefined;
  const addresses = customer.addresses ?? [];
  const structured = addresses.find((address) => address.isDefault) ?? addresses[0];
  if (structured) return structured;
  if (!customer.address?.trim()) return undefined;
  const now = customer.createdAt || new Date().toISOString();
  return {
    id: `legacy-${customer.id}`,
    label: "العنوان الرئيسي",
    recipientName: customer.name,
    phone: customer.phone,
    governorate: "",
    city: "",
    addressLine: customer.address.trim(),
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function snapshotCustomerAddress(
  address: CustomerAddress,
  customer: Pick<Customer, "name" | "phone">,
): CustomerAddressSnapshot {
  return {
    addressId: address.id,
    label: address.label,
    recipientName: address.recipientName?.trim() || customer.name,
    phone: address.phone?.trim() || customer.phone?.trim() || "",
    recipientEmail: address.recipientEmail?.trim() || undefined,
    governorate: address.governorate.trim(),
    city: address.city.trim(),
    district: address.district?.trim() || undefined,
    addressLine: address.addressLine.trim(),
    landmark: address.landmark?.trim() || undefined,
    buildingNumber: address.buildingNumber?.trim() || undefined,
    floor: address.floor?.trim() || undefined,
    apartment: address.apartment?.trim() || undefined,
    postalCode: address.postalCode?.trim() || undefined,
    bosta: address.bosta,
  };
}

const BOSTA_STATUS: Record<number, { status: DeliveryOrderStatus; label: string }> = {
  10: { status: "pickup_requested", label: "تم طلب الاستلام" },
  20: { status: "assigned", label: "تم تعيين مندوب" },
  21: { status: "picked_up", label: "تم استلام الشحنة من الفرع" },
  22: { status: "out_for_delivery", label: "المندوب في طريقه للعميل" },
  23: { status: "picked_up", label: "تم الاستلام من العميل" },
  24: { status: "in_transit", label: "وصلت الشحنة إلى المخزن" },
  25: { status: "picked_up", label: "تم تجهيز الشحنة" },
  30: { status: "in_transit", label: "الشحنة في الطريق بين مراكز التوزيع" },
  40: { status: "out_for_delivery", label: "المندوب متجه للعميل" },
  41: { status: "out_for_delivery", label: "خرجت الشحنة للتسليم" },
  45: { status: "delivered", label: "تم التسليم بنجاح" },
  46: { status: "returned", label: "تم إرجاع الشحنة للفرع" },
  47: { status: "exception", label: "تعذر التسليم مؤقتًا" },
  48: { status: "cancelled", label: "تم إنهاء الشحنة" },
  49: { status: "cancelled", label: "تم إلغاء الشحنة" },
  60: { status: "returned", label: "عادت الشحنة للمخزون" },
  100: { status: "exception", label: "الشحنة مفقودة" },
  101: { status: "exception", label: "الشحنة تالفة" },
  102: { status: "exception", label: "الشحنة قيد التحقيق" },
  103: { status: "exception", label: "الشحنة تحتاج إجراء من الفرع" },
  104: { status: "cancelled", label: "تمت أرشفة الشحنة" },
  105: { status: "exception", label: "الشحنة معلقة" },
};

export function bostaStatus(code: number | undefined): { status: DeliveryOrderStatus; label: string } {
  if (typeof code !== "number") return { status: "in_transit", label: "تم تحديث حالة الشحنة" };
  return BOSTA_STATUS[code] ?? { status: "in_transit", label: `حالة Bosta رقم ${code}` };
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryOrderStatus, string> = {
  draft: "مسودة",
  ready: "جاهز للتجهيز",
  assigned: "تم تعيين السائق",
  pickup_requested: "تم طلب الاستلام",
  picked_up: "تم الاستلام",
  in_transit: "في الطريق",
  out_for_delivery: "خرج للتسليم",
  delivered: "تم التسليم",
  exception: "تحتاج متابعة",
  returned: "مرتجع",
  cancelled: "ملغي",
};
