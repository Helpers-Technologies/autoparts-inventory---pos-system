import { useEffect } from "react";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDate, resolvePaymentLabel } from "../../lib/format";
import type { CustomerAddressSnapshot, DeliveryMethod, InvoiceLine, PaymentLogEntry, ReturnLine } from "../../types";
import { useFeatures } from "../../lib/useFeatures";

interface Props {
  kind: "sales" | "purchase";
  invoiceNumber: string;
  date: string;
  partyLabel: string;
  partyName: string;
  driverName?: string;
  lines: InvoiceLine[];
  total: number;
  discount?: number;
  amountPaid: number;
  remaining: number;
  notes?: string;
  paymentLabel?: string;
  // Accepts both SalesReturn and PurchaseReturn (purchase returns have no refundCash).
  returns?: Array<{ lines: ReturnLine[]; total: number; refundCash?: boolean }>;
  paymentDueDate?: string;
  customerBalance?: number;
  customerName?: string;
  paymentLog?: PaymentLogEntry[];
  overpayment?: number;
  vehicleLabel?: string;
  branchName?: string;
  deliveryMethod?: DeliveryMethod;
  deliveryAddress?: CustomerAddressSnapshot;
  shippingProviderName?: string;
  shippingFee?: number;
  collectOnDelivery?: boolean;
}

export function InvoicePrintLayout(props: Props) {
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const expiryTrackingEnabled = isEnabled("expiryTracking");
  const creditSalesEnabled = isEnabled("creditSales");

  useEffect(() => {
    const prev = document.title;
    document.title = `${props.kind === "sales" ? "فاتورة مبيعات" : "فاتورة مشتريات"} ${props.invoiceNumber}`;
    return () => { document.title = prev; };
  }, [props.invoiceNumber, props.kind]);

  const isSales = props.kind === "sales";
  const isCollectOnDelivery = isSales && Boolean(props.collectOnDelivery);
  const returnsTotal = (props.returns ?? []).reduce((a, r) => a + r.total, 0);
  const paymentLog = props.paymentLog ?? [];
  const overpayment = isSales ? props.overpayment ?? 0 : 0;
  const totalCollected = props.amountPaid + overpayment;
  const amountDueOnDelivery = Math.max(0, props.total - returnsTotal);
  const primaryMeta = [
    { label: props.partyLabel, value: props.partyName, accent: true },
    {
      label: isCollectOnDelivery ? "حالة التحصيل" : "طريقة الدفع",
      value: isCollectOnDelivery ? "دفع عند الاستلام — غير محصّل" : props.paymentLabel ?? "—",
      warning: isCollectOnDelivery,
    },
    ...(props.paymentDueDate
      ? [{ label: "تاريخ الاستحقاق", value: formatDate(props.paymentDueDate) }]
      : []),
    ...(props.driverName ? [{ label: "السائق", value: props.driverName }] : []),
  ];

  return (
    <div className="min-h-screen bg-canvas py-8 px-4 print:p-0 print:bg-surface" dir="rtl">
      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            @page { size: A4 portrait; margin: 0; }
            body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            .invoice-page { box-shadow: none !important; border-radius: 0 !important; }
          }
          @media screen {
            .invoice-page { max-width: 210mm; }
          }
        `
      }} />

      {/* Screen toolbar */}
      <div className="no-print max-w-[210mm] mx-auto flex items-center justify-between mb-4">
        <button
          onClick={() => window.history.back()}
          className="text-sm text-ink-muted hover:text-ink flex items-center gap-1.5 bg-surface border border-line rounded-lg px-3 h-9"
        >
          ← رجوع
        </button>
        <button
          onClick={() => window.print()}
          className="h-9 px-6 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          طباعة
        </button>
      </div>

      {/* A4 page */}
      <div
        className="force-light invoice-page mx-auto bg-surface shadow-xl print:shadow-none"
        style={{ minHeight: "297mm", display: "flex", flexDirection: "column" }}
      >
        {/* Page body with padding */}
        <div style={{ padding: "15mm 14mm 9mm", display: "flex", flexDirection: "column", flex: 1 }}>

          {/* ── HEADER ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, paddingBottom: 10, borderBottom: "2px solid #1e3a5f" }}>
            {/* Company info */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 10, overflow: "hidden", flexShrink: 0,
                background: settings.logoImage ? "transparent" : "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "white", fontWeight: 700, fontSize: 16
              }}>
                {settings.logoImage
                  ? <img src={settings.logoImage} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : settings.logoText}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a", lineHeight: 1.2 }}>
                  {settings.arabicLabels ? settings.companyNameAr : settings.companyName}
                </div>
                {settings.companyNameAr && settings.companyName && settings.companyNameAr !== settings.companyName && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{settings.companyName}</div>
                )}
                <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                  التاريخ: <span style={{ fontWeight: 700, color: "#334155" }}>{formatDate(props.date)}</span>
                </div>
              </div>
            </div>

            {/* Invoice identity */}
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1e3a5f", letterSpacing: -0.5 }}>
                {isSales ? "فاتورة مبيعات" : "فاتورة مشتريات"}
              </div>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>رقم الفاتورة</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", fontFamily: "monospace", background: "#f1f5f9", padding: "1px 8px", borderRadius: 4 }}>
                    {props.invoiceNumber}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── DOCUMENT DETAILS ── */}
          <div style={{ border: "1px solid #dbe4ee", borderRadius: 7, overflow: "hidden", marginBottom: 9 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${primaryMeta.length}, minmax(0, 1fr))`, background: "#ffffff" }}>
              {primaryMeta.map((item, index) => (
                <MetaItem
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  accent={item.accent}
                  warning={item.warning}
                  divided={index < primaryMeta.length - 1}
                />
              ))}
            </div>
            {isSales && (props.vehicleLabel || props.branchName) ? (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "5px 28px", padding: "6px 10px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                {props.vehicleLabel ? <InlineMeta label="سيارة العميل" value={props.vehicleLabel} /> : null}
                {props.branchName ? <InlineMeta label="الفرع" value={props.branchName} /> : null}
              </div>
            ) : null}
          </div>

          {isSales && props.deliveryMethod && props.deliveryMethod !== "pickup" ? (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(145px, .85fr) minmax(0, 2fr)", gap: 12, alignItems: "center", padding: "7px 10px", marginBottom: 9, borderTop: "1px solid #bfdbfe", borderBottom: "1px solid #bfdbfe", background: "#f8fbff" }}>
              <InlineMeta
                label="طريقة التوصيل"
                value={props.deliveryMethod === "branch_driver" ? `سائق الفرع${props.driverName ? ` — ${props.driverName}` : ""}` : `شركة شحن${props.shippingProviderName ? ` — ${props.shippingProviderName}` : ""}`}
                accent
              />
              <InlineMeta
                label="عنوان التوصيل"
                value={props.deliveryAddress ? `${props.deliveryAddress.governorate}، ${props.deliveryAddress.city}${props.deliveryAddress.district ? `، ${props.deliveryAddress.district}` : ""} — ${props.deliveryAddress.addressLine}` : "—"}
              />
            </div>
          ) : null}

          {/* ── ITEMS TABLE ── */}
          <div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <Th center style={{ width: 28 }}>#</Th>
                  <Th>الصنف</Th>
                  <Th center style={{ width: 52 }}>الوحدة</Th>
                  <Th center style={{ width: 52 }}>الكمية</Th>
                  <Th center style={{ width: 108 }}>السعر</Th>
                  <Th center style={{ width: 124 }}>الإجمالي</Th>
                </tr>
              </thead>
              <tbody>
                {props.lines.map((l, idx) => (
                  <tr key={l.id} style={{ background: idx % 2 === 1 ? "#f8fafc" : "#ffffff" }}>
                    <Td center muted>{idx + 1}</Td>
                    <Td>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>{l.productName}</span>
                      {l.partNumber && (
                        <span style={{ display: "block", fontSize: 10, color: "#64748b", fontFamily: "monospace", direction: "ltr", textAlign: "right" }}>
                          {l.partNumber}{l.partBrand ? ` · ${l.partBrand}` : ""}{l.warrantyMonths ? ` · ضمان ${l.warrantyMonths} شهر` : ""}
                        </span>
                      )}
                      {expiryTrackingEnabled && l.expiryDate && (
                        <span style={{ display: "block", fontSize: 10, color: "#94a3b8" }}>
                          صلاحية: {formatDate(l.expiryDate)}
                        </span>
                      )}
                    </Td>
                    <Td center muted>{l.unit}</Td>
                    <Td center bold>{l.quantity}</Td>
                    <Td center mono>{formatCurrency(l.price, settings.currency)}</Td>
                    <Td center mono bold accent>{formatCurrency(l.subtotal, settings.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── RETURNS ── */}
          {props.returns && props.returns.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", marginBottom: 6, borderBottom: "1.5px solid #dc2626", paddingBottom: 4 }}>
                المرتجعات
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <Th center style={{ width: 28 }}>#</Th>
                    <Th>الصنف</Th>
                    <Th center style={{ width: 52 }}>الوحدة</Th>
                    <Th center style={{ width: 52 }}>الكمية</Th>
                    <Th center style={{ width: 108 }}>السعر</Th>
                    <Th center style={{ width: 124 }}>الإجمالي</Th>
                  </tr>
                </thead>
                <tbody>
                  {props.returns.flatMap((r) => r.lines).map((l, idx) => (
                    <tr key={l.id} style={{ background: idx % 2 === 1 ? "#fff5f5" : "#ffffff" }}>
                      <Td center muted>{idx + 1}</Td>
                      <Td><span style={{ fontWeight: 600, color: "#0f172a" }}>{l.productName}</span></Td>
                      <Td center muted>{l.unit}</Td>
                      <Td center bold>{l.quantity}</Td>
                      <Td center mono>{formatCurrency(l.price, settings.currency)}</Td>
                      <Td center mono bold>{formatCurrency(l.subtotal, settings.currency)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 12px" }}>
                  إجمالي المرتجع: {formatCurrency(props.returns.reduce((a, r) => a + r.total, 0), settings.currency)}
                </div>
              </div>
            </div>
          )}

          {/* ── TOTALS ── */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <div style={{ width: 420, border: "1px solid #cbd5e1", borderRadius: 8, overflow: "hidden" }}>
              {props.discount ? (
                <>
                  <TotalRow label="إجمالي البنود" value={formatCurrency(props.total - (props.shippingFee ?? 0) + props.discount, settings.currency)} />
                  <TotalRow label="خصم" value={`- ${formatCurrency(props.discount, settings.currency)}`} discount />
                  {props.shippingFee ? <TotalRow label="رسوم التوصيل" value={`+ ${formatCurrency(props.shippingFee, settings.currency)}`} /> : null}
                  <TotalRow label="إجمالي الفاتورة" value={formatCurrency(props.total, settings.currency)} bold />
                </>
              ) : (
                <>
                  <TotalRow label="إجمالي البنود" value={formatCurrency(props.total - (props.shippingFee ?? 0), settings.currency)} />
                  {props.shippingFee ? <TotalRow label="رسوم التوصيل" value={`+ ${formatCurrency(props.shippingFee, settings.currency)}`} /> : null}
                  <TotalRow label="إجمالي الفاتورة" value={formatCurrency(props.total, settings.currency)} bold />
                </>
              )}
              {returnsTotal > 0 && (
                <>
                  <TotalRow
                    label={`المرتجع ${(props.returns ?? []).some(r => r.refundCash) ? "(رد كاش)" : "(مخصوم من الرصيد)"}`}
                    value={`- ${formatCurrency(returnsTotal, settings.currency)}`}
                    deduction
                  />
                  <TotalRow
                    label="صافي بعد المرتجع"
                    value={formatCurrency(Math.max(0, props.total - returnsTotal), settings.currency)}
                    bold
                  />
                </>
              )}
              {isCollectOnDelivery ? (
                <TotalRow
                  label="حالة الدفع"
                  value="دفع عند الاستلام — لم يُحصّل بعد"
                  pending
                  bold
                />
              ) : paymentLog.length > 0
                ? paymentLog.map((entry, i) => (
                    <TotalRow
                      key={entry.id}
                      label={`دفعة ${i + 1} — ${formatDate(entry.date)} — ${resolvePaymentLabel(entry.paymentMethod, entry.notes)}`}
                      value={formatCurrency(entry.amount, settings.currency)}
                      paid
                    />
                  ))
                : (
                  <TotalRow
                    label={isSales ? "تم استلام" : "تم سداد"}
                    value={formatCurrency(props.amountPaid, settings.currency)}
                    paid
                  />
                )
              }
              {!isCollectOnDelivery && overpayment > 0 && (
                <TotalRow
                  label="رصيد للعميل من هذه الفاتورة"
                  value={`له ${formatCurrency(overpayment, settings.currency)}`}
                  credit
                />
              )}
              {!isCollectOnDelivery && (paymentLog.length > 0 || overpayment > 0) && (
                <TotalRow
                  label={isSales ? "إجمالي المسدّد" : "إجمالي ما تم سداده"}
                  value={formatCurrency(totalCollected, settings.currency)}
                  paid
                  bold
                />
              )}
              {isSales && creditSalesEnabled && !isCollectOnDelivery && props.customerName && props.customerBalance !== undefined && (
                <TotalRow
                  label={
                    props.customerBalance < 0
                      ? `رصيد حساب للعميل (${props.customerName})`
                      : props.customerBalance > 0
                        ? `رصيد حساب على العميل (${props.customerName})`
                        : `رصيد حساب العميل (${props.customerName})`
                  }
                  value={
                    props.customerBalance < 0
                      ? `له ${formatCurrency(-props.customerBalance, settings.currency)}`
                      : props.customerBalance > 0
                        ? `عليه ${formatCurrency(props.customerBalance, settings.currency)}`
                        : "الحساب مسوّى"
                  }
                  credit={props.customerBalance < 0}
                  deduction={props.customerBalance > 0}
                />
              )}
              <TotalRow
                label={isCollectOnDelivery ? "المطلوب تحصيله عند التسليم" : isSales ? "المتبقي على العميل" : "المتبقي للمورد"}
                value={formatCurrency(isCollectOnDelivery ? amountDueOnDelivery : props.remaining, settings.currency)}
                highlight
              />
            </div>
          </div>

          {/* Notes */}
          {props.notes && (
            <div style={{ marginTop: 12, padding: "8px 10px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11, color: "#78350f" }}>
              <span style={{ fontWeight: 700 }}>ملاحظات: </span>
              {props.notes}
            </div>
          )}

          {/* Spacer pushes footer to bottom */}
          <div style={{ flex: 1 }} />

          {/* Footer */}
          <div style={{ marginTop: 10, paddingTop: 7, borderTop: "1px solid #e2e8f0" }}>
            {settings.invoiceFooter && (
              <div style={{ textAlign: "center", fontSize: 10, color: "#64748b", whiteSpace: "pre-line", marginBottom: 5 }}>
                {settings.invoiceFooter}
              </div>
            )}
            <div style={{ textAlign: "center", fontSize: 9.5, color: "#64748b", paddingTop: 5, borderTop: "1px solid #eef2f7" }}>
              تم التطوير بواسطة شركة هيلبيرز تيكنولوجي | 01118445625 - 01080001249
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Small helper components ── */

function MetaItem({ label, value, accent, warning, divided }: { label: string; value: string; accent?: boolean; warning?: boolean; divided?: boolean }) {
  return (
    <div style={{
      padding: "7px 10px",
      borderLeft: divided ? "1px solid #e2e8f0" : undefined,
      boxShadow: accent ? "inset -3px 0 0 #2563eb" : undefined,
      minHeight: 45,
    }}>
      <div style={{ fontSize: 8.5, color: "#94a3b8", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 750, color: warning ? "#b45309" : "#0f172a", lineHeight: 1.25 }}>{value}</div>
    </div>
  );
}

function InlineMeta({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 0, fontSize: 10.5, lineHeight: 1.45, color: "#334155" }}>
      <span style={{ color: "#94a3b8", marginLeft: 5 }}>{label}:</span>
      <span style={{ fontWeight: 700, color: accent ? "#1d4ed8" : "#0f172a" }}>{value}</span>
    </div>
  );
}

function Th({ children, center, style }: { children: React.ReactNode; center?: boolean; style?: React.CSSProperties }) {
  return (
    <th style={{
      padding: "8px 6px",
      border: "1px solid #1e3a5f",
      background: "#1e3a5f",
      color: "white",
      fontWeight: 700,
      fontSize: 11,
      textAlign: center ? "center" : "right",
      ...style,
    }}>
      {children}
    </th>
  );
}

function Td({ children, center, muted, bold, mono, accent }: {
  children: React.ReactNode;
  center?: boolean;
  muted?: boolean;
  bold?: boolean;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <td style={{
      padding: "7px 6px",
      border: "1px solid rgb(var(--line))",
      textAlign: center ? "center" : "right",
      color: accent ? "#1e3a5f" : muted ? "#64748b" : "#0f172a",
      fontWeight: bold ? 700 : 400,
      fontFamily: mono ? "monospace" : undefined,
      whiteSpace: mono ? "nowrap" : undefined,
    }}>
      {children}
    </td>
  );
}

function TotalRow({
  label,
  value,
  highlight,
  discount,
  deduction,
  paid,
  credit,
  pending,
  bold,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  discount?: boolean;
  deduction?: boolean;
  paid?: boolean;
  credit?: boolean;
  pending?: boolean;
  bold?: boolean;
}) {
  const bgColor = highlight
    ? "#1e3a5f"
    : pending
    ? "#fffbeb"
    : credit
    ? "#eff6ff"
    : paid
    ? "#f0fdf4"
    : discount
    ? "#f0fdf4"
    : deduction
    ? "#fef2f2"
    : "#f8fafc";

  const textColor = highlight
    ? "white"
    : pending
    ? "#92400e"
    : credit
    ? "#1d4ed8"
    : paid
    ? "#15803d"
    : discount
    ? "#16a34a"
    : deduction
    ? "#dc2626"
    : "#334155";

  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
      padding: highlight ? "9px 12px" : "6px 12px",
      background: bgColor,
      borderBottom: highlight ? "none" : "1px solid #e2e8f0",
      color: textColor,
    }}>
      <span style={{ fontSize: highlight ? 13 : 11.5, fontWeight: highlight || bold ? 700 : 500, lineHeight: 1.3 }}>{label}</span>
      <span style={{ fontSize: highlight ? 14 : 12, fontWeight: 700, fontFamily: "monospace", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}
