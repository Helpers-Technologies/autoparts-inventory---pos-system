import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CarFront, Eye, FileCheck2, FileText, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog } from "../components/ui/Dialog";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDate } from "../lib/format";
import { hasPermission } from "../lib/permissions";
import { useAuth } from "../store/AuthContext";
import { printAppRoute } from "../lib/print";
import type { Quotation } from "../types";
import { todayISO } from "../lib/utils";

export function QuotationsPage() {
  const { quotations, deleteQuotation } = useInvoicing();
  const { settings } = useSettings();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const canAdd = hasPermission(currentUser, "salesInvoices", "add");
  const canEdit = hasPermission(currentUser, "salesInvoices", "edit");
  const canDelete = hasPermission(currentUser, "salesInvoices", "delete");
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<Quotation | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotations;
    return quotations.filter((quotation) => [
      quotation.quotationNumber,
      quotation.customerName,
      quotation.vehicleLabel,
      quotation.branchName,
      quotation.priceTierName,
      ...quotation.lines.flatMap((line) => [line.productName, line.partNumber, line.partBrand]),
    ].some((value) => value?.toLowerCase().includes(q)));
  }, [quotations, search]);

  const draftCount = quotations.filter((q) => q.status === "draft").length;
  const convertedCount = quotations.filter((q) => q.status === "converted").length;
  const expiredCount = quotations.filter((quotation) =>
    quotation.status === "draft" && Boolean(quotation.validUntil && quotation.validUntil < todayISO()),
  ).length;

  return (
    <>
      <AutoPartsHero
        icon={FileCheck2}
        eyebrow="AUTO PARTS QUOTATIONS"
        title="عروض أسعار قطع الغيار"
        description="جهّز عرضًا مرتبطًا بسيارة العميل والفرع وشريحة السعر، مع فحص التوافق والمخزون قبل التحويل إلى فاتورة."
        stats={[
          { label: "إجمالي العروض", value: quotations.length },
          { label: "مفتوحة", value: draftCount },
          { label: "محولة", value: convertedCount },
          { label: "انتهت صلاحيتها", value: expiredCount },
        ]}
        actions={
          canAdd ? (
            <Button onClick={() => navigate("/quotations/new")}>
              <Plus className="w-4 h-4" /> عرض سعر جديد
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-2">
        <StatCard label="إجمالي العروض" value={quotations.length} />
        <StatCard label="عروض مفتوحة" value={draftCount} tone="amber" />
        <StatCard label="محولة لفواتير" value={convertedCount} tone="green" />
        <StatCard label="منتهية الصلاحية" value={expiredCount} tone="rose" />
      </div>

      <Card>
        <CardHeader
          title={`عروض الأسعار (${filtered.length})`}
          actions={
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
              <Input
                className="ps-9 w-52"
                placeholder="رقم عرض، عميل، سيارة، Part No...."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
        />
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-5 h-5" />}
              title="لا توجد عروض أسعار"
              description="اضغط على «عرض سعر جديد» لإنشاء أول عرض"
              action={
                canAdd ? (
                  <Button onClick={() => navigate("/quotations/new")}>
                    <Plus className="w-4 h-4" /> عرض سعر جديد
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الرقم</TH>
                  <TH>التاريخ</TH>
                  <TH>العميل</TH>
                  <TH>السيارة / القطع</TH>
                  <TH>الفرع / الشريحة</TH>
                  <TH>صالح حتى</TH>
                  <TH className="text-end">الإجمالي</TH>
                  <TH>الحالة</TH>
                  <TH className="text-end">إجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((q) => (
                  <TR key={q.id}>
                    <TD className="font-mono text-xs text-ink-muted">{q.quotationNumber}</TD>
                    <TD>{formatDate(q.date)}</TD>
                    <TD className="font-medium text-ink">{q.customerName}</TD>
                    <TD>
                      <div className="flex items-center gap-1.5 font-medium text-ink">
                        <CarFront className="h-4 w-4 text-cyan-600" /> {q.vehicleLabel ?? "بدون سيارة محددة"}
                      </div>
                      <div className="mt-1 text-xs text-ink-faint">
                        {q.lines.slice(0, 2).map((line) => line.partNumber || line.productName).join("، ")}
                        {q.lines.length > 2 ? ` +${q.lines.length - 2}` : ""}
                      </div>
                    </TD>
                    <TD>
                      <div className="text-sm text-ink">{q.branchName ?? "—"}</div>
                      <div className="text-xs text-ink-faint">{q.priceTierName ?? "السعر الافتراضي"}</div>
                    </TD>
                    <TD>{q.validUntil ? formatDate(q.validUntil) : "—"}</TD>
                    <TD className="text-end font-semibold">
                      {formatCurrency(q.total, settings.currency)}
                    </TD>
                    <TD><StatusBadge quotation={q} /></TD>
                    <TD className="text-end">
                      <div className="inline-flex items-center gap-1">
                        <Button size="icon" variant="ghost" title="عرض" onClick={() => navigate(`/quotations/${q.id}`)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" title="طباعة"
                          onClick={async () => {
                            const result = await printAppRoute(`/quotations/${q.id}/print`);
                            if (!result.ok && result.error !== "cancelled") {
                              toast.error("تعذر الطباعة");
                            }
                          }}
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        {canEdit && q.status === "draft" && (
                          <Button size="icon" variant="ghost" title="تعديل" onClick={() => navigate(`/quotations/${q.id}/edit`)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDelete && q.status === "draft" && (
                          <Button
                            size="icon" variant="ghost" title="حذف"
                            className="text-rose-500 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:bg-rose-500/10"
                            onClick={() => setToDelete(q)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (!toDelete) return;
          deleteQuotation(toDelete.id);
          toast.success("تم حذف عرض السعر");
          setToDelete(null);
        }}
        title="حذف عرض السعر"
        message={`هل أنت متأكد من حذف العرض ${toDelete?.quotationNumber ?? ""}؟`}
        confirmText="حذف"
        variant="danger"
      />
    </>
  );
}

function StatusBadge({ quotation }: { quotation: Quotation }) {
  if (quotation.status === "converted") return <Badge tone="green">محولة</Badge>;
  if (quotation.validUntil && quotation.validUntil < todayISO()) return <Badge tone="red">انتهت الصلاحية</Badge>;
  return <Badge tone="amber">مفتوحة</Badge>;
}

function StatCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "amber" | "green" | "rose";
}) {
  const colors: Record<string, string> = {
    slate: "text-ink",
    amber: "text-amber-700 dark:text-amber-400",
    green: "text-emerald-700 dark:text-emerald-400",
    rose: "text-rose-700 dark:text-rose-400",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colors[tone]}`}>{value}</div>
    </div>
  );
}
