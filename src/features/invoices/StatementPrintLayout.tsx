import { useEffect } from "react";
import { useSettings } from "../../store/SettingsContext";
import { formatCurrency, formatDate } from "../../lib/format";
import { buildXlsx } from "../../lib/xlsx";
import { useFeatures } from "../../lib/useFeatures";

export interface StatementRow {
  key: string;
  date: string;
  sortKey: string;
  description: string;
  madin: number;
  daen: number;
  balance: number;
}

interface Props {
  kind: "customer" | "supplier";
  partyName: string;
  partyCode?: string;
  partyPhone?: string;
  rows: StatementRow[];
}

export function StatementPrintLayout({ kind, partyName, partyCode, partyPhone, rows }: Props) {
  const { settings } = useSettings();
  const excelExportEnabled = useFeatures().isEnabled("excelExport");

  const title = kind === "customer" ? "كشف حساب عميل" : "كشف حساب مورد";
  const finalBalance = rows.length > 0 ? rows[rows.length - 1].balance : 0;
  const totalMadin = rows.reduce((s, r) => s + r.madin, 0);
  const totalDaen = rows.reduce((s, r) => s + r.daen, 0);

  useEffect(() => {
    const prev = document.title;
    document.title = `${title} — ${partyName}`;
    return () => { document.title = prev; };
  }, [title, partyName]);

  function downloadXlsx() {
    const headers = ["التاريخ", "البيان", "مدين", "دائن", "الرصيد"];
    const dataRows: (string | number)[][] = rows.map((r) => [
      r.date,
      r.description,
      r.madin || "",
      r.daen || "",
      r.balance,
    ]);
    dataRows.push(["", "الإجمالي", totalMadin, totalDaen, finalBalance]);
    const bytes = buildXlsx([{ name: "كشف الحساب", headers, rows: dataRows }]);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `كشف_حساب_${partyName}_${new Date().toLocaleDateString("en-CA")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const printDate = new Date().toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-canvas py-8 px-4 print:p-0 print:bg-surface" dir="rtl">
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            @page { size: A4 portrait; margin: 0; }
            body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            .statement-page { box-shadow: none !important; border-radius: 0 !important; }
          }
          @media screen { .statement-page { max-width: 210mm; } }
          .stmt-tr:hover td { background: #eff6ff !important; }
        `,
        }}
      />

      {/* Screen toolbar */}
      <div className="no-print max-w-[210mm] mx-auto flex items-center justify-between mb-4">
        <button
          onClick={() => window.history.back()}
          className="text-sm text-ink-muted hover:text-ink flex items-center gap-1.5 bg-surface border border-line rounded-lg px-3 h-9"
        >
          ← رجوع
        </button>
        <div className="flex gap-2">
          {excelExportEnabled && (
            <button
              onClick={downloadXlsx}
              className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
            >
              ⬇ Excel
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="h-9 px-5 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800"
          >
            🖨 طباعة
          </button>
          <button
            onClick={() => window.print()}
            className="h-9 px-5 bg-slate-600 text-white rounded-lg text-sm font-medium hover:bg-slate-700"
          >
            📄 حفظ PDF
          </button>
          <button
            onClick={() => {
              const balanceText = finalBalance === 0
                ? "الحساب متوازن"
                : finalBalance > 0
                  ? `مستحق ${kind === "customer" ? "على العميل" : "علينا للمورد"}: ${formatCurrency(Math.abs(finalBalance), settings.currency)}`
                  : `رصيد دائن ${kind === "customer" ? "للعميل" : "لصالحنا"}: ${formatCurrency(Math.abs(finalBalance), settings.currency)}`;
              const msg = [
                `📋 ${title}`,
                `👤 ${partyName}${partyCode ? ` (${partyCode})` : ""}`,
                `📅 ${printDate}`,
                ``,
                `💳 ${balanceText}`,
                `📊 إجمالي المدين: ${formatCurrency(totalMadin, settings.currency)}`,
                `💰 إجمالي الدائن: ${formatCurrency(totalDaen, settings.currency)}`,
              ].join("\n");
              const phone = String(partyPhone ?? "").replace(/\D/g, "");
              const normalized = phone.startsWith("0") ? `20${phone.slice(1)}` : phone;
              const href = normalized
                ? `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`
                : `https://wa.me/?text=${encodeURIComponent(msg)}`;
              window.open(href);
            }}
            className="h-9 px-5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
          >
            💬 واتساب
          </button>
        </div>
      </div>

      {/* A4 page */}
      <div
        className="force-light statement-page mx-auto bg-surface shadow-xl print:shadow-none"
        style={{ minHeight: "297mm", display: "flex", flexDirection: "column" }}
      >
        {/* Top accent */}
        <div style={{ height: 7, background: "linear-gradient(90deg, #1e3a5f 0%, #2563eb 60%, #60a5fa 100%)" }} />

        <div style={{ padding: "14mm 14mm 12mm", flex: 1, display: "flex", flexDirection: "column" }}>

          {/* ── HEADER ── */}
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingBottom: 14,
            marginBottom: 16,
            borderBottom: "2px solid #1e3a5f",
          }}>
            {/* Logo + company */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 12, overflow: "hidden", flexShrink: 0,
                background: settings.logoImage
                  ? "transparent"
                  : "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "white", fontWeight: 800, fontSize: 16,
              }}>
                {settings.logoImage
                  ? <img src={settings.logoImage} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : settings.logoText}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a", lineHeight: 1.2 }}>
                  {settings.arabicLabels ? settings.companyNameAr : settings.companyName}
                </div>
                {settings.companyNameAr && settings.companyName &&
                  settings.companyNameAr !== settings.companyName && (
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{settings.companyName}</div>
                  )}
              </div>
            </div>

            {/* Title block */}
            <div style={{
              textAlign: "center",
              background: "#1e3a5f",
              color: "white",
              borderRadius: 10,
              padding: "10px 20px",
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3 }}>{title}</div>
              <div style={{ fontSize: 10, opacity: 0.75, marginTop: 3 }}>بتاريخ: {printDate}</div>
            </div>
          </div>

          {/* ── PARTY INFO ── */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
            <div style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRight: "4px solid #2563eb",
              borderRadius: 8,
              padding: "8px 12px",
            }}>
              <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3, letterSpacing: 0.3 }}>
                {kind === "customer" ? "العميل" : "المورد"}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1e40af" }}>{partyName}</div>
            </div>
            {partyCode ? (
              <div style={{ background: "#f8fafc", border: "1px solid rgb(var(--line))", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 3 }}>الكود</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", fontFamily: "monospace" }}>{partyCode}</div>
              </div>
            ) : <div />}
            {partyPhone ? (
              <div style={{ background: "#f8fafc", border: "1px solid rgb(var(--line))", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 3 }}>الهاتف</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{partyPhone}</div>
              </div>
            ) : <div />}
          </div>


          {/* ── TABLE ── */}
          <div style={{ flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#1e3a5f" }}>
                  <th style={{ ...TH, width: 74, textAlign: "center" }}>التاريخ</th>
                  <th style={{ ...TH, textAlign: "right" }}>البيان / التفاصيل</th>
                  <th style={{ ...TH, width: 112, textAlign: "center" }}>
                    {kind === "customer" ? "على العميل" : "على الحساب"}
                    <div style={{ fontSize: 7.5, fontWeight: 400, opacity: 0.75, marginTop: 2 }}>
                      {kind === "customer" ? "(فواتير — مطلوب)" : "(فواتير — مستحق)"}
                    </div>
                  </th>
                  <th style={{ ...TH, width: 112, textAlign: "center" }}>
                    {kind === "customer" ? "للعميل / سداد" : "دفعنا"}
                    <div style={{ fontSize: 7.5, fontWeight: 400, opacity: 0.75, marginTop: 2 }}>
                      {kind === "customer" ? "(مدفوع — مرتجع)" : "(مدفوعات — مرتجع)"}
                    </div>
                  </th>
                  <th style={{ ...TH, width: 120, textAlign: "center" }}>رصيد الحساب</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "#94a3b8", fontSize: 12 }}>
                      لا توجد حركات مسجلة
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => {
                    const isEven = idx % 2 === 0;
                    return (
                      <tr key={row.key} className="stmt-tr">
                        <td style={{ ...TD, textAlign: "center", color: "#64748b", fontSize: 10.5, background: isEven ? "#fff" : "#f8fafc" }}>
                          {formatDate(row.date)}
                        </td>
                        <td style={{ ...TD, background: isEven ? "#fff" : "#f8fafc" }}>
                          {row.description}
                        </td>
                        <td style={{
                          ...TD, textAlign: "center", fontFamily: "monospace",
                          color: row.madin > 0 ? "#dc2626" : "#cbd5e1",
                          fontWeight: row.madin > 0 ? 600 : 400,
                          background: row.madin > 0 ? "#fff5f5" : (isEven ? "#fff" : "#f8fafc"),
                        }}>
                          {row.madin > 0 ? formatCurrency(row.madin, settings.currency) : "—"}
                        </td>
                        <td style={{
                          ...TD, textAlign: "center", fontFamily: "monospace",
                          color: row.daen > 0 ? "#16a34a" : "#cbd5e1",
                          fontWeight: row.daen > 0 ? 600 : 400,
                          background: row.daen > 0 ? "#f0fdf4" : (isEven ? "#fff" : "#f8fafc"),
                        }}>
                          {row.daen > 0 ? formatCurrency(row.daen, settings.currency) : "—"}
                        </td>
                        <td style={{
                          ...TD, textAlign: "center", fontFamily: "monospace", fontWeight: 700,
                          fontSize: 11.5,
                          color: row.balance === 0 ? "#94a3b8" : row.balance > 0 ? "#b91c1c" : "#15803d",
                          background: row.balance > 0 ? "#fff5f5" : row.balance < 0 ? "#f0fdf4" : (isEven ? "#fff" : "#f8fafc"),
                        }}>
                          {row.balance === 0 ? "متوازن" : formatCurrency(Math.abs(row.balance), settings.currency)}
                          {row.balance !== 0 && (
                            <span style={{ display: "block", fontSize: 8.5, fontWeight: 600, opacity: 0.85, fontFamily: "inherit" }}>
                              {row.balance > 0
                                ? (kind === "customer" ? "← على العميل" : "← مستحق علينا")
                                : (kind === "customer" ? "← للعميل" : "← لصالحنا")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ── SUMMARY CARDS ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.3fr", gap: 10, marginTop: 16 }}>
            {/* Total debit */}
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderTop: "3px solid #dc2626", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>
                {kind === "customer" ? "إجمالي ما على العميل" : "إجمالي ما على الحساب"}
              </div>
              <div style={{ fontSize: 8.5, color: "#f87171", marginBottom: 5 }}>
                {kind === "customer" ? "(مجموع الفواتير)" : "(مجموع فواتير الشراء)"}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#dc2626", fontFamily: "monospace" }}>
                {formatCurrency(totalMadin, settings.currency)}
              </div>
            </div>

            {/* Total daen */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderTop: "3px solid #16a34a", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>
                {kind === "customer" ? "إجمالي ما سُدِّد" : "إجمالي ما دفعناه"}
              </div>
              <div style={{ fontSize: 8.5, color: "#4ade80", marginBottom: 5 }}>
                {kind === "customer" ? "(مجموع المدفوعات والمرتجعات)" : "(مجموع المدفوعات)"}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#16a34a", fontFamily: "monospace" }}>
                {formatCurrency(totalDaen, settings.currency)}
              </div>
            </div>

            {/* Final balance */}
            <div style={{
              background: finalBalance === 0 ? "#f8fafc" : finalBalance > 0 ? "#fef2f2" : "#f0fdf4",
              border: `2px solid ${finalBalance === 0 ? "#e2e8f0" : finalBalance > 0 ? "#f87171" : "#4ade80"}`,
              borderTop: `4px solid ${finalBalance === 0 ? "#94a3b8" : finalBalance > 0 ? "#dc2626" : "#16a34a"}`,
              borderRadius: 8,
              padding: "10px 14px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 9.5, color: "#64748b", marginBottom: 2, fontWeight: 700 }}>
                صافي رصيد الحساب
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", marginTop: 4, color: finalBalance === 0 ? "#64748b" : finalBalance > 0 ? "#b91c1c" : "#15803d" }}>
                {finalBalance === 0 ? "متوازن (صفر)" : formatCurrency(Math.abs(finalBalance), settings.currency)}
              </div>
              {finalBalance !== 0 && (
                <div style={{ marginTop: 6, padding: "3px 8px", borderRadius: 4, display: "inline-block", fontSize: 10, fontWeight: 700, background: finalBalance > 0 ? "#dc2626" : "#16a34a", color: "white" }}>
                  {finalBalance > 0
                    ? (kind === "customer" ? `مستحق على العميل` : `مستحق علينا للمورد`)
                    : (kind === "customer" ? `رصيد دائن للعميل` : `رصيد دائن لصالحنا`)}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* ── FOOTER ── */}
          <div style={{
            marginTop: 20,
            paddingTop: 10,
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div style={{ fontSize: 9, color: "#cbd5e1" }}>هيلبيرز تكنولوجي</div>
            {settings.invoiceFooter && (
              <div style={{ textAlign: "center", fontSize: 10, color: "#64748b", flex: 1, padding: "0 12px" }}>
                {settings.invoiceFooter}
              </div>
            )}
            <div style={{ fontSize: 9, color: "#94a3b8", direction: "ltr" }}>
              {new Date().toLocaleString("en-CA", { hour12: false })}
            </div>
          </div>
        </div>

        {/* Bottom accent */}
        <div style={{ height: 5, background: "linear-gradient(90deg, #1e3a5f 0%, #2563eb 60%, #60a5fa 100%)" }} />
      </div>
    </div>
  );
}

const TH: React.CSSProperties = {
  padding: "9px 8px",
  border: "1px solid #163355",
  color: "white",
  fontWeight: 700,
  fontSize: 11,
  textAlign: "center",
};

const TD: React.CSSProperties = {
  padding: "7px 8px",
  border: "1px solid rgb(var(--line))",
  color: "#0f172a",
  fontSize: 11,
  textAlign: "right",
  verticalAlign: "middle",
};
