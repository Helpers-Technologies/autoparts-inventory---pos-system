export const DEFAULT_INVOICE_WHATSAPP_TEMPLATE = [
  "مرحبا {partyName}",
  "",
  "نود إحاطتكم بتفاصيل {invoiceType} رقم {invoiceNumber}",
  "التاريخ: {date}",
  "الإجمالي: {total}",
  "المدفوع: {paid}",
  "المتبقي: {remaining}",
  "الحالة: {status}",
  "",
  "{companyName}",
].join("\n");

export const WHATSAPP_INVOICE_TAGS = [
  { tag: "{partyName}", label: "اسم العميل/المورد" },
  { tag: "{partyLabel}", label: "نوع الطرف" },
  { tag: "{invoiceType}", label: "نوع الفاتورة" },
  { tag: "{invoiceNumber}", label: "رقم الفاتورة" },
  { tag: "{date}", label: "التاريخ" },
  { tag: "{total}", label: "الإجمالي" },
  { tag: "{paid}", label: "المدفوع" },
  { tag: "{remaining}", label: "المتبقي" },
  { tag: "{status}", label: "الحالة" },
  { tag: "{paymentMethod}", label: "طريقة الدفع" },
  { tag: "{priceType}", label: "نوع السعر" },
  { tag: "{driverName}", label: "السائق" },
  { tag: "{phone}", label: "رقم الهاتف" },
  { tag: "{companyName}", label: "اسم الشركة" },
] as const;

export interface InvoiceWhatsappTemplateData {
  partyName: string;
  partyLabel: string;
  invoiceType: string;
  invoiceNumber: string;
  date: string;
  total: string;
  paid: string;
  remaining: string;
  status: string;
  companyName: string;
  paymentMethod?: string;
  priceType?: string;
  driverName?: string;
  phone?: string;
  [key: string]: string | undefined;
}

export function renderInvoiceWhatsappTemplate(
  template: string | undefined,
  data: InvoiceWhatsappTemplateData
) {
  const source = template?.trim() ? template : DEFAULT_INVOICE_WHATSAPP_TEMPLATE;
  return source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    const value = data[key];
    return value === undefined ? match : value;
  });
}

export function normalizeWhatsappPhone(phone?: string) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.startsWith("0") ? `20${digits.slice(1)}` : digits;
}

export function buildWhatsappUrl(phone: string | undefined, message: string) {
  const normalized = normalizeWhatsappPhone(phone);
  const query = encodeURIComponent(message);
  return normalized ? `https://wa.me/${normalized}?text=${query}` : `https://wa.me/?text=${query}`;
}
