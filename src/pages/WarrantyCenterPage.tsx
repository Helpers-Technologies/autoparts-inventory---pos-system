import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, PackageCheck, Search, ShieldAlert, ShieldCheck, Truck, XCircle } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import type { WarrantyClaimStatus } from "../types";

const STATUS_LABELS: Record<WarrantyClaimStatus, string> = {
  open: "طلب جديد",
  inspecting: "تحت الفحص",
  supplier: "عند المورد",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  replaced: "تم الاستبدال",
};

type CoverageRow = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceLineId: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  soldAt: string;
  expiresAt: string;
  active: boolean;
  supplierId?: string;
};

function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setMonth(value.getMonth() + months);
  return value.toISOString().slice(0, 10);
}

export function WarrantyCenterPage() {
  const { salesInvoices } = useInvoicing();
  const { products, suppliers } = useCatalog();
  const pro = useAutoPartsPro();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"coverage" | "claims">("coverage");
  const [claimRow, setClaimRow] = useState<CoverageRow | null>(null);
  const [complaint, setComplaint] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const coverage = useMemo<CoverageRow[]>(() => salesInvoices
    .filter((invoice) => !invoice.cancelled)
    .flatMap((invoice) => invoice.lines
      .filter((line) => (line.warrantyMonths ?? 0) > 0)
      .map((line) => {
        const expiresAt = addMonths(invoice.date, line.warrantyMonths ?? 0);
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceLineId: line.id,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          productId: line.productId,
          productName: line.productName,
          soldAt: invoice.date,
          expiresAt,
          active: expiresAt >= today,
          supplierId: products.find((product) => product.id === line.productId)?.supplierId,
        };
      }))
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt)), [products, salesInvoices, today]);

  const q = query.trim().toLowerCase();
  const filteredCoverage = coverage.filter((row) => `${row.invoiceNumber} ${row.customerName} ${row.productName}`.toLowerCase().includes(q));
  const filteredClaims = pro.warrantyClaims.filter((claim) => `${claim.invoiceNumber} ${claim.customerName} ${claim.productName} ${claim.serialNumber ?? ""}`.toLowerCase().includes(q));
  const openClaims = pro.warrantyClaims.filter((claim) => !["rejected", "replaced"].includes(claim.status));

  function submitClaim() {
    if (!claimRow || !complaint.trim()) {
      toast.error("اكتب وصف العطل");
      return;
    }
    const exists = pro.warrantyClaims.some((claim) => claim.invoiceLineId === claimRow.invoiceLineId && !["rejected", "replaced"].includes(claim.status));
    if (exists) {
      toast.error("يوجد طلب ضمان مفتوح لهذه القطعة");
      return;
    }
    pro.addWarrantyClaim({
      invoiceId: claimRow.invoiceId,
      invoiceNumber: claimRow.invoiceNumber,
      invoiceLineId: claimRow.invoiceLineId,
      customerId: claimRow.customerId,
      customerName: claimRow.customerName,
      productId: claimRow.productId,
      productName: claimRow.productName,
      supplierId: claimRow.supplierId,
      complaint: complaint.trim(),
      serialNumber: serialNumber.trim() || undefined,
    });
    setClaimRow(null);
    setComplaint("");
    setSerialNumber("");
    setTab("claims");
    toast.success("تم فتح طلب الضمان");
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={ShieldCheck}
        eyebrow="WARRANTY · SERIAL · SUPPLIER CLAIMS"
        title="مركز ضمان قطع الغيار"
        description="الضمان يُنشأ تلقائيًا من تاريخ فاتورة البيع ومدة ضمان المنتج، مع متابعة الفحص والمورد والاستبدال."
        stats={[
          { label: "تغطية سارية", value: coverage.filter((row) => row.active).length },
          { label: "طلبات مفتوحة", value: openClaims.length },
          { label: "تم استبدالها", value: pro.warrantyClaims.filter((claim) => claim.status === "replaced").length },
        ]}
      />

      <Card>
        <CardBody className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex rounded-xl bg-surface-muted p-1">
            <button type="button" onClick={() => setTab("coverage")} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "coverage" ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted"}`}>الضمانات المباعة</button>
            <button type="button" onClick={() => setTab("claims")} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "claims" ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted"}`}>طلبات الضمان ({pro.warrantyClaims.length})</button>
          </div>
          <div className="relative w-full md:max-w-sm"><Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="فاتورة، عميل، قطعة أو سيريال..." className="pr-10" /></div>
        </CardBody>
      </Card>

      {tab === "coverage" ? (
        <Card>
          <CardHeader title="تغطيات الضمان" subtitle="يمكن فتح طلب للقطعة ما دامت التغطية سارية" />
          <CardBody>
            {filteredCoverage.length === 0 ? <EmptyState icon={<PackageCheck className="h-6 w-6" />} title="لا توجد مبيعات بضمان" description="حدد مدة الضمان داخل بيانات المنتج لتظهر المبيعات هنا." /> : <div className="grid gap-3 lg:grid-cols-2">{filteredCoverage.map((row) => {
              const existing = pro.warrantyClaims.find((claim) => claim.invoiceLineId === row.invoiceLineId && !["rejected", "replaced"].includes(claim.status));
              return <div key={`${row.invoiceId}:${row.invoiceLineId}`} className="rounded-2xl border border-line p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-ink">{row.productName}</div><div className="mt-1 text-xs text-ink-muted">{row.customerName} · <span dir="ltr">{row.invoiceNumber}</span></div></div><Badge tone={row.active ? "green" : "red"}>{row.active ? "ساري" : "منتهي"}</Badge></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-surface-muted p-3"><span className="text-ink-faint">تاريخ البيع</span><strong className="mt-1 block" dir="ltr">{row.soldAt}</strong></div><div className="rounded-xl bg-surface-muted p-3"><span className="text-ink-faint">نهاية الضمان</span><strong className="mt-1 block" dir="ltr">{row.expiresAt}</strong></div></div><Button className="mt-3 w-full" variant={existing ? "outline" : "primary"} disabled={!row.active || Boolean(existing)} onClick={() => setClaimRow(row)}>{existing ? <><CalendarClock className="h-4 w-4" /> {STATUS_LABELS[existing.status]}</> : <><ShieldAlert className="h-4 w-4" /> فتح طلب ضمان</>}</Button></div>;
            })}</div>}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="متابعة طلبات الضمان" subtitle="غيّر الحالة مع انتقال القطعة من الفحص إلى المورد ثم القرار النهائي" />
          <CardBody>
            {filteredClaims.length === 0 ? <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="لا توجد طلبات ضمان" /> : <div className="space-y-3">{filteredClaims.map((claim) => {
              const supplier = suppliers.find((item) => item.id === claim.supplierId);
              return <div key={claim.id} className="rounded-2xl border border-line p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{claim.productName}</strong><Badge tone={claim.status === "rejected" ? "red" : claim.status === "replaced" ? "green" : "amber"}>{STATUS_LABELS[claim.status]}</Badge></div><div className="mt-1 text-xs text-ink-muted">{claim.customerName} · <span dir="ltr">{claim.invoiceNumber}</span>{supplier ? ` · المورد: ${supplier.name}` : ""}</div><div className="mt-2 rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink">{claim.complaint}</div>{claim.serialNumber ? <div className="mt-2 font-mono text-xs text-ink-faint" dir="ltr">S/N: {claim.serialNumber}</div> : null}</div><div className="w-full lg:w-52"><Select value={claim.status} onChange={(event) => pro.updateWarrantyClaim(claim.id, { status: event.target.value as WarrantyClaimStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><div className="mt-2 flex gap-2"><Button size="sm" variant="success" className="flex-1" onClick={() => pro.updateWarrantyClaim(claim.id, { status: "replaced" })}><CheckCircle2 className="h-3.5 w-3.5" /> استبدال</Button><Button size="sm" variant="outline" className="flex-1 text-red-600" onClick={() => pro.updateWarrantyClaim(claim.id, { status: "rejected" })}><XCircle className="h-3.5 w-3.5" /> رفض</Button></div></div></div></div>;
            })}</div>}
          </CardBody>
        </Card>
      )}

      <Dialog open={Boolean(claimRow)} onClose={() => setClaimRow(null)} title="فتح طلب ضمان" subtitle={claimRow ? `${claimRow.productName} — ${claimRow.invoiceNumber}` : undefined} width="md" footer={<><Button variant="outline" onClick={() => setClaimRow(null)}>إلغاء</Button><Button onClick={submitClaim}><Truck className="h-4 w-4" /> تسجيل الطلب</Button></>}>
        <div className="space-y-4"><Field label="السيريال / رقم التشغيلة"><Input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} dir="ltr" placeholder="اختياري" /></Field><Field label="وصف العطل" required><Textarea value={complaint} onChange={(event) => setComplaint(event.target.value)} placeholder="صف العطل وحالة القطعة ونتيجة الفحص الأولي..." /></Field>{claimRow?.supplierId ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">سيتم ربط الطلب بالمورد المسجل على المنتج.</div> : null}</div>
      </Dialog>
    </div>
  );
}
